import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  departmentService,
  isUsableAsDepartmentId,
  normalizeDepartmentName,
} from './departmentService';
import * as firebase from '../firebase';
import type { Department } from '../types';

type DocRefStub = { __col: string; __id?: string };
type SnapshotDocStub = { id: string; data: () => Record<string, unknown> };

const mockedDoc = vi.mocked(firebase.doc) as unknown as {
  mockImplementation: (fn: (db: unknown, col: string, id?: string) => DocRefStub) => void;
};
const mockedCollection = vi.mocked(firebase.collection) as unknown as {
  mockImplementation: (fn: (db: unknown, name: string) => { __name: string }) => void;
};
const mockedSetDoc = vi.mocked(firebase.setDoc) as unknown as {
  mockResolvedValue: (v: undefined) => void;
  mock: { calls: unknown[][] };
};
const mockedGetDocs = vi.mocked(firebase.getDocs) as unknown as {
  mockResolvedValue: (v: { docs: SnapshotDocStub[] }) => void;
};
const mockedOnSnapshot = vi.mocked(firebase.onSnapshot) as unknown as {
  mockImplementation: (
    fn: (
      q: unknown,
      onNext: (snap: { docs: SnapshotDocStub[] }) => void,
      onError: (e: unknown) => void
    ) => () => void
  ) => void;
};

const snapshotDoc = (id: string, data: Record<string, unknown>): SnapshotDocStub => ({
  id,
  data: () => data,
});

describe('departmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDoc.mockImplementation((_db, col, id) => ({ __col: col, __id: id }));
    mockedCollection.mockImplementation((_db, name) => ({ __name: name }));
    mockedSetDoc.mockResolvedValue(undefined);
  });

  describe('isUsableAsDepartmentId', () => {
    it('Türkçe karakter ve boşluk içeren adları kabul eder', () => {
      // Doküman ID'si departmanın KENDİ değeridir; ASCII'ye daraltmak mevcut
      // üretim departmanlarının çoğunu taşınamaz kılardı.
      expect(isUsableAsDepartmentId('İnsan Kaynakları')).toBe(true);
      expect(isUsableAsDepartmentId('Operasyon')).toBe(true);
    });

    it('Firestore doküman ID kısıtlarını ihlal eden adları reddeder', () => {
      expect(isUsableAsDepartmentId('Operasyon/Lojistik')).toBe(false);
      expect(isUsableAsDepartmentId('.')).toBe(false);
      expect(isUsableAsDepartmentId('..')).toBe(false);
      expect(isUsableAsDepartmentId('__proto__')).toBe(false);
      expect(isUsableAsDepartmentId('')).toBe(false);
      expect(isUsableAsDepartmentId('x'.repeat(101))).toBe(false);
    });
  });

  describe('normalizeDepartmentName', () => {
    it('yalnızca baştaki/sondaki boşluğu kırpar', () => {
      expect(normalizeDepartmentName('  Operasyon  ')).toBe('Operasyon');
    });

    it('büyük/küçük harfi DEĞİŞTİRMEZ (değer aynı zamanda doküman ID\'sidir)', () => {
      // Normalize edilmiş bir ad, mevcut tasks/users kayıtlarındaki ham
      // string değerle eşleşmez ve sessizce yeni bir departman üretirdi.
      expect(normalizeDepartmentName('OPERASYON')).toBe('OPERASYON');
    });
  });

  describe('createDepartment', () => {
    it('doküman ID olarak adın kendisini kullanır ve şemaya uygun alanları yazar', async () => {
      await departmentService.createDepartment('  Operasyon  ', 'admin-1');

      expect(firebase.doc).toHaveBeenCalledWith(firebase.db, 'departments', 'Operasyon');
      const [, data] = mockedSetDoc.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(data).toMatchObject({ name: 'Operasyon', createdBy: 'admin-1' });
      expect(data.createdAt).toBeTypeOf('number');
    });

    it('name alanı doküman ID ile birebir aynı yazılır (hayalet departman koruması)', async () => {
      await departmentService.createDepartment('İnsan Kaynakları', 'admin-1');
      const [ref, data] = mockedSetDoc.mock.calls[0] as [DocRefStub, Record<string, unknown>];
      expect(ref.__id).toBe('İnsan Kaynakları');
      expect(data.name).toBe('İnsan Kaynakları');
    });

    it('geçersiz ad (eğik çizgi) için yazma denemeden hata fırlatır', async () => {
      await expect(departmentService.createDepartment('Operasyon/Lojistik', 'admin-1')).rejects.toThrow(/geçersiz/i);
      expect(firebase.setDoc).not.toHaveBeenCalled();
    });

    it('zaten var olan bir birim için YENİDEN YAZMAZ (createdAt kuralı korunur)', async () => {
      const existing: Department[] = [{ id: 'Operasyon', name: 'Operasyon', createdAt: 1, createdBy: 'admin-1' }];
      const result = await departmentService.createDepartment('Operasyon', 'admin-2', existing);

      expect(result).toBe('Operasyon');
      expect(firebase.setDoc).not.toHaveBeenCalled();
    });
  });

  describe('okuma', () => {
    it('listAll doküman ID\'sini id VE name olarak doldurur, Türkçe sıralar', async () => {
      mockedGetDocs.mockResolvedValue({
        docs: [
          snapshotDoc('Zabıta', { name: 'Zabıta', createdAt: 2, createdBy: 'admin-1' }),
          snapshotDoc('Çevre', { name: 'Çevre', createdAt: 1, createdBy: 'admin-1' }),
        ],
      });

      const list = await departmentService.listAll();

      expect(list.map(d => d.id)).toEqual(['Çevre', 'Zabıta']);
      expect(list[0]).toMatchObject({ id: 'Çevre', name: 'Çevre' });
    });

    it('name alanı eksik bir eski kayıtta doküman ID\'si ada düşer', async () => {
      mockedGetDocs.mockResolvedValue({
        docs: [snapshotDoc('Operasyon', { createdAt: 1, createdBy: 'admin-1' })],
      });

      const list = await departmentService.listAll();
      expect(list[0]?.name).toBe('Operasyon');
    });

    it('subscribe, snapshot verisini sıralanmış olarak iletir ve aboneliği döndürür', () => {
      const unsubscribe = vi.fn();
      mockedOnSnapshot.mockImplementation((_q, onNext) => {
        onNext({
          docs: [
            snapshotDoc('Operasyon', { name: 'Operasyon', createdAt: 2, createdBy: 'admin-1' }),
            snapshotDoc('Basın', { name: 'Basın', createdAt: 1, createdBy: 'admin-1' }),
          ],
        });
        return unsubscribe;
      });

      const onNext = vi.fn();
      const stop = departmentService.subscribe(onNext, vi.fn());

      expect(onNext).toHaveBeenCalledOnce();
      const emitted = onNext.mock.calls[0]?.[0] as Department[];
      expect(emitted.map(d => d.id)).toEqual(['Basın', 'Operasyon']);

      stop();
      expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('subscribe hata geri çağrısını dışarı iletir', () => {
      mockedOnSnapshot.mockImplementation((_q, _onNext, onError) => {
        onError(new Error('izin yok'));
        return vi.fn();
      });

      const onError = vi.fn();
      departmentService.subscribe(vi.fn(), onError);

      expect(onError).toHaveBeenCalledOnce();
    });
  });
});
