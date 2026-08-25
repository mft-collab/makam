import { describe, it, expect, beforeEach, vi } from 'vitest';
import { userService } from './userService';
import * as firebase from '../firebase';

function makeBatchMock() {
  const set = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const commit = vi.fn().mockResolvedValue(undefined);
  vi.mocked(firebase.writeBatch).mockReturnValue({ set, update, delete: del, commit } as any);
  return { set, update, delete: del, commit };
}

describe('userService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firebase.doc).mockImplementation((_db: any, _col: string, id?: string) => ({ __path: id }) as any);
    vi.mocked(firebase.collection).mockImplementation((_db: any, name: string) => ({ __name: name }) as any);
  });

  describe('addUser', () => {
    it('email küçük harfe çevrilip trim edilerek doküman ID olarak kullanılır', async () => {
      const { set } = makeBatchMock();
      await userService.addUser({ email: '  Ali.Yilmaz@Makam.com  ', fullName: 'Ali Yılmaz', role: 'Staff' }, 'admin-1');

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'users', 'ali.yilmaz@makam.com');
      expect(set).toHaveBeenCalled();
    });

    it('uid alanı geçici olarak normalize edilmiş email\'e eşitlenir', async () => {
      const { set } = makeBatchMock();
      await userService.addUser({ email: 'Manager@Makam.com', fullName: 'Bir Müdür', role: 'Manager' }, 'admin-1');

      const userSetCall = set.mock.calls.find(([, data]: any) => data?.uid !== undefined);
      expect(userSetCall?.[1]).toMatchObject({ uid: 'manager@makam.com', email: 'manager@makam.com' });
    });

    it('geçirilen tüm alanlar (fullName, role, departmentId) dokümana yazılır', async () => {
      const { set } = makeBatchMock();
      await userService.addUser({ email: 'a@b.com', fullName: 'Test Kullanıcı', role: 'Staff', departmentId: 'ops' }, 'admin-1');

      const userSetCall = set.mock.calls.find(([, data]: any) => data?.uid !== undefined);
      expect(userSetCall?.[1]).toMatchObject({ fullName: 'Test Kullanıcı', role: 'Staff', departmentId: 'ops' });
    });

    it('audit_logs kaydı actorId (changedBy) ile aynı batch\'te yazılır', async () => {
      const { set, commit } = makeBatchMock();
      await userService.addUser({ email: 'a@b.com', fullName: 'Test Kullanıcı', role: 'Staff' }, 'admin-1');

      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy !== undefined);
      expect(auditCall?.[1]).toMatchObject({ changedBy: 'admin-1', taskId: 'a@b.com' });
      expect(commit).toHaveBeenCalledOnce();
    });
  });

  describe('updateUser', () => {
    it('doğru userId ile doc referansı oluşturup batch.update çağırır', async () => {
      const { update } = makeBatchMock();
      await userService.updateUser('user-123', { fullName: 'Yeni İsim' }, 'admin-1');

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'users', 'user-123');
      expect(update).toHaveBeenCalledWith({ __path: 'user-123' }, { fullName: 'Yeni İsim' });
    });

    it('kısmi güncelleme verisini olduğu gibi (normalize etmeden) iletir', async () => {
      const { update } = makeBatchMock();
      await userService.updateUser('user-123', { role: 'Manager' }, 'admin-1');

      expect(update).toHaveBeenCalledWith(expect.anything(), { role: 'Manager' });
    });

    it('audit_logs kaydı değişen alanları (changes) ve actorId\'yi taşır', async () => {
      const { set } = makeBatchMock();
      await userService.updateUser('user-123', { role: 'Manager' }, 'admin-1');

      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy !== undefined);
      expect(auditCall?.[1]).toMatchObject({
        taskId: 'user-123',
        changedBy: 'admin-1',
        changes: { role: { old: null, new: 'Manager' } },
      });
    });
  });

  describe('deleteUser', () => {
    it('doğru userId ile doc referansı oluşturup batch.delete çağırır', async () => {
      const { delete: del } = makeBatchMock();
      await userService.deleteUser('user-123', 'admin-1');

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'users', 'user-123');
      expect(del).toHaveBeenCalledWith({ __path: 'user-123' });
    });

    it('audit_logs kaydı silme işlemiyle AYNI batch\'te yazılır', async () => {
      const { set, commit } = makeBatchMock();
      await userService.deleteUser('user-123', 'admin-1');

      const auditCall = set.mock.calls.find(([, data]: any) => data?.changedBy !== undefined);
      expect(auditCall?.[1]).toMatchObject({ taskId: 'user-123', changedBy: 'admin-1', newValue: 'Personel Silindi' });
      expect(commit).toHaveBeenCalledOnce();
    });
  });

  describe('hata yayılımı', () => {
    it('batch.commit her denemede reddedilirse addUser, runWithRetry tükendikten sonra hatayı fırlatır', async () => {
      // addUser artık runWithRetry (3 deneme) ile sarmalı — kalıcı bir hatanın
      // gerçekten dışa fırlatıldığını doğrulamak için TÜM denemelerin reddetmesi
      // gerekir (mockRejectedValueOnce yalnızca 1. denemeyi reddedip 2.
      // denemede varsayılan olarak "resolve" ederdi, bu da testi yanlışlıkla
      // geçirirdi).
      const commit = vi.fn().mockRejectedValue(new Error('permission-denied'));
      vi.mocked(firebase.writeBatch).mockReturnValue({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit } as any);

      await expect(
        userService.addUser({ email: 'a@b.com', fullName: 'X', role: 'Staff' }, 'admin-1')
      ).rejects.toThrow('permission-denied');
      expect(commit).toHaveBeenCalledTimes(3);
    });
  });
});
