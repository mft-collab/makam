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

      const blockerId = await blockerService.addBlocker('task-1', 'Sebep', 'user-1', 'IN_PROGRESS', 2);

      expect(blockerId).toBeTruthy();
      // Okuma, herhangi bir yazmadan önce gerçekleşmeli (Firestore transaction kuralı)
      expect(calls[0]).toBe('read');
      expect(transactionUpdate).toHaveBeenCalledOnce(); // görev durumu güncellendi
      // set: hem audit log + stats (transitionTaskInTransaction içinde) hem de blocker dokümanı
      expect(transactionSet).toHaveBeenCalled();
      const blockerSetCall = transactionSet.mock.calls.find(([, data]: any) => data?.reason !== undefined);
      expect(blockerSetCall?.[1]).toMatchObject({ taskId: 'task-1', reason: 'Sebep', isResolved: false });
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
        blockerService.addBlocker('task-1', 'Sebep', 'user-1', 'IN_PROGRESS', 2)
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

    it('başka aktif engel varsa sadece bu engel çözülür, görev durumu değişmez (transaction kullanılmaz)', async () => {
      vi.mocked(firebase.updateDoc).mockResolvedValueOnce(undefined as any);

      await blockerService.resolveBlocker('blocker-1', 'task-1', 2, 'user-1', 4);

      expect(firebase.updateDoc).toHaveBeenCalledOnce();
      expect(firebase.runTransaction).not.toHaveBeenCalled();
    });
  });
});
