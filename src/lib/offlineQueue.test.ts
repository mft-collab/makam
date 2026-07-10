import { describe, it, expect, beforeEach, vi } from 'vitest';
import { offlineQueue, OfflineMutation } from '../lib/offlineQueue';

// addDoc, updateDoc vb. mock'ları setup.ts'den geliyor
import * as firebase from '../firebase';

describe('OfflineQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    // isSyncing mutex'ini sıfırlamak için modülü yeniden import etmek yerine
    // localStorage temizliyoruz ve queue sıfırlıyoruz
    vi.clearAllMocks();
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
});
