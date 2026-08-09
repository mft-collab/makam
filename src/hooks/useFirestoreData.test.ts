import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFirestoreData } from './useFirestoreData';
import * as firebase from '../firebase';
import { useDataStore } from '../store/dataStore';
import type { User } from '../types';

// Gerçek dataStore, idb-keyval (IndexedDB) persist middleware'i taşıyor —
// jsdom'da IndexedDB olmadığından hook testinde tüm store mock'lanır.
vi.mock('../store/dataStore', () => ({ useDataStore: vi.fn() }));

type SnapshotCallback = (snap: any) => void;
type ErrorCallback = (err: any) => void;
interface CapturedListener { onNext: SnapshotCallback; onErrorCb: ErrorCallback }

const mockDocSnap = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
const mockQuerySnap = (docs: Array<{ id: string; data: () => Record<string, unknown> }>) => ({ docs });

const validTaskDoc = (id: string, overrides: Record<string, unknown> = {}) => mockDocSnap(id, {
  title: 'Talimat', description: 'Açıklama', creatorId: 'creator-1', assigneeId: 'assignee-1',
  status: 'ASSIGNED', priority: 'Medium', deadline: 1000, createdAt: 1000, updatedAt: 1000,
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  uid: 'user-1', fullName: 'Test Kullanıcı', email: 'test@makam.com', role: 'Staff', ...overrides,
});

describe('useFirestoreData', () => {
  // Effect'ler kod içinde sabit sırada tanımlı: 1. tasks listener, sonra
  // sırasıyla users/blockers/stats — bu yüzden listeners[0..3] her zaman bu
  // sırayla dolar (bkz. useFirestoreData.ts effect tanım sırası).
  let listeners: CapturedListener[] = [];
  let unsubs: ReturnType<typeof vi.fn>[] = [];
  let dataStoreMock: Record<string, unknown>;
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listeners = [];
    unsubs = [];

    vi.mocked(firebase.onSnapshot).mockImplementation((_queryOrRef: any, onNext: any, onErrorCb: any) => {
      const unsub = vi.fn();
      listeners.push({ onNext, onErrorCb });
      unsubs.push(unsub);
      return unsub;
    });
    vi.mocked(firebase.collection).mockImplementation((_db: any, name: string) => ({ __name: name }) as any);
    vi.mocked(firebase.query).mockImplementation((...args: any[]) => ({ __query: args }) as any);
    vi.mocked(firebase.where).mockImplementation((...args: any[]) => ({ __where: args }) as any);
    vi.mocked(firebase.or).mockImplementation((...args: any[]) => ({ __or: args }) as any);
    vi.mocked(firebase.orderBy).mockImplementation((...args: any[]) => ({ __orderBy: args }) as any);
    vi.mocked(firebase.limit).mockImplementation((n: number) => ({ __limit: n }) as any);
    vi.mocked(firebase.doc).mockImplementation((...args: any[]) => ({ __doc: args }) as any);

    dataStoreMock = {
      tasks: [], users: [], blockers: [], isHydrated: true, taskLimit: 200,
      setTasks: vi.fn(), setUsers: vi.fn(), setBlockers: vi.fn(), setStats: vi.fn(),
    };
    vi.mocked(useDataStore).mockReturnValue(dataStoreMock as any);
  });

  describe('görev sorgusu — rol bazlı dallanma', () => {
    it('Admin: assigneeId filtresi/or() kullanılmaz, tüm görevler updatedAt desc + limit ile çekilir', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      expect(firebase.orderBy).toHaveBeenCalledWith('updatedAt', 'desc');
      expect(firebase.limit).toHaveBeenCalledWith(200);
      expect(firebase.or).not.toHaveBeenCalled();
      expect(vi.mocked(firebase.where).mock.calls.some(c => c[0] === 'assigneeId')).toBe(false);
    });

    it('Staff: assigneeId in [uid, email] filtresi kullanılır, or() çağrılmaz', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Staff', uid: 'staff-1', email: 'staff@makam.com' }), onError));

      expect(firebase.where).toHaveBeenCalledWith('assigneeId', 'in', ['staff-1', 'staff@makam.com']);
      expect(firebase.or).not.toHaveBeenCalled();
    });

    it('Manager + departmentId: or(departmentId==, assigneeId in) kullanılır', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Manager', departmentId: 'ops' }), onError));

      expect(firebase.or).toHaveBeenCalledOnce();
      expect(firebase.where).toHaveBeenCalledWith('departmentId', '==', 'ops');
      expect(firebase.where).toHaveBeenCalledWith('assigneeId', 'in', expect.any(Array));
    });

    it('Manager + departmentId yok: or() çağrılmaz, yalnızca assigneeId in filtresi kullanılır', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Manager', departmentId: undefined }), onError));

      expect(firebase.or).not.toHaveBeenCalled();
      expect(firebase.where).toHaveBeenCalledWith('assigneeId', 'in', expect.any(Array));
    });

    it('user null ise hiçbir listener kurulmaz', () => {
      renderHook(() => useFirestoreData(null, onError));

      expect(firebase.onSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('tasks listener — veri işleme', () => {
    it('gelen görevler updatedAt\'e göre azalan sırada setTasks\'e verilir', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      act(() => {
        listeners[0]!.onNext(mockQuerySnap([
          validTaskDoc('t1', { updatedAt: 100 }),
          validTaskDoc('t2', { updatedAt: 300 }),
          validTaskDoc('t3', { updatedAt: 200 }),
        ]));
      });

      const [sorted] = vi.mocked(dataStoreMock.setTasks as any).mock.calls[0]!;
      expect(sorted.map((t: { id: string }) => t.id)).toEqual(['t2', 't3', 't1']);
    });

    it('şemaya uymayan bir doküman listeden düşürülmez, sadece konsola uyarı yazılır', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      act(() => {
        listeners[0]!.onNext(mockQuerySnap([mockDocSnap('bad-task', { title: '' })]));
      });

      expect(warnSpy).toHaveBeenCalled();
      const [list] = vi.mocked(dataStoreMock.setTasks as any).mock.calls[0]!;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('bad-task');

      warnSpy.mockRestore();
    });

    it('tasks listener hata verirse onError(e, \'list\', \'tasks\') çağrılır', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));
      const err = new Error('permission-denied');

      act(() => { listeners[0]!.onErrorCb(err); });

      expect(onError).toHaveBeenCalledWith(err, 'list', 'tasks');
    });
  });

  describe('users listener — tekilleştirme', () => {
    it('aynı email\'e sahip iki kayıt tekilleştirilir; geçici (email-benzeri) uid yerine gerçek uid tercih edilir', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      act(() => {
        listeners[1]!.onNext(mockQuerySnap([
          mockDocSnap('temp-doc', { uid: 'ali@makam.com', fullName: 'Ali', email: 'Ali@Makam.com', role: 'Staff' }),
          mockDocSnap('real-doc', { uid: 'real-uid-123', fullName: 'Ali', email: 'ali@makam.com', role: 'Staff' }),
        ]));
      });

      const [list] = vi.mocked(dataStoreMock.setUsers as any).mock.calls[0]!;
      expect(list).toHaveLength(1);
      expect(list[0].uid).toBe('real-uid-123');
    });

    it('users listener hata verirse onError(e, \'list\', \'users\') çağrılır', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));
      const err = new Error('permission-denied');

      act(() => { listeners[1]!.onErrorCb(err); });

      expect(onError).toHaveBeenCalledWith(err, 'list', 'users');
    });
  });

  describe('blockers listener', () => {
    it('sorgu isResolved=false filtresi ve limit(100) ile kurulur', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      expect(firebase.where).toHaveBeenCalledWith('isResolved', '==', false);
      expect(firebase.limit).toHaveBeenCalledWith(100);
    });

    it('gelen dokümanlar doğrudan setBlockers\'a iletilir', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      act(() => {
        listeners[2]!.onNext(mockQuerySnap([mockDocSnap('b1', { taskId: 't1', reason: 'x', isResolved: false, createdAt: 1 })]));
      });

      const [list] = vi.mocked(dataStoreMock.setBlockers as any).mock.calls[0]!;
      expect(list).toEqual([{ id: 'b1', taskId: 't1', reason: 'x', isResolved: false, createdAt: 1 }]);
    });
  });

  describe('stats listener', () => {
    it('doküman varsa setStats çağrılır', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      act(() => { listeners[3]!.onNext({ exists: () => true, data: () => ({ totalTasks: 5 }) }); });

      expect(dataStoreMock.setStats).toHaveBeenCalledWith({ totalTasks: 5 });
    });

    it('doküman yoksa setStats çağrılmaz', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      act(() => { listeners[3]!.onNext({ exists: () => false, data: () => undefined }); });

      expect(dataStoreMock.setStats).not.toHaveBeenCalled();
    });

    it('hata verirse artık sessizce yutulmaz — onError(e, \'list\', \'system/stats\') çağrılır (bu oturumda düzeltilen regresyon)', () => {
      renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));
      const err = new Error('permission-denied');

      act(() => { listeners[3]!.onErrorCb(err); });

      expect(onError).toHaveBeenCalledWith(err, 'list', 'system/stats');
    });
  });

  describe('yaşam döngüsü', () => {
    it('unmount olduğunda 4 listener\'ın tamamı unsubscribe edilir', () => {
      const { unmount } = renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));
      expect(unsubs).toHaveLength(4);

      unmount();

      unsubs.forEach(u => expect(u).toHaveBeenCalledOnce());
    });

    it('taskLimit değiştiğinde yalnızca tasks listener\'ı yeniden kurulur (users/blockers/stats etkilenmez)', () => {
      const { rerender } = renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));
      expect(unsubs).toHaveLength(4);

      vi.mocked(useDataStore).mockReturnValue({ ...dataStoreMock, taskLimit: 400 } as any);
      rerender();

      expect(unsubs[0]).toHaveBeenCalledOnce();
      expect(unsubs[1]).not.toHaveBeenCalled();
      expect(unsubs[2]).not.toHaveBeenCalled();
      expect(unsubs[3]).not.toHaveBeenCalled();
      expect(firebase.onSnapshot).toHaveBeenCalledTimes(5);
    });

    it('isHydrated=false ile başlarsa isLoading true\'dur, tasks verisi geldiğinde false olur', () => {
      vi.mocked(useDataStore).mockReturnValue({ ...dataStoreMock, isHydrated: false } as any);
      const { result } = renderHook(() => useFirestoreData(makeUser({ role: 'Admin' }), onError));

      expect(result.current.isLoading).toBe(true);

      act(() => { listeners[0]!.onNext(mockQuerySnap([])); });

      expect(result.current.isLoading).toBe(false);
    });
  });
});
