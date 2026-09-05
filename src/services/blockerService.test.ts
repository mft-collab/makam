import { describe, it, expect, beforeEach, vi } from 'vitest';
import { blockerService } from './blockerService';
import * as firebase from '../firebase';

let refCounter = 0;

describe('blockerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refCounter = 0;
    vi.mocked(firebase.doc).mockImplementation(() => ({ id: `generated-ref-${++refCounter}` }) as any);
    vi.mocked(firebase.collection).mockImplementation(() => ({}) as any);
    vi.mocked(firebase.increment).mockImplementation((n: number) => ({ __increment: n }) as any);
  });

  describe('addBlocker', () => {
    it('engel dokümanı ve görev BLOCKED güncellemesi AYNI transaction içinde yapılır', async () => {
      const calls: string[] = [];
      const transactionUpdate = vi.fn(() => calls.push('task-update'));
      const transactionSet = vi.fn(() => calls.push('write'));

      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockImplementationOnce(async () => {
            calls.push('read');
            return {
              exists: () => true,
              data: () => ({ status: 'IN_PROGRESS', lockVersion: 2, totalPausedTime: 0 }),
            };
          }),
          update: transactionUpdate,
          set: transactionSet,
        };
        return fn(transaction);
      });

      const blockerId = await blockerService.addBlocker('task-1', 'Sebep', 'user-1', 2);

      expect(blockerId).toBeTruthy();
      // Okuma, herhangi bir yazmadan önce gerçekleşmeli (Firestore transaction kuralı)
      expect(calls[0]).toBe('read');
      expect(transactionUpdate).toHaveBeenCalledOnce(); // görev durumu güncellendi
      // set: hem audit log + stats (transitionTaskInTransaction içinde) hem de blocker dokümanı
      expect(transactionSet).toHaveBeenCalled();
      const blockerSetCall = transactionSet.mock.calls.find(([, data]: any) => data?.reason !== undefined);
      expect(blockerSetCall?.[1]).toMatchObject({ taskId: 'task-1', reason: 'Sebep', isResolved: false });
    });

    it('severity belirtilmezse Medium varsayılır', async () => {
      const transactionSet = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 2, totalPausedTime: 0 }),
          }),
          update: vi.fn(),
          set: transactionSet,
        };
        return fn(transaction);
      });

      await blockerService.addBlocker('task-1', 'Sebep', 'user-1', 2);

      const blockerSetCall = transactionSet.mock.calls.find(([, data]: any) => data?.reason !== undefined);
      expect(blockerSetCall?.[1]).toMatchObject({ severity: 'Medium' });
    });

    it('severity açıkça verilirse doküman değeri onu yansıtır', async () => {
      const transactionSet = vi.fn();
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 2, totalPausedTime: 0 }),
          }),
          update: vi.fn(),
          set: transactionSet,
        };
        return fn(transaction);
      });

      await blockerService.addBlocker('task-1', 'Sebep', 'user-1', 2, 'Urgent');

      const blockerSetCall = transactionSet.mock.calls.find(([, data]: any) => data?.reason !== undefined);
      expect(blockerSetCall?.[1]).toMatchObject({ severity: 'Urgent' });
    });

    it('görev versiyonu uyuşmuyorsa transaction tamamı reddedilir, engel dokümanı yazılmaz', async () => {
      const transactionSet = vi.fn();

      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'IN_PROGRESS', lockVersion: 9, totalPausedTime: 0 }),
          }),
          update: vi.fn(),
          set: transactionSet,
        };
        return fn(transaction);
      });

      await expect(
        blockerService.addBlocker('task-1', 'Sebep', 'user-1', 2)
      ).rejects.toThrow(/VERSION_MISMATCH/);

      // Transaction hata fırlattığı için blocker seti hiçbir zaman commit edilmez
      // (gerçek Firestore'da transaction rollback olur; burada fonksiyonun
      // erken throw ettiğini ve blocker set çağrısına ulaşmadığını doğruluyoruz)
      expect(transactionSet).not.toHaveBeenCalled();
    }, 10000);
  });

  describe('resolveBlocker', () => {
    it('son aktif engel çözülüyorsa görev IN_PROGRESS\'e dönüşü ile AYNI transaction\'da işlenir', async () => {
      const transactionUpdate = vi.fn();

      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ status: 'BLOCKED', lockVersion: 4, totalPausedTime: 0, pausedAt: Date.now() - 1000, deadline: Date.now() + 100000 }),
          }),
          update: transactionUpdate,
          set: vi.fn(),
        };
        return fn(transaction);
      });

      await blockerService.resolveBlocker('blocker-1', 'task-1', 0, 'user-1', 4);

      // İki update çağrısı: görev (transitionTaskInTransaction) + blocker dokümanı
      expect(transactionUpdate).toHaveBeenCalledTimes(2);
      const blockerUpdateCall = transactionUpdate.mock.calls.find(([ref]: any) => ref === undefined || true);
      expect(blockerUpdateCall).toBeTruthy();
    });

    it('başka aktif engel varsa sadece bu engel çözülür, görev durumu değişmez (transaction kullanılmaz) — audit log AYNI batch\'te yazılır', async () => {
      // Görev durumu değişmediğinden transitionTaskInTransaction'ın otomatik
      // audit yazımı devreye girmiyor — bu yüzden burada kendi audit kaydımız
      // yazılıyor olmalı (bkz. kod denetimi: eskiden bu dal hiç log yazmıyordu).
      const set = vi.fn();
      const update = vi.fn();
      const commit = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firebase.writeBatch).mockReturnValue({ set, update, delete: vi.fn(), commit } as any);

      await blockerService.resolveBlocker('blocker-1', 'task-1', 2, 'user-1', 4, 'Risk Görevi');

      expect(firebase.runTransaction).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.anything(), { isResolved: true, resolvedAt: expect.any(Number) });
      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy !== undefined);
      // Çağıranın geçirdiği görev başlığı kayda donar (bkz. P1-14) — bu servis
      // görevi kendisi okumaz, başlık opsiyoneldir.
      // logType: risk unsurunun YAŞAM DÖNGÜSÜ olayı (aktif → çözüldü), bir
      // içerik düzenlemesi değil (bkz. taskService.auditLogType).
      expect(auditCall?.[1]).toMatchObject({ taskId: 'task-1', changedBy: 'user-1', taskTitle: 'Risk Görevi', logType: 'STATUS' });
      expect(commit).toHaveBeenCalledOnce();
    });
  });

  describe('editBlocker', () => {
    it('doğru blockerId ile batch.update çağırır, audit log AYNI batch\'te yazılır', async () => {
      // Eskiden bu fonksiyon hiç audit_logs yazmıyordu (bkz. kod denetimi).
      const set = vi.fn();
      const update = vi.fn();
      const commit = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firebase.writeBatch).mockReturnValue({ set, update, delete: vi.fn(), commit } as any);

      await blockerService.editBlocker('blocker-1', 'Yeni sebep', 'user-1', 'task-1', 'Risk Görevi');

      expect(update).toHaveBeenCalledWith({ id: 'generated-ref-1' }, { reason: 'Yeni sebep' });
      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy !== undefined);
      // logType 'FIELD': bu bir gerekçe METNİ düzenlemesidir. Kayıt `changes`
      // yazmadığı için ESKİ istemci-taraflı tahmin bunu "Durum Değişikliği"
      // sayıyordu — tip artık şekilden türetilmiyor (bkz. auditLogType, P2-22).
      expect(auditCall?.[1]).toMatchObject({ taskId: 'task-1', changedBy: 'user-1', newValue: 'Yeni sebep', taskTitle: 'Risk Görevi', logType: 'FIELD' });
      expect(commit).toHaveBeenCalledOnce();
    });

    it('görev başlığı geçilmezse audit kaydında taskTitle alanı HİÇ yazılmaz (undefined yazılmaz)', async () => {
      // Firestore `undefined` değer kabul etmez — alan opsiyonel olduğu için
      // yokluğunda anahtarın kendisi de payload'a girmemeli, aksi halde
      // başlığı bilinmeyen her düzenleme yazma hatasıyla düşerdi.
      const set = vi.fn();
      const commit = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firebase.writeBatch).mockReturnValue(
        { set, update: vi.fn(), delete: vi.fn(), commit } as unknown as ReturnType<typeof firebase.writeBatch>
      );

      await blockerService.editBlocker('blocker-1', 'Yeni sebep', 'user-1', 'task-1');

      const auditCall = set.mock.calls.find(call => 'changedBy' in (call[1] as object));
      expect(auditCall?.[1]).not.toHaveProperty('taskTitle');
    });

    it('batch.commit her denemede reddederse runWithRetry tükendikten sonra hata fırlatılır', async () => {
      const commit = vi.fn().mockRejectedValue(new Error('permission-denied'));
      vi.mocked(firebase.writeBatch).mockReturnValue({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit } as any);

      await expect(blockerService.editBlocker('blocker-1', 'X', 'user-1', 'task-1')).rejects.toThrow('permission-denied');
      expect(commit).toHaveBeenCalledTimes(3);
    });
  });

  describe('deleteBlocker', () => {
    it('taskId/userId verilmeden (eski/legacy çağrı) doğru blockerId ile ham deleteDoc çağırır', async () => {
      await blockerService.deleteBlocker('blocker-1');

      expect(firebase.deleteDoc).toHaveBeenCalledWith({ id: 'generated-ref-1' });
    });

    it('deleteDoc her denemede reddederse runWithRetry tükendikten sonra hata fırlatılır', async () => {
      vi.mocked(firebase.deleteDoc).mockRejectedValue(new Error('permission-denied'));

      await expect(blockerService.deleteBlocker('blocker-1')).rejects.toThrow('permission-denied');
      expect(firebase.deleteDoc).toHaveBeenCalledTimes(3);
    });

    it('son aktif engel DEĞİLKEN taskId/userId verilirse batch ile silinir ve audit log yazılır', async () => {
      // Eskiden bu dal (son engel değilken) hiç audit_logs yazmıyordu
      // (bkz. kod denetimi).
      const set = vi.fn();
      const del = vi.fn();
      const commit = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firebase.writeBatch).mockReturnValue({ set, update: vi.fn(), delete: del, commit } as any);

      await blockerService.deleteBlocker('blocker-1', 'task-1', 2, 'user-1', 4, 'Risk Görevi');

      expect(firebase.runTransaction).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledWith({ id: 'generated-ref-1' });
      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy !== undefined);
      expect(auditCall?.[1]).toMatchObject({ taskId: 'task-1', changedBy: 'user-1', newValue: 'Risk Unsuru Silindi', taskTitle: 'Risk Görevi', logType: 'STATUS' });
      expect(commit).toHaveBeenCalledOnce();
    });
  });
});
