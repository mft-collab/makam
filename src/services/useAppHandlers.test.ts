import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppHandlers } from './useAppHandlers';
import { taskService } from './taskService';
import { userService } from './userService';
import { blockerService } from './blockerService';
import { offlineQueue } from '../lib/offlineQueue';
import { useUIStore } from '../store/uiStore';
import type { Task, TaskBlocker, User } from '../types';

vi.mock('./taskService', () => ({
  taskService: {
    createTask: vi.fn(), updateTask: vi.fn(), updateTaskStatus: vi.fn(),
    deleteTask: vi.fn(), addComment: vi.fn(), delegateTask: vi.fn(),
  },
}));
vi.mock('./userService', () => ({
  userService: { addUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn() },
}));
vi.mock('./blockerService', () => ({
  blockerService: { addBlocker: vi.fn(), resolveBlocker: vi.fn(), editBlocker: vi.fn(), deleteBlocker: vi.fn() },
}));
vi.mock('../lib/offlineQueue', () => ({ offlineQueue: { enqueue: vi.fn() } }));
vi.mock('../store/uiStore', () => ({ useUIStore: vi.fn() }));

const goOffline = () => Object.defineProperty(window.navigator, 'onLine', { value: false, writable: true });
const goOnline = () => Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });

const makeUser = (overrides: Partial<User> = {}): User => ({
  uid: 'user-1', fullName: 'Test Kullanıcı', email: 'test@makam.com', role: 'Manager', ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'creator-1', assigneeId: 'assignee-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: 1000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 3, tags: [], ...overrides,
} as Task);

const makeBlocker = (overrides: Partial<TaskBlocker> = {}): TaskBlocker => ({
  id: 'blocker-1', taskId: 'task-1', reason: 'Sebep', isResolved: false, createdAt: 1000, ...overrides,
});

describe('useAppHandlers', () => {
  let uiState: {
    selectedTaskId: string | null;
    setSelectedTaskId: ReturnType<typeof vi.fn>;
    setIsCreateModalOpen: ReturnType<typeof vi.fn>;
    setIsEditModalOpen: ReturnType<typeof vi.fn>;
    addToast: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    goOnline();
    uiState = {
      selectedTaskId: null, setSelectedTaskId: vi.fn(), setIsCreateModalOpen: vi.fn(),
      setIsEditModalOpen: vi.fn(), addToast: vi.fn(),
    };
    vi.mocked(useUIStore).mockImplementation((selector: any) => selector(uiState));
  });

  afterEach(() => { goOnline(); });

  const setup = (opts: { user?: User | null; tasks?: Task[]; blockers?: TaskBlocker[] } = {}) => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAppHandlers({
      user: opts.user === undefined ? makeUser() : opts.user,
      tasks: opts.tasks ?? [],
      blockers: opts.blockers ?? [],
      onError,
    }));
    return { handlers: result.current, onError };
  };

  describe('updateTaskStatus', () => {
    it('user null ise hiçbir şey yapmaz', async () => {
      const { handlers } = setup({ user: null });
      await act(async () => { await handlers.updateTaskStatus('task-1', 'COMPLETED'); });
      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
      expect(offlineQueue.enqueue).not.toHaveBeenCalled();
    });

    it('online + BLOCKED-olmayan hedef: taskService.updateTaskStatus doğru argümanlarla çağrılır', async () => {
      const task = makeTask({ status: 'IN_PROGRESS' });
      const { handlers } = setup({ tasks: [task] });

      await act(async () => { await handlers.updateTaskStatus('task-1', 'COMPLETED', 'kanit.pdf', 'PDF'); });

      expect(taskService.updateTaskStatus).toHaveBeenCalledWith('task-1', 'COMPLETED', 'IN_PROGRESS', 'user-1', 'kanit.pdf', 'PDF', 3);
      expect(uiState.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', taskId: 'task-1' }));
    });

    it('online + BLOCKED hedef + görevde henüz çözülmemiş engel yoksa: blockerService.addBlocker çağrılır (taskService.updateTaskStatus çağrılmaz)', async () => {
      const task = makeTask();
      const { handlers } = setup({ tasks: [task], blockers: [] });

      await act(async () => { await handlers.updateTaskStatus('task-1', 'BLOCKED'); });

      expect(blockerService.addBlocker).toHaveBeenCalledWith('task-1', 'Hızlı kaydırma ile kriz bildirimi.', 'user-1', 'IN_PROGRESS', 3, 'High');
      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
    });

    it('online + BLOCKED hedef + zaten çözülmemiş engel varsa: taskService.updateTaskStatus çağrılır (addBlocker çağrılmaz)', async () => {
      const task = makeTask();
      const blocker = makeBlocker({ isResolved: false });
      const { handlers } = setup({ tasks: [task], blockers: [blocker] });

      await act(async () => { await handlers.updateTaskStatus('task-1', 'BLOCKED'); });

      expect(taskService.updateTaskStatus).toHaveBeenCalledWith('task-1', 'BLOCKED', 'IN_PROGRESS', 'user-1', undefined, undefined, 3);
      expect(blockerService.addBlocker).not.toHaveBeenCalled();
    });

    it('servis reddederse onError(err, \'update\', \'tasks/{id}\') çağrılır', async () => {
      vi.mocked(taskService.updateTaskStatus).mockRejectedValueOnce(new Error('VERSION_MISMATCH'));
      const { handlers, onError } = setup({ tasks: [makeTask()] });

      await act(async () => { await handlers.updateTaskStatus('task-1', 'COMPLETED'); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'tasks/task-1');
    });

    it('offline + BLOCKED-olmayan hedef: offlineQueue.enqueue tasks/update ile kuyruğa alır', async () => {
      goOffline();
      const task = makeTask();
      const { handlers } = setup({ tasks: [task] });

      await act(async () => { await handlers.updateTaskStatus('task-1', 'COMPLETED'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'COMPLETED', userId: 'user-1', evidence: undefined, evidenceType: undefined, expectedVersion: 3 }
      );
      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
    });

    it('offline + BLOCKED hedef + engel yoksa: blocker+görev geçişi TEK birleşik enqueue çağrısında kuyruğa alınır', async () => {
      goOffline();
      const task = makeTask();
      const { handlers } = setup({ tasks: [task], blockers: [] });

      await act(async () => { await handlers.updateTaskStatus('task-1', 'BLOCKED'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledOnce();
      const call = vi.mocked(offlineQueue.enqueue).mock.calls[0]!;
      expect(call[0]).toBe('blockers');
      expect(call[1]).toBe('create');
      expect(call[2]).toMatchObject({ taskId: 'task-1', reason: 'Hızlı kaydırma ile kriz bildirimi.', isResolved: false });
      expect(call[5]).toMatchObject({ taskId: 'task-1', newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 3 });
    });

    it('offline + BLOCKED hedef + engel varsa: sade tasks/update ile kuyruğa alır', async () => {
      goOffline();
      const task = makeTask();
      const { handlers } = setup({ tasks: [task], blockers: [makeBlocker()] });

      await act(async () => { await handlers.updateTaskStatus('task-1', 'BLOCKED'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'BLOCKED', userId: 'user-1', evidence: undefined, evidenceType: undefined, expectedVersion: 3 }
      );
    });
  });

  describe('createTask', () => {
    it('online: taskService.createTask çağrılır ve modal kapatılır', async () => {
      const { handlers } = setup();

      await act(async () => { await handlers.createTask({ title: 'Yeni' }); });

      expect(taskService.createTask).toHaveBeenCalledWith({ title: 'Yeni' }, 'user-1');
      expect(uiState.setIsCreateModalOpen).toHaveBeenCalledWith(false);
    });

    it('servis reddederse onError(err, \'create\', \'tasks\') çağrılır', async () => {
      vi.mocked(taskService.createTask).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup();

      await act(async () => { await handlers.createTask({ title: 'Yeni' }); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'create', 'tasks');
    });

    it('offline: offlineQueue.enqueue ile lokal kuyruğa alınır, taskService.createTask çağrılmaz', async () => {
      goOffline();
      const { handlers } = setup();

      await act(async () => { await handlers.createTask({ title: 'Yeni', priority: 'High' }); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        'tasks', 'create', expect.objectContaining({ title: 'Yeni', priority: 'High' }),
        undefined, undefined, undefined, undefined, 'user-1'
      );
      expect(taskService.createTask).not.toHaveBeenCalled();
      expect(uiState.setIsCreateModalOpen).toHaveBeenCalledWith(false);
    });

    it('user null ise hiçbir şey yapmaz', async () => {
      const { handlers } = setup({ user: null });
      await act(async () => { await handlers.createTask({ title: 'X' }); });
      expect(taskService.createTask).not.toHaveBeenCalled();
    });
  });

  describe('updateTask', () => {
    it('online: mevcut görev bulunursa taskService.updateTask çağrılır, modal kapatılır', async () => {
      const oldTask = makeTask();
      const { handlers } = setup({ tasks: [oldTask] });

      await act(async () => { await handlers.updateTask('task-1', { title: 'Güncel' }); });

      expect(taskService.updateTask).toHaveBeenCalledWith('task-1', { title: 'Güncel' }, oldTask, 'user-1');
      expect(uiState.setIsEditModalOpen).toHaveBeenCalledWith(false);
    });

    it('online: güncellenecek görev lokal listede bulunamazsa onError çağrılır (servis çağrılmaz)', async () => {
      const { handlers, onError } = setup({ tasks: [] });

      await act(async () => { await handlers.updateTask('bilinmeyen-id', { title: 'X' }); });

      expect(taskService.updateTask).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'tasks/bilinmeyen-id');
    });

    it('servis reddederse onError(err, \'update\', \'tasks/{id}\') çağrılır', async () => {
      vi.mocked(taskService.updateTask).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup({ tasks: [makeTask()] });

      await act(async () => { await handlers.updateTask('task-1', { title: 'X' }); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'tasks/task-1');
    });

    it('offline: offlineQueue.enqueue ile kuyruğa alınır, servis çağrılmaz', async () => {
      goOffline();
      const task = makeTask();
      const { handlers } = setup({ tasks: [task] });

      await act(async () => { await handlers.updateTask('task-1', { title: 'Yeni Başlık' }); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        'tasks', 'update', expect.objectContaining({ title: 'Yeni Başlık' }), 'task-1', 3,
        undefined, undefined, 'user-1', task
      );
      expect(taskService.updateTask).not.toHaveBeenCalled();
      expect(uiState.setIsEditModalOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('deleteTask', () => {
    it('online: taskService.deleteTask çağrılır; silinen görev seçiliyse seçim temizlenir', async () => {
      uiState.selectedTaskId = 'task-1';
      const { handlers } = setup();

      await act(async () => { await handlers.deleteTask('task-1'); });

      expect(taskService.deleteTask).toHaveBeenCalledWith('task-1', 'user-1');
      expect(uiState.setSelectedTaskId).toHaveBeenCalledWith(null);
    });

    it('online: silinen görev seçili değilse seçim state\'ine dokunulmaz', async () => {
      uiState.selectedTaskId = 'baska-gorev';
      const { handlers } = setup();

      await act(async () => { await handlers.deleteTask('task-1'); });

      expect(uiState.setSelectedTaskId).not.toHaveBeenCalled();
    });

    it('servis reddederse onError(err, \'delete\', \'tasks/{id}\') çağrılır', async () => {
      vi.mocked(taskService.deleteTask).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup();

      await act(async () => { await handlers.deleteTask('task-1'); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'delete', 'tasks/task-1');
    });

    it('offline: kök görev + alt görevler + bağlı engeller ayrı ayrı kuyruğa alınır', async () => {
      goOffline();
      const root = makeTask({ id: 'task-1' });
      const sub = makeTask({ id: 'sub-1', parentId: 'task-1' });
      const blocker = makeBlocker({ id: 'blocker-1', taskId: 'task-1' });
      const { handlers } = setup({ tasks: [root, sub], blockers: [blocker] });

      await act(async () => { await handlers.deleteTask('task-1'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith('tasks', 'delete', undefined, 'sub-1');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith('blockers', 'delete', undefined, 'blocker-1');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith('tasks', 'delete', undefined, 'task-1');
      expect(offlineQueue.enqueue).toHaveBeenCalledTimes(3);
    });

    it('offline: çok seviyeli hiyerarşide TÜM torun görevler ve HER seviyedeki engeller kuyruğa alınır', async () => {
      goOffline();
      const root = makeTask({ id: 'task-1' });
      const child = makeTask({ id: 'child-1', parentId: 'task-1' });
      const grandchild = makeTask({ id: 'grandchild-1', parentId: 'child-1' });
      const rootBlocker = makeBlocker({ id: 'blocker-root', taskId: 'task-1' });
      const childBlocker = makeBlocker({ id: 'blocker-child', taskId: 'child-1' });
      const grandchildBlocker = makeBlocker({ id: 'blocker-grandchild', taskId: 'grandchild-1' });
      const { handlers } = setup({
        tasks: [root, child, grandchild],
        blockers: [rootBlocker, childBlocker, grandchildBlocker],
      });

      await act(async () => { await handlers.deleteTask('task-1'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith('tasks', 'delete', undefined, 'child-1');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith('tasks', 'delete', undefined, 'grandchild-1');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith('tasks', 'delete', undefined, 'task-1');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith('blockers', 'delete', undefined, 'blocker-root');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith('blockers', 'delete', undefined, 'blocker-child');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith('blockers', 'delete', undefined, 'blocker-grandchild');
      expect(offlineQueue.enqueue).toHaveBeenCalledTimes(6);
    });
  });

  describe('addBlocker', () => {
    it('görev lokal listede bulunamazsa hiçbir şey yapmaz', async () => {
      const { handlers } = setup({ tasks: [] });
      await act(async () => { await handlers.addBlocker('task-1', 'Sebep'); });
      expect(blockerService.addBlocker).not.toHaveBeenCalled();
    });

    it('online: blockerService.addBlocker doğru argümanlarla çağrılır (severity verilmezse Medium)', async () => {
      const { handlers } = setup({ tasks: [makeTask({ status: 'IN_PROGRESS', lockVersion: 5 })] });

      await act(async () => { await handlers.addBlocker('task-1', 'Sunucu çöktü'); });

      expect(blockerService.addBlocker).toHaveBeenCalledWith('task-1', 'Sunucu çöktü', 'user-1', 'IN_PROGRESS', 5, 'Medium');
    });

    it('online: severity açıkça verilirse aynen iletilir', async () => {
      const { handlers } = setup({ tasks: [makeTask({ status: 'IN_PROGRESS', lockVersion: 5 })] });

      await act(async () => { await handlers.addBlocker('task-1', 'Sunucu çöktü', 'Urgent'); });

      expect(blockerService.addBlocker).toHaveBeenCalledWith('task-1', 'Sunucu çöktü', 'user-1', 'IN_PROGRESS', 5, 'Urgent');
    });

    it('servis reddederse onError(err, \'create\', \'blockers\') çağrılır', async () => {
      vi.mocked(blockerService.addBlocker).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup({ tasks: [makeTask()] });

      await act(async () => { await handlers.addBlocker('task-1', 'Sebep'); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'create', 'blockers');
    });

    it('offline: blocker+görev geçişi tek birleşik enqueue çağrısında kuyruğa alınır', async () => {
      goOffline();
      const { handlers } = setup({ tasks: [makeTask({ lockVersion: 7 })] });

      await act(async () => { await handlers.addBlocker('task-1', 'Sunucu çöktü'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledOnce();
      const call = vi.mocked(offlineQueue.enqueue).mock.calls[0]!;
      expect(call).toEqual([
        'blockers', 'create',
        expect.objectContaining({ taskId: 'task-1', reason: 'Sunucu çöktü', isResolved: false }),
        undefined, undefined,
        { taskId: 'task-1', newStatus: 'BLOCKED', userId: 'user-1', expectedVersion: 7 },
      ]);
    });
  });

  describe('resolveBlocker', () => {
    it('engel lokal listede bulunamazsa hiçbir şey yapmaz', async () => {
      const { handlers } = setup({ blockers: [] });
      await act(async () => { await handlers.resolveBlocker('blocker-1'); });
      expect(blockerService.resolveBlocker).not.toHaveBeenCalled();
    });

    it('online + görevdeki TEK aktif engel buysa: otherActiveCount 0 olarak iletilir', async () => {
      const blocker = makeBlocker();
      const { handlers } = setup({ tasks: [makeTask({ lockVersion: 4 })], blockers: [blocker] });

      await act(async () => { await handlers.resolveBlocker('blocker-1'); });

      expect(blockerService.resolveBlocker).toHaveBeenCalledWith('blocker-1', 'task-1', 0, 'user-1', 4);
    });

    it('online + başka aktif engel de varsa: otherActiveCount buna göre pozitif iletilir', async () => {
      const b1 = makeBlocker({ id: 'blocker-1' });
      const b2 = makeBlocker({ id: 'blocker-2' });
      const { handlers } = setup({ tasks: [makeTask()], blockers: [b1, b2] });

      await act(async () => { await handlers.resolveBlocker('blocker-1'); });

      expect(blockerService.resolveBlocker).toHaveBeenCalledWith('blocker-1', 'task-1', 1, 'user-1', 3);
    });

    it('servis reddederse onError(err, \'update\', \'blockers/{id}\') çağrılır', async () => {
      vi.mocked(blockerService.resolveBlocker).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup({ tasks: [makeTask()], blockers: [makeBlocker()] });

      await act(async () => { await handlers.resolveBlocker('blocker-1'); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'blockers/blocker-1');
    });

    it('offline + son aktif engelse: engel+görev geçişi TEK birleşik enqueue çağrısında kuyruğa alınır', async () => {
      goOffline();
      const { handlers } = setup({ tasks: [makeTask({ lockVersion: 4 })], blockers: [makeBlocker()] });

      await act(async () => { await handlers.resolveBlocker('blocker-1'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledOnce();
      const call = vi.mocked(offlineQueue.enqueue).mock.calls[0]!;
      expect(call[0]).toBe('blockers');
      expect(call[1]).toBe('update');
      expect(call[2]).toMatchObject({ isResolved: true });
      expect(call[3]).toBe('blocker-1');
      expect(call[5]).toMatchObject({ taskId: 'task-1', newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 4 });
    });

    it('offline + başka aktif engel de varsa: sade blockers/update ile kuyruğa alınır (görev geçişi tetiklenmez)', async () => {
      goOffline();
      const b1 = makeBlocker({ id: 'blocker-1' });
      const b2 = makeBlocker({ id: 'blocker-2' });
      const { handlers } = setup({ tasks: [makeTask()], blockers: [b1, b2] });

      await act(async () => { await handlers.resolveBlocker('blocker-1'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith('blockers', 'update', expect.objectContaining({ isResolved: true }), 'blocker-1');
    });
  });

  describe('addComment', () => {
    it('online: taskService.addComment çağrılır', async () => {
      const { handlers } = setup({ tasks: [makeTask({ lockVersion: 6 })] });

      await act(async () => { await handlers.addComment('task-1', 'Not aldım'); });

      expect(taskService.addComment).toHaveBeenCalledWith('task-1', 'user-1', 'Not aldım', 6);
    });

    it('online: görev lokal listede yoksa bile sunucuya güvenilerek çağrı yapılır (lockVersion undefined)', async () => {
      const { handlers } = setup({ tasks: [] });

      await act(async () => { await handlers.addComment('bilinmeyen-id', 'Not'); });

      expect(taskService.addComment).toHaveBeenCalledWith('bilinmeyen-id', 'user-1', 'Not', undefined);
    });

    it('servis reddederse onError(err, \'update\', \'tasks/{id}/comments\') çağrılır', async () => {
      vi.mocked(taskService.addComment).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup({ tasks: [makeTask()] });

      await act(async () => { await handlers.addComment('task-1', 'Not'); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'tasks/task-1/comments');
    });

    it('offline + görev lokal listede varsa: yorum eklenmiş hâliyle tasks/update olarak kuyruğa alınır', async () => {
      goOffline();
      const task = makeTask({ lockVersion: 2, comments: [] });
      const { handlers } = setup({ tasks: [task] });

      await act(async () => { await handlers.addComment('task-1', 'Yeni not'); });

      const call = vi.mocked(offlineQueue.enqueue).mock.calls[0]!;
      expect(call[0]).toBe('tasks');
      expect(call[1]).toBe('update');
      expect((call[2] as any).comments).toEqual([{ userId: 'user-1', text: 'Yeni not', timestamp: expect.any(Number) }]);
      expect(call[3]).toBe('task-1');
      expect(call[4]).toBe(2);
    });

    it('offline + görev lokal listede yoksa: hiçbir enqueue çağrısı yapılmaz (yorum sessizce kaybolur)', async () => {
      goOffline();
      const { handlers } = setup({ tasks: [] });

      await act(async () => { await handlers.addComment('bilinmeyen-id', 'Not'); });

      expect(offlineQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('delegateTask', () => {
    it('görev lokal listede bulunamazsa hiçbir şey yapmaz', async () => {
      const { handlers } = setup({ tasks: [] });
      await act(async () => { await handlers.delegateTask('task-1', 'yeni-mudur'); });
      expect(taskService.delegateTask).not.toHaveBeenCalled();
    });

    it('online: taskService.delegateTask doğru argümanlarla çağrılır', async () => {
      const { handlers } = setup({ tasks: [makeTask({ lockVersion: 9 })] });

      await act(async () => { await handlers.delegateTask('task-1', 'yeni-mudur'); });

      expect(taskService.delegateTask).toHaveBeenCalledWith('task-1', 'yeni-mudur', 'user-1', 9);
    });

    it('servis reddederse onError(err, \'update\', \'tasks/{id}\') çağrılır', async () => {
      vi.mocked(taskService.delegateTask).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup({ tasks: [makeTask()] });

      await act(async () => { await handlers.delegateTask('task-1', 'yeni-mudur'); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'tasks/task-1');
    });

    it('offline: offlineQueue.enqueue PENDING_DELEGATION statusTransition ile kuyruğa alır', async () => {
      goOffline();
      const { handlers } = setup({ tasks: [makeTask({ lockVersion: 9 })] });

      await act(async () => { await handlers.delegateTask('task-1', 'yeni-mudur'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        'tasks', 'update', undefined, 'task-1', undefined, undefined,
        { newStatus: 'PENDING_DELEGATION', userId: 'user-1', assigneeId: 'yeni-mudur', expectedVersion: 9 }
      );
    });
  });

  describe('kullanıcı yönetimi (addUser / updateUserRole / deleteUser) — offline dalı yok', () => {
    it('addUser: online userService.addUser çağrılır', async () => {
      const { handlers } = setup();
      await act(async () => { await handlers.addUser({ email: 'a@b.com', fullName: 'X', role: 'Staff' }); });
      expect(userService.addUser).toHaveBeenCalledWith({ email: 'a@b.com', fullName: 'X', role: 'Staff' });
    });

    it('addUser: cihaz çevrimdışıyken de doğrudan servisi çağırır (offlineQueue kullanılmaz)', async () => {
      goOffline();
      const { handlers } = setup();
      await act(async () => { await handlers.addUser({ email: 'a@b.com', fullName: 'X', role: 'Staff' }); });
      expect(userService.addUser).toHaveBeenCalledOnce();
      expect(offlineQueue.enqueue).not.toHaveBeenCalled();
    });

    it('addUser: servis reddederse onError(err, \'create\', \'users\') çağrılır', async () => {
      vi.mocked(userService.addUser).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup();
      await act(async () => { await handlers.addUser({ email: 'a@b.com', fullName: 'X', role: 'Staff' }); });
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'create', 'users');
    });

    it('updateUserRole: userService.updateUser doğru argümanlarla çağrılır', async () => {
      const { handlers } = setup();
      await act(async () => { await handlers.updateUserRole('target-uid', { role: 'Manager' }); });
      expect(userService.updateUser).toHaveBeenCalledWith('target-uid', { role: 'Manager' });
    });

    it('updateUserRole: servis reddederse onError(err, \'update\', \'users/{id}\') çağrılır', async () => {
      vi.mocked(userService.updateUser).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup();
      await act(async () => { await handlers.updateUserRole('target-uid', { role: 'Manager' }); });
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'users/target-uid');
    });

    it('deleteUser: userService.deleteUser çağrılır', async () => {
      const { handlers } = setup();
      await act(async () => { await handlers.deleteUser('target-uid'); });
      expect(userService.deleteUser).toHaveBeenCalledWith('target-uid');
    });

    it('deleteUser: servis reddederse onError(err, \'delete\', \'users/{id}\') çağrılır', async () => {
      vi.mocked(userService.deleteUser).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup();
      await act(async () => { await handlers.deleteUser('target-uid'); });
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'delete', 'users/target-uid');
    });

    it('user null ise üç handler da hiçbir şey yapmaz', async () => {
      const { handlers } = setup({ user: null });
      await act(async () => {
        await handlers.addUser({ email: 'a@b.com', fullName: 'X', role: 'Staff' });
        await handlers.updateUserRole('id', {});
        await handlers.deleteUser('id');
      });
      expect(userService.addUser).not.toHaveBeenCalled();
      expect(userService.updateUser).not.toHaveBeenCalled();
      expect(userService.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('updateBlocker — offline dalı yok', () => {
    it('online: blockerService.editBlocker çağrılır', async () => {
      const { handlers } = setup();
      await act(async () => { await handlers.updateBlocker('blocker-1', 'Yeni sebep'); });
      expect(blockerService.editBlocker).toHaveBeenCalledWith('blocker-1', 'Yeni sebep');
    });

    it('cihaz çevrimdışıyken de doğrudan servisi çağırır (offlineQueue kullanılmaz)', async () => {
      goOffline();
      const { handlers } = setup();
      await act(async () => { await handlers.updateBlocker('blocker-1', 'Yeni sebep'); });
      expect(blockerService.editBlocker).toHaveBeenCalledOnce();
      expect(offlineQueue.enqueue).not.toHaveBeenCalled();
    });

    it('servis reddederse onError(err, \'update\', \'blockers/{id}\') çağrılır', async () => {
      vi.mocked(blockerService.editBlocker).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup();
      await act(async () => { await handlers.updateBlocker('blocker-1', 'Yeni sebep'); });
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'update', 'blockers/blocker-1');
    });
  });

  describe('deleteBlocker', () => {
    it('engel lokal listede bulunamazsa hiçbir şey yapmaz', async () => {
      const { handlers } = setup({ blockers: [] });
      await act(async () => { await handlers.deleteBlocker('blocker-1'); });
      expect(blockerService.deleteBlocker).not.toHaveBeenCalled();
    });

    it('online + son aktif engel + görev BLOCKED: engel silme + görevin IN_PROGRESS\'e dönmesi TEK atomik blockerService.deleteBlocker çağrısıyla yapılır', async () => {
      // Eskiden bu iki ayrı sıralı çağrıyla (blockerService.deleteBlocker + ayrı
      // bir taskService.updateTaskStatus) yapılıyordu — biri başarısız olursa
      // diğeri de olmayacak şekilde TEK transaction'a birleştirildi (bkz. kod
      // denetimi: görev çözülecek engeli olmadan BLOCKED'da kilitli kalabiliyordu).
      const task = makeTask({ status: 'BLOCKED', lockVersion: 4 });
      const blocker = makeBlocker();
      const { handlers } = setup({ tasks: [task], blockers: [blocker] });

      await act(async () => { await handlers.deleteBlocker('blocker-1'); });

      expect(blockerService.deleteBlocker).toHaveBeenCalledWith('blocker-1', 'task-1', 0, 'user-1', 4);
      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
    });

    it('online + görevde başka aktif engel kalıyorsa: taskService.updateTaskStatus çağrılmaz', async () => {
      const task = makeTask({ status: 'BLOCKED' });
      const b1 = makeBlocker({ id: 'blocker-1' });
      const b2 = makeBlocker({ id: 'blocker-2' });
      const { handlers } = setup({ tasks: [task], blockers: [b1, b2] });

      await act(async () => { await handlers.deleteBlocker('blocker-1'); });

      expect(blockerService.deleteBlocker).toHaveBeenCalledWith('blocker-1');
      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
    });

    it('online + son aktif engel ama görev BLOCKED değilse: taskService.updateTaskStatus çağrılmaz', async () => {
      const task = makeTask({ status: 'IN_PROGRESS' });
      const blocker = makeBlocker();
      const { handlers } = setup({ tasks: [task], blockers: [blocker] });

      await act(async () => { await handlers.deleteBlocker('blocker-1'); });

      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
    });

    it('servis reddederse onError(err, \'delete\', \'blockers/{id}\') çağrılır', async () => {
      vi.mocked(blockerService.deleteBlocker).mockRejectedValueOnce(new Error('x'));
      const { handlers, onError } = setup({ tasks: [makeTask()], blockers: [makeBlocker()] });

      await act(async () => { await handlers.deleteBlocker('blocker-1'); });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'delete', 'blockers/blocker-1');
    });

    it('offline + son aktif engel + görev BLOCKED: engel silme + görev geçişi TEK enqueue çağrısıyla (linkedTaskTransition) kuyruğa alınır', async () => {
      // Eskiden ayrı bir 'tasks'/'update' mutasyonu ham status alanı güncelliyordu
      // ve statusTransition taşımadığından sync'te transitionTaskInTransaction hiç
      // çağrılmıyordu — pausedAt asla temizlenmiyordu (bkz. kod denetimi). Artık
      // tek bir 'blockers'/'delete' mutasyonu linkedTaskTransition ile kuyruklanıyor.
      goOffline();
      const task = makeTask({ status: 'BLOCKED', lockVersion: 4 });
      const blocker = makeBlocker();
      const { handlers } = setup({ tasks: [task], blockers: [blocker] });

      await act(async () => { await handlers.deleteBlocker('blocker-1'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith(
        'blockers', 'delete', undefined, 'blocker-1', undefined,
        { taskId: 'task-1', newStatus: 'IN_PROGRESS', userId: 'user-1', expectedVersion: 4 }
      );
      expect(offlineQueue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('offline + başka aktif engel kalıyorsa: sadece engel silme kuyruğa alınır, görev geçişi tetiklenmez', async () => {
      goOffline();
      const task = makeTask({ status: 'BLOCKED' });
      const b1 = makeBlocker({ id: 'blocker-1' });
      const b2 = makeBlocker({ id: 'blocker-2' });
      const { handlers } = setup({ tasks: [task], blockers: [b1, b2] });

      await act(async () => { await handlers.deleteBlocker('blocker-1'); });

      expect(offlineQueue.enqueue).toHaveBeenCalledWith('blockers', 'delete', undefined, 'blocker-1');
      expect(offlineQueue.enqueue).toHaveBeenCalledTimes(1);
    });
  });
});
