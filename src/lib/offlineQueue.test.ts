import { describe, it, expect, beforeEach, vi } from 'vitest';
import { offlineQueue, OfflineMutation } from '../lib/offlineQueue';

// addDoc, updateDoc vb. mock'ları setup.ts'den geliyor
import * as firebase from '../firebase';
import { useUIStore } from '../store/uiStore';

let refCounter = 0;

describe('OfflineQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    // isSyncing mutex'ini sıfırlamak için modülü yeniden import etmek yerine
    // localStorage temizliyoruz ve queue sıfırlıyoruz
    vi.clearAllMocks();
    refCounter = 0;
    vi.mocked(firebase.doc).mockImplementation(() => ({ id: `generated-ref-${++refCounter}` }) as any);
    vi.mocked(firebase.collection).mockImplementation(() => ({}) as any);
    vi.mocked(firebase.increment).mockImplementation((n: number) => ({ __increment: n }) as any);
  });

  // ─── getQueue / saveQueue ──────────────────────────────────────────────────

  describe('getQueue & saveQueue', () => {
    it('boş localStorage\'da boş dizi döner', () => {
      expect(offlineQueue.getQueue()).toEqual([]);
    });

    it('saveQueue ile kaydedilen kuyruk getQueue ile okunur', () => {
      const mutations: OfflineMutation[] = [
        { id: 'test-1', collectionName: 'tasks', action: 'create', timestamp: Date.now() }
      ];
      offlineQueue.saveQueue(mutations);
      expect(offlineQueue.getQueue()).toHaveLength(1);
      expect(offlineQueue.getQueue()[0]!.id).toBe('test-1');
    });

    it('bozuk JSON localStorage\'da boş dizi döner (hata yakalanır)', () => {
      localStorage.setItem('makam_offline_mutations', '{ corrupted }}}');
      expect(offlineQueue.getQueue()).toEqual([]);
    });
  });

  // ─── enqueue ──────────────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('kuyrukta bulunmayan bir öğe ekler', () => {
      offlineQueue.enqueue('tasks', 'create', { id: 'task-temp-1', title: 'Test' });
      const queue = offlineQueue.getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]!.collectionName).toBe('tasks');
      expect(queue[0]!.action).toBe('create');
    });

    it('birden fazla öğe eklenebilir', () => {
      offlineQueue.enqueue('tasks', 'create', { id: 'a' });
      offlineQueue.enqueue('tasks', 'update', { title: 'Yeni' }, 'a');
      offlineQueue.enqueue('blockers', 'create', { taskId: 'a' });
      expect(offlineQueue.getQueue()).toHaveLength(3);
    });

    it('her öğeye benzersiz id atanır', () => {
      offlineQueue.enqueue('tasks', 'create', {});
      offlineQueue.enqueue('tasks', 'create', {});
      const queue = offlineQueue.getQueue();
      expect(queue[0]!.id).not.toBe(queue[1]!.id);
    });

    it('aynı doküman için art arda update çağrıları TEK mutasyonda birleştirilir', () => {
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'task-1', 3);
      offlineQueue.enqueue('tasks', 'update', { title: 'Yeni Başlık' }, 'task-1', 3);
      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1', 3);

      const queue = offlineQueue.getQueue();
      expect(queue).toHaveLength(1);
      // Son değer kazanır (status), ayrık alanlar korunur (title)
      expect(queue[0]!.data).toMatchObject({ status: 'BLOCKED', title: 'Yeni Başlık' });
      expect(queue[0]!.expectedVersion).toBe(3);
    });

    it('farklı dokümanlara yapılan update\'ler birleştirilmez', () => {
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'task-1', 1);
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'task-2', 1);
      expect(offlineQueue.getQueue()).toHaveLength(2);
    });

    it('linkedTaskTransition taşıyan mutasyon birleştirmeye dahil edilmez', () => {
      offlineQueue.enqueue(
        'blockers', 'update', { isResolved: true }, 'blocker-1', undefined,
        { taskId: 'task-1', newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 2 }
      );
      offlineQueue.enqueue('blockers', 'update', { reason: 'Güncellenmiş sebep' }, 'blocker-1');

      // linkedTaskTransition mutasyonu korunur, yeni plain update ayrı bir öğe olarak eklenir
      expect(offlineQueue.getQueue()).toHaveLength(2);
    });

    it('timestamp otomatik eklenir', () => {
      const before = Date.now();
      offlineQueue.enqueue('tasks', 'delete', undefined, 'some-id');
      const after = Date.now();
      const item = offlineQueue.getQueue()[0]!;
      expect(item.timestamp).toBeGreaterThanOrEqual(before);
      expect(item.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ─── sync — offline durumu ──────────────────────────────────────────────────

  describe('sync — offline durumu', () => {
    it('browser offline iken sync atlanır ve false döner', async () => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, writable: true });
      offlineQueue.enqueue('tasks', 'create', { id: 'x' });
      const result = await offlineQueue.sync();
      expect(result).toBe(false);
      // Kuyruk hâlâ dolu olmalı
      expect(offlineQueue.getQueue()).toHaveLength(1);
      Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });
    });

    it('boş kuyrukta sync hemen true döner', async () => {
      const result = await offlineQueue.sync();
      expect(result).toBe(true);
    });
  });

  // ─── sync — başarılı create + ID remapping ──────────────────────────────────

  describe('sync — create işlemi ve ID remapping', () => {
    it('create başarılıysa kuyruk temizlenir', async () => {
      const fakeRef = { id: 'firestore-real-id' };
      vi.mocked(firebase.addDoc).mockResolvedValueOnce(fakeRef as any);
      vi.mocked(firebase.updateDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-id', title: 'Görev' });
      
      Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });
      const result = await offlineQueue.sync();
      
      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
    });

    it('create sonrası bağımlı update\'teki geçici ID gerçek ID ile değiştirilir', async () => {
      const fakeRef = { id: 'real-firestore-id' };
      vi.mocked(firebase.addDoc).mockResolvedValueOnce(fakeRef as any);
      vi.mocked(firebase.updateDoc).mockResolvedValue(undefined as any);

      // Önce create, sonra aynı geçici ID ile update
      offlineQueue.enqueue('tasks', 'create', { id: 'temp-abc', title: 'Yeni' });
      offlineQueue.enqueue('tasks', 'update', { title: 'Güncellendi' }, 'temp-abc');

      await offlineQueue.sync();

      // Her iki işlem de başarılı — kuyruk boş olmalı
      expect(offlineQueue.getQueue()).toHaveLength(0);
    });

    it('başarısız mutation kuyrukta kalır', async () => {
      vi.mocked(firebase.addDoc).mockRejectedValueOnce(new Error('Network error'));

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-fail', title: 'Başarısız' });

      const result = await offlineQueue.sync();
      
      expect(result).toBe(false);
      expect(offlineQueue.getQueue()).toHaveLength(1);
    });

    it('permission-denied ile reddedilen mutasyon sonsuza dek denenmez, kuyruktan düşürülür ve toast gösterilir', async () => {
      vi.mocked(firebase.addDoc).mockRejectedValueOnce(
        new firebase.FirebaseError('permission-denied', 'Missing or insufficient permissions.')
      );
      useUIStore.setState({ toasts: [] });

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-forbidden', title: 'Yasak İşlem' });
      const result = await offlineQueue.sync();

      // Kalıcı hata "başarısız senkron" değil — mutasyon bilerek düşürülür
      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(useUIStore.getState().toasts).toHaveLength(1);
      expect(useUIStore.getState().toasts[0]).toMatchObject({ type: 'danger' });
    });

    it('kısmi başarı: başarılı olanlar silinir, başarısız olanlar kalır', async () => {
      const fakeRef = { id: 'real-id' };
      vi.mocked(firebase.addDoc).mockResolvedValueOnce(fakeRef as any);
      vi.mocked(firebase.updateDoc)
        .mockResolvedValueOnce(undefined as any)  // create sonrası id update
        .mockRejectedValueOnce(new Error('Permission denied')); // ikinci update başarısız

      offlineQueue.enqueue('tasks', 'create', { id: 'temp-1', title: 'Görev 1' });
      offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS' }, 'temp-2');

      const result = await offlineQueue.sync();
      
      expect(result).toBe(false);
      expect(offlineQueue.getQueue()).toHaveLength(1);
    });
  });

  // ─── sync — delete ve set ───────────────────────────────────────────────────

  describe('sync — delete ve set işlemleri', () => {
    it('delete işlemi başarılıysa kuyruktan silinir', async () => {
      vi.mocked(firebase.deleteDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('tasks', 'delete', undefined, 'task-to-delete');
      await offlineQueue.sync();

      expect(offlineQueue.getQueue()).toHaveLength(0);
    });

    it('docId olmayan delete işlemi sessizce geçilir', async () => {
      // docId'siz delete — hiçbir şey yapılmamalı ama hata fırlatılmamalı
      offlineQueue.enqueue('tasks', 'delete', undefined, undefined);
      const result = await offlineQueue.sync();
      expect(result).toBe(true);
    });

    it('set işlemi merge ile kaydeder', async () => {
      vi.mocked(firebase.setDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('system', 'set', { key: 'sla_config', value: {} }, 'sla_config');
      await offlineQueue.sync();

      expect(firebase.setDoc).toHaveBeenCalledOnce();
      // Üçüncü argüman { merge: true } olmalı
      const callArgs = vi.mocked(firebase.setDoc).mock.calls[0]!;
      expect(callArgs[2]).toEqual({ merge: true });
      // Veri doğru
      expect(callArgs[1]).toMatchObject({ key: 'sla_config' });
    });
  });

  // ─── sync — task update ile optimistic locking ─────────────────────────────
  // Çevrimdışı görev güncellemeleri artık expectedVersion taşıyor ve senkronda
  // sunucudaki lockVersion ile karşılaştırılıyor (bkz. offlineQueue.ts sync()).

  describe('sync — task update ile optimistic locking', () => {
    it('versiyon eşleşirse update uygulanır ve lockVersion artırılır', async () => {
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ lockVersion: 3, title: 'Görev' }),
          }),
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1', 3);
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).toHaveBeenCalledOnce();
      const [, updateData] = transactionUpdate.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'BLOCKED', lockVersion: 4 });
    });

    it('versiyon uyuşmazsa update UYGULANMAZ, mutasyon düşürülür ve çakışma bildirimi tetiklenir', async () => {
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          // Sunucudaki gerçek versiyon (5), çevrimdışıyken kaydedilen beklenen versiyondan (3) farklı
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ lockVersion: 5, title: 'Başka Kullanıcı Değiştirdi' }),
          }),
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      const { conflictDetectionService } = await import('../services/conflictDetectionService');
      const conflictHandler = vi.fn();
      const unsubscribe = conflictDetectionService.subscribe(conflictHandler);

      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1', 3);
      const result = await offlineQueue.sync();

      unsubscribe();

      // Çakışma "başarısız" değil — mutasyon bilerek düşürülür (sonsuz retry anlamsız)
      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      // Sunucu verisi ÜZERİNE YAZILMADI
      expect(transactionUpdate).not.toHaveBeenCalled();
      // Kullanıcı çakışmadan haberdar edildi
      expect(conflictHandler).toHaveBeenCalledOnce();
      expect(conflictHandler.mock.calls[0]![0]).toMatchObject({
        taskId: 'task-1',
        taskTitle: 'Başka Kullanıcı Değiştirdi',
        expectedVersion: 3,
        serverVersion: 5,
      });
    });

    it('expectedVersion verilmeyen (eski/legacy) mutasyonlar versiyon kontrolü olmadan uygulanır', async () => {
      vi.mocked(firebase.updateDoc).mockResolvedValueOnce(undefined as any);

      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED' }, 'task-1');
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(firebase.updateDoc).toHaveBeenCalledOnce();
      expect(firebase.runTransaction).not.toHaveBeenCalled();
    });
  });

  // ─── sync — blocker + görev geçişi atomikliği (linkedTaskTransition) ───────
  // Çevrimdışıyken bir engel oluşturmak/çözmek artık görev durum geçişiyle
  // TEK mutasyonda kuyruğa alınıyor ve sync'te aynı transaction'da uygulanıyor
  // (bkz. useAppHandlers.ts + offlineQueue.ts sync()).

  describe('sync — blocker + görev geçişi atomikliği', () => {
    it('linkedTaskTransition ile create: engel dokümanı ve görev BLOCKED geçişi AYNI transaction\'da uygulanır', async () => {
      const transactionSet = vi.fn();
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 2, totalPausedTime: 0 }),
          }),
          set: transactionSet,
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue(
        'blockers', 'create',
        { id: 'temp_blocker_1', taskId: 'task-1', reason: 'Kriz', isResolved: false, createdAt: Date.now() },
        undefined, undefined,
        { taskId: 'task-1', newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).toHaveBeenCalledOnce(); // görev durumu güncellendi
      const blockerSetCall = transactionSet.mock.calls.find(([, data]: any) => data?.reason !== undefined);
      expect(blockerSetCall?.[1]).toMatchObject({ taskId: 'task-1', reason: 'Kriz' });
    });

    it('linkedTaskTransition ile create: versiyon uyuşmazsa hem engel hem görev yazımı reddedilir, çakışma bildirilir', async () => {
      const transactionSet = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 9, totalPausedTime: 0 }),
          }),
          set: transactionSet,
          update: vi.fn(),
        };
        return fn(transaction);
      });

      const { conflictDetectionService } = await import('../services/conflictDetectionService');
      const conflictHandler = vi.fn();
      const unsubscribe = conflictDetectionService.subscribe(conflictHandler);

      offlineQueue.enqueue(
        'blockers', 'create',
        { id: 'temp_blocker_1', taskId: 'task-1', reason: 'Kriz', isResolved: false, createdAt: Date.now() },
        undefined, undefined,
        { taskId: 'task-1', newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();
      unsubscribe();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      // Görev versiyonu uyuşmadığı için transaction'daki HİÇBİR yazma commit edilmez —
      // sahipsiz engel dokümanı oluşmaz
      expect(transactionSet).not.toHaveBeenCalled();
      expect(conflictHandler).toHaveBeenCalledOnce();
    });

    it('linkedTaskTransition ile update: engel çözümü ve görev IN_PROGRESS geçişi AYNI transaction\'da uygulanır', async () => {
      const transactionSet = vi.fn();
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'BLOCKED', lockVersion: 5, totalPausedTime: 0, pausedAt: Date.now() - 5000, deadline: Date.now() + 100000 }),
          }),
          set: transactionSet,
          update: transactionUpdate,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue(
        'blockers', 'update',
        { isResolved: true, resolvedAt: Date.now() },
        'blocker-1', undefined,
        { taskId: 'task-1', newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 5 }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      // İki update: görev (transitionTaskInTransaction) + blocker dokümanı
      expect(transactionUpdate).toHaveBeenCalledTimes(2);
    });
  });

  // ─── sync — statusTransition (offline durum geçişi) ────────────────────────
  // Çevrimdışı durum geçişleri artık ham transaction.update() yerine online ile
  // BİREBİR AYNI transitionTaskInTransaction'dan geçiyor (bkz. offlineQueue.ts
  // sync() + useAppHandlers.ts). Bu, audit_logs/system-stats yazımının ve
  // kriz-affı (breach-debt + 24s mühlet uzatması) mantığının offline'da da
  // uygulandığını doğrular.

  describe('sync — statusTransition (offline durum geçişi)', () => {
    it('CRISIS→IN_PROGRESS: offline geçişte de online ile aynı ihlal-affı, audit ve stats mantığı uygulanır', async () => {
      const transactionUpdate = vi.fn();
      const transactionSet = vi.fn();
      const now = Date.now();
      const pastDeadline = now - 2 * 60 * 60 * 1000; // 2 saat önce ihlal edilmiş

      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({
              status: 'CRISIS',
              lockVersion: 2,
              totalPausedTime: 0,
              pausedAt: null,
              deadline: pastDeadline,
            }),
          }),
          update: transactionUpdate,
          set: transactionSet,
        };
        return fn(transaction);
      });

      offlineQueue.enqueue(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);

      // Görev dokümanı: lockVersion arttı, kriz-affı (breach debt + 24s) totalPausedTime'a eklendi
      expect(transactionUpdate).toHaveBeenCalledOnce();
      const [, updateData] = transactionUpdate.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'IN_PROGRESS', lockVersion: 3, pausedAt: null });
      expect(updateData.totalPausedTime).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);

      // Düz transaction.update() ile ASLA yazılmayan audit_logs + system/stats,
      // offline yolda da (online ile aynı transitionTaskInTransaction üzerinden) yazılıyor
      const auditCall = transactionSet.mock.calls.find(([, data]: any) => data?.changes !== undefined);
      expect(auditCall?.[1]).toMatchObject({ taskId: 'task-1', changedBy: 'user-1', oldValue: 'CRISIS', newValue: 'IN_PROGRESS' });
      const statsCall = transactionSet.mock.calls.find(([, data]: any) => 'status_CRISIS' in (data ?? {}));
      expect(statsCall?.[1]).toMatchObject({ status_IN_PROGRESS: { __increment: 1 } });
    });

    it('statusTransition taşıyan mutasyon birleştirmeye dahil edilmez', () => {
      offlineQueue.enqueue(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 2 }
      );
      offlineQueue.enqueue('tasks', 'update', { title: 'Başlık düzeltmesi' }, 'task-1', 2);

      // statusTransition mutasyonu korunur, ardından gelen plain update ayrı bir öğe olarak eklenir
      expect(offlineQueue.getQueue()).toHaveLength(2);
    });

    it('versiyon uyuşmazsa statusTransition UYGULANMAZ, mutasyon düşürülür ve çakışma bildirilir', async () => {
      const transactionUpdate = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 9, totalPausedTime: 0 }),
          }),
          update: transactionUpdate,
          set: vi.fn(),
        };
        return fn(transaction);
      });

      const { conflictDetectionService } = await import('../services/conflictDetectionService');
      const conflictHandler = vi.fn();
      const unsubscribe = conflictDetectionService.subscribe(conflictHandler);

      offlineQueue.enqueue(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'COMPLETED', userId: 'user-1', expectedVersion: 2 }
      );
      const result = await offlineQueue.sync();
      unsubscribe();

      expect(result).toBe(true);
      expect(offlineQueue.getQueue()).toHaveLength(0);
      expect(transactionUpdate).not.toHaveBeenCalled();
      expect(conflictHandler).toHaveBeenCalledOnce();
    });
  });
});
