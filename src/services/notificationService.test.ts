import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { notificationService } from './notificationService';
import { getToken } from 'firebase/messaging';
import * as firebase from '../firebase';

// notificationService.ts artık uygulamanın diğer her yerinde olduğu gibi
// Firestore fonksiyonlarını '../firebase' sarmalayıcısı üzerinden alıyor —
// yalnızca Messaging'in getToken'ı sarmalayıcıda yok, o hâlâ doğrudan
// 'firebase/messaging'den import ediliyor ve ayrıca mock'lanması gerekiyor.
vi.mock('firebase/messaging', () => ({ getToken: vi.fn() }));

const { messagingRef } = vi.hoisted(() => ({ messagingRef: { current: null as object | null } }));
vi.mock('../firebase', () => ({
  db: {},
  auth: { currentUser: null as { uid: string; email?: string; emailVerified?: boolean } | null },
  get messaging() { return messagingRef.current; },
  collection: vi.fn(() => ({})),
  addDoc: vi.fn(),
  query: vi.fn((...args: unknown[]) => ({ __query: args })),
  where: vi.fn(),
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  doc: vi.fn((...args: unknown[]) => ({ __doc: args })),
  limit: vi.fn(),
  orderBy: vi.fn(),
  writeBatch: vi.fn(),
}));

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messagingRef.current = null;
    (firebase.auth as { currentUser: unknown }).currentUser = null;
    vi.stubGlobal('Notification', { requestPermission: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('requestPermissionAndGetToken', () => {
    it('izin reddedilirse false döner, getToken çağrılmaz', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('denied' as NotificationPermission);

      const result = await notificationService.requestPermissionAndGetToken('user-1');

      expect(result).toBe(false);
      expect(getToken).not.toHaveBeenCalled();
    });

    it('izin verilir ama messaging başlatılmamışsa (null): true döner, getToken çağrılmaz', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('granted' as NotificationPermission);
      messagingRef.current = null;

      const result = await notificationService.requestPermissionAndGetToken('user-1');

      expect(result).toBe(true);
      expect(getToken).not.toHaveBeenCalled();
    });

    it('izin verilir + messaging var ama VAPID key tanımlı değilse: true döner, getToken çağrılmaz', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('granted' as NotificationPermission);
      messagingRef.current = {};
      vi.stubEnv('VITE_FIREBASE_VAPID_KEY', '');

      const result = await notificationService.requestPermissionAndGetToken('user-1');

      expect(result).toBe(true);
      expect(getToken).not.toHaveBeenCalled();
    });

    it('VAPID key 87 karakter değilse yine de getToken çağrılır (sadece uyarı loglanır, akış durmaz)', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('granted' as NotificationPermission);
      messagingRef.current = {};
      vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'kisa-key');
      vi.mocked(getToken).mockResolvedValueOnce('fcm-token-1');
      vi.mocked(firebase.getDocs).mockResolvedValueOnce({ empty: true, docs: [] } as any);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await notificationService.requestPermissionAndGetToken('user-1');

      expect(getToken).toHaveBeenCalledOnce();
      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('token alınır + uid ile kullanıcı bulunur + token henüz kayıtlı değilse: updateDoc ile fcmTokens\'a eklenir', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('granted' as NotificationPermission);
      messagingRef.current = {};
      vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'B'.repeat(87));
      vi.mocked(getToken).mockResolvedValueOnce('fcm-token-1');
      const userDocRef = { __ref: 'user-doc' };
      vi.mocked(firebase.getDocs).mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: userDocRef, data: () => ({ fcmTokens: ['eski-token'] }) }],
      } as any);

      await notificationService.requestPermissionAndGetToken('user-1');

      expect(firebase.updateDoc).toHaveBeenCalledWith(userDocRef, { fcmTokens: ['eski-token', 'fcm-token-1'] });
    });

    it('token zaten fcmTokens içindeyse tekrar eklenmez (updateDoc çağrılmaz)', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('granted' as NotificationPermission);
      messagingRef.current = {};
      vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'B'.repeat(87));
      vi.mocked(getToken).mockResolvedValueOnce('fcm-token-1');
      vi.mocked(firebase.getDocs).mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: {}, data: () => ({ fcmTokens: ['fcm-token-1'] }) }],
      } as any);

      await notificationService.requestPermissionAndGetToken('user-1');

      expect(firebase.updateDoc).not.toHaveBeenCalled();
    });

    it('uid ile eşleşen kullanıcı sorgusu boşsa: setDoc(merge:true) ile fallback yazılır', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('granted' as NotificationPermission);
      messagingRef.current = {};
      vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'B'.repeat(87));
      vi.mocked(getToken).mockResolvedValueOnce('fcm-token-1');
      vi.mocked(firebase.getDocs).mockResolvedValueOnce({ empty: true, docs: [] } as any);

      await notificationService.requestPermissionAndGetToken('user-1');

      expect(firebase.setDoc).toHaveBeenCalledWith({ __doc: [firebase.db, 'users', 'user-1'] }, { fcmTokens: ['fcm-token-1'] }, { merge: true });
    });

    it('getToken başarısız olursa true dönmeye devam eder (yerel bildirim yine de çalışsın diye izin verilmiş sayılır)', async () => {
      vi.mocked(Notification.requestPermission).mockResolvedValueOnce('granted' as NotificationPermission);
      messagingRef.current = {};
      vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'B'.repeat(87));
      vi.mocked(getToken).mockRejectedValueOnce(new Error('token-error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await notificationService.requestPermissionAndGetToken('user-1');

      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('Notification.requestPermission() kendisi reddederse hata olduğu gibi (JSON\'a sarmadan) fırlatılır', async () => {
      vi.mocked(Notification.requestPermission).mockRejectedValueOnce(new Error('permission-api-error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(notificationService.requestPermissionAndGetToken('user-1')).rejects.toThrow('permission-api-error');

      errorSpy.mockRestore();
    });
  });

  describe('createNotification', () => {
    it('addDoc başarılıysa sonucunu döner', async () => {
      vi.mocked(firebase.addDoc).mockResolvedValueOnce({ id: 'notif-1' } as any);

      const result = await notificationService.createNotification({
        userId: 'u1', title: 'T', message: 'M', type: 'Info', timestamp: 1, isRead: false,
      });

      expect(result).toEqual({ id: 'notif-1' });
    });

    it('addDoc reddederse operationType=write, path=notifications içeren JSON hata fırlatılır', async () => {
      vi.mocked(firebase.addDoc).mockRejectedValueOnce(new Error('permission-denied'));

      await expect(notificationService.createNotification({
        userId: 'u1', title: 'T', message: 'M', type: 'Info', timestamp: 1, isRead: false,
      })).rejects.toThrow(/"operationType":"write".*"path":"notifications"/);
    });
  });

  describe('getUnreadNotifications', () => {
    it('gelen dokümanlar id ile birlikte döndürülür', async () => {
      vi.mocked(firebase.getDocs).mockResolvedValueOnce({
        docs: [{ id: 'n1', data: () => ({ userId: 'u1', title: 'T', message: 'M', type: 'Info', timestamp: 1, isRead: false }) }],
      } as any);

      const result = await notificationService.getUnreadNotifications('u1');

      expect(result).toEqual([{ id: 'n1', userId: 'u1', title: 'T', message: 'M', type: 'Info', timestamp: 1, isRead: false }]);
    });

    it('sorgu userId/isRead=false/timestamp desc/limit 20 ile kurulur', async () => {
      vi.mocked(firebase.getDocs).mockResolvedValueOnce({ docs: [] } as any);

      await notificationService.getUnreadNotifications('u1');

      expect(firebase.where).toHaveBeenCalledWith('userId', '==', 'u1');
      expect(firebase.where).toHaveBeenCalledWith('isRead', '==', false);
      expect(firebase.orderBy).toHaveBeenCalledWith('timestamp', 'desc');
      expect(firebase.limit).toHaveBeenCalledWith(20);
    });

    it('getDocs reddederse JSON hata fırlatılır', async () => {
      vi.mocked(firebase.getDocs).mockRejectedValueOnce(new Error('network-error'));

      await expect(notificationService.getUnreadNotifications('u1')).rejects.toThrow(/"operationType":"get"/);
    });
  });

  describe('markAsRead', () => {
    it('updateDoc doğru referans ve { isRead: true } ile çağrılır', async () => {
      await notificationService.markAsRead('notif-1');

      expect(firebase.updateDoc).toHaveBeenCalledWith({ __doc: [firebase.db, 'notifications', 'notif-1'] }, { isRead: true });
    });

    it('updateDoc reddederse path=notifications/{id} içeren JSON hata fırlatılır', async () => {
      vi.mocked(firebase.updateDoc).mockRejectedValueOnce(new Error('permission-denied'));

      await expect(notificationService.markAsRead('notif-1')).rejects.toThrow(/"path":"notifications\/notif-1"/);
    });
  });

  describe('markAllAsRead', () => {
    it('okunmamış her doküman için batch.update çağrılır ve tek seferde commit edilir', async () => {
      const batchUpdate = vi.fn();
      const batchCommit = vi.fn();
      vi.mocked(firebase.writeBatch).mockReturnValueOnce({ update: batchUpdate, commit: batchCommit } as any);
      vi.mocked(firebase.getDocs).mockResolvedValueOnce({
        docs: [{ ref: { __ref: 'n1' } }, { ref: { __ref: 'n2' } }],
      } as any);

      await notificationService.markAllAsRead('u1');

      expect(batchUpdate).toHaveBeenCalledTimes(2);
      expect(batchUpdate).toHaveBeenCalledWith({ __ref: 'n1' }, { isRead: true });
      expect(batchCommit).toHaveBeenCalledOnce();
    });

    it('getDocs reddederse JSON hata fırlatılır', async () => {
      vi.mocked(firebase.getDocs).mockRejectedValueOnce(new Error('network-error'));

      await expect(notificationService.markAllAsRead('u1')).rejects.toThrow(/"operationType":"write"/);
    });
  });
});
