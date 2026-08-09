import { describe, it, expect, beforeEach, vi } from 'vitest';
import { userService } from './userService';
import * as firebase from '../firebase';

describe('userService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firebase.doc).mockImplementation((_db: any, _col: string, id: string) => ({ __path: id }) as any);
  });

  describe('addUser', () => {
    it('email küçük harfe çevrilip trim edilerek doküman ID olarak kullanılır', async () => {
      await userService.addUser({ email: '  Ali.Yilmaz@Makam.com  ', fullName: 'Ali Yılmaz', role: 'Staff' });

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'users', 'ali.yilmaz@makam.com');
    });

    it('uid alanı geçici olarak normalize edilmiş email\'e eşitlenir', async () => {
      await userService.addUser({ email: 'Manager@Makam.com', fullName: 'Bir Müdür', role: 'Manager' });

      expect(firebase.setDoc).toHaveBeenCalledOnce();
      const [, data] = vi.mocked(firebase.setDoc).mock.calls[0]!;
      expect(data).toMatchObject({ uid: 'manager@makam.com', email: 'manager@makam.com' });
    });

    it('geçirilen tüm alanlar (fullName, role, departmentId) dokümana yazılır', async () => {
      await userService.addUser({ email: 'a@b.com', fullName: 'Test Kullanıcı', role: 'Staff', departmentId: 'ops' });

      const [, data] = vi.mocked(firebase.setDoc).mock.calls[0]!;
      expect(data).toMatchObject({ fullName: 'Test Kullanıcı', role: 'Staff', departmentId: 'ops' });
    });
  });

  describe('updateUser', () => {
    it('doğru userId ile doc referansı oluşturup updateDoc çağırır', async () => {
      await userService.updateUser('user-123', { fullName: 'Yeni İsim' });

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'users', 'user-123');
      expect(firebase.updateDoc).toHaveBeenCalledWith({ __path: 'user-123' }, { fullName: 'Yeni İsim' });
    });

    it('kısmi güncelleme verisini olduğu gibi (normalize etmeden) iletir', async () => {
      await userService.updateUser('user-123', { role: 'Manager' });

      expect(firebase.updateDoc).toHaveBeenCalledWith(expect.anything(), { role: 'Manager' });
    });
  });

  describe('deleteUser', () => {
    it('doğru userId ile doc referansı oluşturup deleteDoc çağırır', async () => {
      await userService.deleteUser('user-123');

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'users', 'user-123');
      expect(firebase.deleteDoc).toHaveBeenCalledWith({ __path: 'user-123' });
    });
  });

  describe('hata yayılımı', () => {
    it('setDoc her denemede reddedilirse addUser, runWithRetry tükendikten sonra hatayı fırlatır', async () => {
      // addUser artık runWithRetry (3 deneme) ile sarmalı — kalıcı bir hatanın
      // gerçekten dışa fırlatıldığını doğrulamak için TÜM denemelerin reddetmesi
      // gerekir (mockRejectedValueOnce yalnızca 1. denemeyi reddedip 2.
      // denemede varsayılan olarak "resolve" ederdi, bu da testi yanlışlıkla
      // geçirirdi).
      vi.mocked(firebase.setDoc).mockRejectedValue(new Error('permission-denied'));

      await expect(
        userService.addUser({ email: 'a@b.com', fullName: 'X', role: 'Staff' })
      ).rejects.toThrow('permission-denied');
      expect(firebase.setDoc).toHaveBeenCalledTimes(3);
    });
  });
});
