import { describe, it, expect, beforeEach, vi } from 'vitest';
import { taskService, transitionTaskInTransaction } from './taskService';
import * as firebase from '../firebase';
import type { Task } from '../types';

let refCounter = 0;

function makeTransactionMock(taskData: Partial<Task> & { exists?: boolean }) {
  const update = vi.fn();
  const set = vi.fn();
  const get = vi.fn().mockResolvedValue({
    exists: () => taskData.exists !== false,
    data: () => taskData,
  });
  return { transaction: { get, update, set } as any, update, set, get };
}

describe('taskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refCounter = 0;
    vi.mocked(firebase.doc).mockImplementation(() => ({ id: `ref-${++refCounter}` }) as any);
    vi.mocked(firebase.collection).mockImplementation((_db: any, name: string) => ({ __name: name }) as any);
    vi.mocked(firebase.increment).mockImplementation((n: number) => ({ __increment: n }) as any);
  });

  // ─── transitionTaskInTransaction — SLA / kilit / iş kuralı mantığı ─────────

  describe('transitionTaskInTransaction (görev geçişi çekirdek mantığı)', () => {
    it('lockVersion artırılır, audit log ve stats aynı transaction içinde yazılır', async () => {
      const { transaction, update, set } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 2, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'COMPLETED', 'user-1', {});

      expect(update).toHaveBeenCalledOnce();
      const [, updateData] = update.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'COMPLETED', lockVersion: 3 });
      expect(updateData.completedAt).toBeTypeOf('number');

      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy === 'user-1');
      expect(auditCall?.[1]).toMatchObject({
        taskId: 'task-1', oldValue: 'IN_PROGRESS', newValue: 'COMPLETED',
        changes: { status: { old: 'IN_PROGRESS', new: 'COMPLETED' } },
      });

      const statsCall = set.mock.calls.find(([, data]: any) => 'status_IN_PROGRESS' in (data ?? {}));
      expect(statsCall?.[1]).toMatchObject({
        status_IN_PROGRESS: { __increment: -1 },
        status_COMPLETED: { __increment: 1 },
      });
    });

    it('BLOCKED durumuna geçişte pausedAt şimdiki zamana ayarlanır (SLA duraklatılır)', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });
      const before = Date.now();

      await transitionTaskInTransaction(transaction, 'task-1', 'BLOCKED', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.pausedAt).toBeGreaterThanOrEqual(before);
      expect(updateData.pausedAt).toBeLessThanOrEqual(Date.now());
    });

    it('BLOCKED durumundan çıkışta duraklama süresi totalPausedTime\'a eklenir ve pausedAt sıfırlanır', async () => {
      const pausedAt = Date.now() - 5000;
      const { transaction, update } = makeTransactionMock({
        status: 'BLOCKED', lockVersion: 1, totalPausedTime: 1000, pausedAt, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'IN_PROGRESS', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.pausedAt).toBeNull();
      // 1000 (mevcut) + ~5000 (duraklama süresi) — küçük zamanlama toleransı
      expect(updateData.totalPausedTime).toBeGreaterThanOrEqual(1000 + 5000 - 50);
    });

    it('AWAITING_APPROVAL/PENDING_DELEGATION durumlarına geçişte de aynı şekilde duraklatılır', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'PENDING_DELEGATION', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.pausedAt).toBeTypeOf('number');
    });

    it('kriz döneminden IN_PROGRESS\'e dönüşte ihlal borcu + 24 saat totalPausedTime\'a eklenir', async () => {
      const now = Date.now();
      const deadline = now - 10_000; // 10 saniye önce geçmiş — görev kriz halinde
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'IN_PROGRESS', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      // extraTime ≈ (now - deadline) + 24 saat ≈ 10.000ms + 86.400.000ms
      expect(updateData.totalPausedTime).toBeGreaterThan(24 * 60 * 60 * 1000);
    });

    it('deadline geçmemişse (kriz değilse) IN_PROGRESS\'e dönüş totalPausedTime\'ı etkilemez', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'ASSIGNED', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'IN_PROGRESS', 'user-1', {});

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.totalPausedTime).toBe(0);
    });

    it('expectedVersion sunucu versiyonuyla uyuşmazsa VERSION_MISMATCH fırlatılır, hiçbir yazma yapılmaz', async () => {
      const { transaction, update, set } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 5, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await expect(
        transitionTaskInTransaction(transaction, 'task-1', 'COMPLETED', 'user-1', { expectedVersion: 3 })
      ).rejects.toThrow(/VERSION_MISMATCH/);

      expect(update).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it('görev bulunamazsa hata fırlatılır', async () => {
      const { transaction } = makeTransactionMock({ exists: false });

      await expect(
        transitionTaskInTransaction(transaction, 'missing-task', 'COMPLETED', 'user-1', {})
      ).rejects.toThrow('Task does not exist');
    });

    it('kanıt (evidence) verilirse güncelleme verisine eklenir', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'AWAITING_APPROVAL', 'user-1', {
        evidence: 'https://ornek.com/kanit', evidenceType: 'Link',
      });

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData).toMatchObject({ evidence: 'https://ornek.com/kanit', evidenceType: 'Link' });
    });

    it('yeni sorumlu (assigneeId) verilirse görev devri uygulanır', async () => {
      const { transaction, update } = makeTransactionMock({
        status: 'IN_PROGRESS', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
      });

      await transitionTaskInTransaction(transaction, 'task-1', 'PENDING_DELEGATION', 'user-1', {
        assigneeId: 'new-manager-uid',
      });

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.assigneeId).toBe('new-manager-uid');
    });
  });

  // ─── taskService.transitionTask / updateTaskStatus / delegateTask (public API) ──

  describe('taskService.transitionTask (retry sarmalayıcı üzerinden)', () => {
    it('runTransaction çağrısını transitionTaskInTransaction ile yapar', async () => {
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const { transaction } = makeTransactionMock({
          status: 'ASSIGNED', lockVersion: 0, totalPausedTime: 0, deadline: Date.now() + 100_000,
        });
        return fn(transaction);
      });

      await expect(taskService.transitionTask('task-1', 'IN_PROGRESS', 'user-1')).resolves.toBeDefined();
    });
  });

  describe('taskService.delegateTask', () => {
    it('yeni sorumluyu atar ve durumu PENDING_DELEGATION yapar', async () => {
      let capturedTransaction: any;
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => {
        const mock = makeTransactionMock({
          status: 'IN_PROGRESS', lockVersion: 4, totalPausedTime: 0, deadline: Date.now() + 100_000,
        });
        capturedTransaction = mock;
        return fn(mock.transaction);
      });

      await taskService.delegateTask('task-1', 'manager-2', 'user-1', 4);

      const [, updateData] = capturedTransaction.update.mock.calls[0]!;
      expect(updateData).toMatchObject({ status: 'PENDING_DELEGATION', assigneeId: 'manager-2', lockVersion: 5 });
    });
  });

  // ─── createTask — iş kuralları ──────────────────────────────────────────────

  describe('createTask', () => {
    it('Admin rolündeki kullanıcı irtibatlı olarak atanamaz', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Admin' }) } as any);

      await expect(
        taskService.createTask({ title: 'Test', coordinatorId: 'admin-uid' }, 'user-1')
      ).rejects.toThrow(/Admin rolündeki kullanıcı irtibatlı/);

      expect(firebase.addDoc).not.toHaveBeenCalled();
    }, 10_000);

    it('alt talimat yalnızca Staff (memur) rolüne atanabilir', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Manager' }) } as any);

      await expect(
        taskService.createTask({ title: 'Alt görev', parentId: 'parent-1', assigneeId: 'manager-uid' }, 'user-1')
      ).rejects.toThrow(/yalnızca memur/);

      expect(firebase.addDoc).not.toHaveBeenCalled();
    }, 10_000);

    it('başarılı oluşturmada lockVersion=0, totalPausedTime=0 ile kaydedilir; stats ve audit log yazılır', async () => {
      const fakeTaskRef = { id: 'new-task-id' };
      vi.mocked(firebase.addDoc).mockImplementation(async (col: any) => {
        return col?.__name === 'tasks' ? fakeTaskRef : { id: 'audit-id' };
      });
      vi.mocked(firebase.updateDoc).mockResolvedValue(undefined as any);
      vi.mocked(firebase.setDoc).mockResolvedValue(undefined as any);

      const id = await taskService.createTask({ title: 'Yeni Görev', priority: 'Medium' }, 'user-1');

      expect(id).toBe('new-task-id');
      const taskCreateCall = vi.mocked(firebase.addDoc).mock.calls.find(([col]: any) => col?.__name === 'tasks');
      expect(taskCreateCall?.[1]).toMatchObject({ status: 'ASSIGNED', lockVersion: 0, totalPausedTime: 0 });

      expect(firebase.setDoc).toHaveBeenCalledOnce();
      const [, statsData] = vi.mocked(firebase.setDoc).mock.calls[0]!;
      expect(statsData).toMatchObject({ totalTasks: { __increment: 1 }, status_ASSIGNED: { __increment: 1 } });
    });
  });

  // ─── updateTask — versiyon kontrolü + alan bazlı diff ──────────────────────

  describe('updateTask', () => {
    it('Admin rolündeki kullanıcı koordinatör olarak atanamaz', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => true, data: () => ({ role: 'Admin' }) } as any);
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 1 } as Task;

      await expect(
        taskService.updateTask('task-1', { coordinatorId: 'admin-uid' }, oldTask, 'user-1')
      ).rejects.toThrow(/Admin rolündeki kullanıcı koordinatör/);
    }, 10_000);

    it('sunucu versiyonu beklenenle uyuşmazsa güncelleme uygulanmaz', async () => {
      const { transaction, update } = makeTransactionMock({ status: 'IN_PROGRESS', lockVersion: 7 });
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 2 } as Task;

      await expect(
        taskService.updateTask('task-1', { title: 'Güncel Başlık' }, oldTask, 'user-1')
      ).rejects.toThrow(/VERSION_MISMATCH/);

      expect(update).not.toHaveBeenCalled();
    }, 10_000);

    it('alan bazlı audit diff eski/yeni değerleri doğru eşler', async () => {
      const { transaction, set } = makeTransactionMock({ status: 'IN_PROGRESS', lockVersion: 3 });
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 3, title: 'Eski Başlık' } as Task;

      await taskService.updateTask('task-1', { title: 'Yeni Başlık' }, oldTask, 'user-1');

      const auditCall = set.mock.calls.find(([, data]: any) => data?.changes?.title);
      expect(auditCall?.[1].changes.title).toEqual({ old: 'Eski Başlık', new: 'Yeni Başlık' });
    });

    it('durum değişikliği varsa stats deltası aynı transaction\'da yazılır, yoksa yazılmaz', async () => {
      const { transaction, set } = makeTransactionMock({ status: 'IN_PROGRESS', lockVersion: 1 });
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => fn(transaction));
      const oldTask = { id: 'task-1', status: 'IN_PROGRESS', lockVersion: 1 } as Task;

      await taskService.updateTask('task-1', { status: 'COMPLETED' }, oldTask, 'user-1');

      const statsCall = set.mock.calls.find(([, data]: any) => 'status_IN_PROGRESS' in (data ?? {}));
      expect(statsCall?.[1]).toMatchObject({
        status_IN_PROGRESS: { __increment: -1 },
        status_COMPLETED: { __increment: 1 },
      });
    });
  });

  // ─── addComment — versiyon kontrolü ─────────────────────────────────────────

  describe('addComment', () => {
    it('sunucu versiyonu uyuşmazsa yorum eklenmez', async () => {
      const { transaction, update } = makeTransactionMock({ lockVersion: 4, comments: [] });
      vi.mocked(firebase.runTransaction).mockImplementation(async (_db: any, fn: any) => fn(transaction));

      await expect(
        taskService.addComment('task-1', 'user-1', 'Merhaba', 2)
      ).rejects.toThrow(/VERSION_MISMATCH/);

      expect(update).not.toHaveBeenCalled();
    }, 10_000);

    it('yorum mevcut listeye eklenir ve lockVersion artırılır', async () => {
      const { transaction, update } = makeTransactionMock({ lockVersion: 4, comments: [{ userId: 'u0', text: 'ilk', timestamp: 1 }] });
      vi.mocked(firebase.runTransaction).mockImplementationOnce(async (_db: any, fn: any) => fn(transaction));

      await taskService.addComment('task-1', 'user-1', 'Yeni yorum', 4);

      const [, updateData] = update.mock.calls[0]!;
      expect(updateData.lockVersion).toBe(5);
      expect(updateData.comments).toHaveLength(2);
      expect(updateData.comments[1]).toMatchObject({ userId: 'user-1', text: 'Yeni yorum' });
    });
  });

  // ─── deleteTask — kademeli silme + istatistik ───────────────────────────────

  describe('deleteTask', () => {
    it('görev yoksa hiçbir batch commit edilmez', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({ exists: () => false } as any);
      vi.mocked(firebase.getDocs).mockResolvedValue({ docs: [] } as any);

      await taskService.deleteTask('missing-task', 'user-1');

      expect(firebase.writeBatch).not.toHaveBeenCalled();
    });

    it('alt görevi olmayan bir görev silindiğinde: görev + engeller silinir, audit log korunur, stats düşürülür', async () => {
      vi.mocked(firebase.getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ status: 'IN_PROGRESS', title: 'Silinecek Görev' }),
      } as any);
      // Alt görev sorgusu boş, engel sorgusu bir kayıt döner
      vi.mocked(firebase.getDocs)
        .mockResolvedValueOnce({ docs: [] } as any) // alt görevler
        .mockResolvedValueOnce({ docs: [{ ref: { id: 'blocker-1' } }] } as any); // engeller

      const batchDelete = vi.fn();
      const batchSet = vi.fn();
      const batchCommit = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firebase.writeBatch).mockReturnValue({ delete: batchDelete, set: batchSet, commit: batchCommit } as any);

      await taskService.deleteTask('task-1', 'user-1');

      // Görev + 1 engel silindi
      expect(batchDelete).toHaveBeenCalledTimes(2);
      // Audit log SİLİNMEDİ, yeni bir "silindi" kaydı EKLENDİ
      const auditSetCall = batchSet.mock.calls.find(([, data]: any) => data?.newValue === 'Silindi');
      expect(auditSetCall).toBeTruthy();
      // Stats: bu görevin durumu (IN_PROGRESS) için -1
      const statsSetCall = batchSet.mock.calls.find(([, data]: any) => 'status_IN_PROGRESS' in (data ?? {}));
      expect(statsSetCall?.[1]).toMatchObject({
        totalTasks: { __increment: -1 },
        status_IN_PROGRESS: { __increment: -1 },
      });
      expect(batchCommit).toHaveBeenCalledOnce();
    });
  });
});
