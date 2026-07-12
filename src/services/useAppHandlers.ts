/**
 * useAppHandlers — Uygulama Seviyesi İş Mantığı Hook'u
 *
 * App.tsx içindeki tüm CRUD, durum geçiş ve yardımcı handler'ları
 * tek merkezde toplar. Offline-first kuyruğu, toast bildirimleri
 * ve Firestore operasyonlarını yönetir.
 *
 * Bağımlılıklar uiStore üzerinden okunur — prop drilling ortadan kalkar.
 */
import { useCallback } from 'react';
import { taskService } from './taskService';
import { userService } from './userService';
import { blockerService } from './blockerService';
import { offlineQueue } from '../lib/offlineQueue';
import { getSLAConfigForPriority, calculateDeadline } from '../lib/sla';
import { useUIStore } from '../store/uiStore';
import type { Task, TaskStatus, TaskBlocker, User } from '../types';

// ─── Statü emoji + etiket haritaları ─────────────────────────────────────────
const STATUS_EMOJI: Partial<Record<TaskStatus, string>> = {
  COMPLETED:        '✅',
  IN_PROGRESS:      '🔄',
  BLOCKED:          '🚫',
  AWAITING_APPROVAL:'⏳',
  CRISIS:           '🚨',
  CANCELLED:        '🗑',
};

const STATUS_LABELS_TR: Partial<Record<TaskStatus, string>> = {
  COMPLETED:        'İcra Edildi',
  IN_PROGRESS:      'İcra Aşamasında',
  BLOCKED:          'Engellenmiş',
  AWAITING_APPROVAL:'Onay Sürecinde',
  CRISIS:           'Kriz — Gecikmiş',
  CANCELLED:        'Lağvedildi',
};

// ─── Tip tanımları ────────────────────────────────────────────────────────────
interface UseAppHandlersOptions {
  user: User | null;
  tasks: Task[];
  blockers: TaskBlocker[];
  onError: (err: unknown, op: string, path: string | null) => void;
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
const isOfflineNow = () => typeof window !== 'undefined' && !window.navigator.onLine;

const tempId = () => 'temp_' + Math.random().toString(36).substring(2, 9);

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useAppHandlers({
  user,
  tasks,
  blockers,
  onError,
}: UseAppHandlersOptions) {
  const {
    selectedTaskId,
    setSelectedTaskId,
    setIsCreateModalOpen,
    setIsEditModalOpen,
    addToast,
  } = useUIStore();

  // Merkezi toast yardımcısı
  const toast = useCallback((
    title: string,
    body: string,
    type: 'info' | 'danger' | 'success' | 'warning' = 'success',
    taskId?: string
  ) => {
    addToast({ title, body, type, taskId });
  }, [addToast]);

  // ─── updateTaskStatus ────────────────────────────────────────────────────
  const updateTaskStatus = useCallback(async (
    taskId: string,
    newStatus: TaskStatus,
    evidence?: string,
    evidenceType?: Task['evidenceType']
  ) => {
    if (!user) return;
    const now = Date.now();
    const oldTask = tasks.find(t => t.id === taskId);

    if (isOfflineNow()) {
      if (newStatus === 'BLOCKED') {
        const hasBlocker = blockers.some(b => b.taskId === taskId && !b.isResolved);
        if (!hasBlocker) {
          const bid = 'temp_blocker_' + Math.random().toString(36).substring(2, 9);
          offlineQueue.enqueue('blockers', 'create', { id: bid, taskId, reason: 'Hızlı kaydırma ile kriz bildirimi.', isResolved: false, createdAt: now });
          offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED', pausedAt: now, updatedAt: now }, taskId);
        } else {
          offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED', pausedAt: now, evidence, evidenceType, updatedAt: now }, taskId);
        }
      } else {
        const updateData: Partial<Task> = { status: newStatus, evidence, evidenceType, updatedAt: now };
        if (oldTask) {
          let totalPausedTime = oldTask.totalPausedTime || 0;
          let pausedAt = oldTask.pausedAt ?? null;
          if ((oldTask.status === 'BLOCKED' || oldTask.status === 'AWAITING_APPROVAL') && oldTask.pausedAt) {
            totalPausedTime += now - oldTask.pausedAt;
            pausedAt = null;
          }
          if (newStatus === 'AWAITING_APPROVAL') pausedAt = now;
          updateData.totalPausedTime = totalPausedTime;
          updateData.pausedAt = pausedAt;
        }
        offlineQueue.enqueue('tasks', 'update', updateData, taskId);
      }
      toast('🔄 Çevrimdışı Güncelleme', `Durum lokal kuyrukta güncellendi: ${newStatus}`, 'warning', taskId);
      return;
    }

    try {
      if (newStatus === 'BLOCKED') {
        const hasBlocker = blockers.some(b => b.taskId === taskId && !b.isResolved);
        if (!hasBlocker) {
          await blockerService.addBlocker(taskId, 'Hızlı kaydırma ile kriz bildirimi.', user.uid, oldTask?.status ?? 'IN_PROGRESS');
        } else {
          await taskService.updateTaskStatus(taskId, newStatus, oldTask?.status, user.uid, evidence, evidenceType, oldTask?.lockVersion);
        }
      } else {
        await taskService.updateTaskStatus(taskId, newStatus, oldTask?.status, user.uid, evidence, evidenceType, oldTask?.lockVersion);
      }
      addToast({
        title: `${STATUS_EMOJI[newStatus] ?? '📋'} Talimat Durumu Güncellendi`,
        body: `"${oldTask?.title?.slice(0, 40) ?? 'Talimat'}" → ${STATUS_LABELS_TR[newStatus] ?? newStatus}`,
        type: newStatus === 'COMPLETED' ? 'success' : (newStatus === 'BLOCKED' || newStatus === 'CRISIS') ? 'danger' : 'info',
        taskId,
      });
    } catch (err) {
      onError(err, 'update', `tasks/${taskId}`);
    }
  }, [user, tasks, blockers, toast, addToast, onError]);

  // ─── createTask ──────────────────────────────────────────────────────────
  const createTask = useCallback(async (data: any) => {
    if (!user) return;

    if (isOfflineNow()) {
      const id = tempId();
      const slaConfig = getSLAConfigForPriority(data.priority);
      const deadline = calculateDeadline(new Date(), slaConfig);
      offlineQueue.enqueue('tasks', 'create', {
        ...data, id, status: 'ASSIGNED', deadline,
        createdAt: Date.now(), updatedAt: Date.now(),
        lockVersion: 0, totalPausedTime: 0, userId: user.uid,
      });
      setIsCreateModalOpen(false);
      toast('📋 Çevrimdışı Talimat', `"${data.title?.slice(0, 45)}" lokal sıraya alındı.`, 'warning', id);
      return;
    }

    try {
      await taskService.createTask(data, user.uid);
      setIsCreateModalOpen(false);
      toast('📋 Talimat Tanımlandı', `"${data.title?.slice(0, 50) ?? 'Yeni talimat'}" sisteme işlendi.`, 'success');
    } catch (err) {
      onError(err, 'create', 'tasks');
    }
  }, [user, setIsCreateModalOpen, toast, onError]);

  // ─── updateTask ──────────────────────────────────────────────────────────
  const updateTask = useCallback(async (taskId: string, data: any) => {
    if (!user) return;

    if (isOfflineNow()) {
      offlineQueue.enqueue('tasks', 'update', { ...data, updatedAt: Date.now() }, taskId);
      setIsEditModalOpen(false);
      toast('🔄 Çevrimdışı Güncelleme', 'Talimat düzenlemesi lokal sıraya alındı.', 'warning', taskId);
      return;
    }

    try {
      const oldTask = tasks.find(t => t.id === taskId);
      if (!oldTask) throw new Error('Güncellenecek talimat bulunamadı.');
      await taskService.updateTask(taskId, data, oldTask, user.uid);
      setIsEditModalOpen(false);
    } catch (err) {
      onError(err, 'update', `tasks/${taskId}`);
    }
  }, [user, tasks, setIsEditModalOpen, toast, onError]);

  // ─── deleteTask ──────────────────────────────────────────────────────────
  const deleteTask = useCallback(async (taskId: string) => {
    if (!user) return;

    if (isOfflineNow()) {
      tasks.filter(t => t.parentId === taskId).forEach(st => offlineQueue.enqueue('tasks', 'delete', undefined, st.id));
      blockers.filter(b => b.taskId === taskId).forEach(b => offlineQueue.enqueue('blockers', 'delete', undefined, b.id));
      offlineQueue.enqueue('tasks', 'delete', undefined, taskId);
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      toast('🗑 Çevrimdışı Silme', 'Talimat ve bağlı unsurları lokal kuyrukta silindi.', 'warning');
      return;
    }

    try {
      await taskService.deleteTask(taskId, user.uid);
      if (selectedTaskId === taskId) setSelectedTaskId(null);
    } catch (err) {
      onError(err, 'delete', `tasks/${taskId}`);
    }
  }, [user, tasks, blockers, selectedTaskId, setSelectedTaskId, toast, onError]);

  // ─── addBlocker ──────────────────────────────────────────────────────────
  const addBlocker = useCallback(async (taskId: string, reason: string) => {
    if (!user) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (isOfflineNow()) {
      const bid = 'temp_blocker_' + Math.random().toString(36).substring(2, 9);
      const now = Date.now();
      offlineQueue.enqueue('blockers', 'create', { id: bid, taskId, reason, isResolved: false, createdAt: now });
      offlineQueue.enqueue('tasks', 'update', { status: 'BLOCKED', pausedAt: now, updatedAt: now }, taskId);
      toast('🚫 Çevrimdışı Risk Bildirimi', 'Gelişen kriz lokal sıraya eklendi.', 'warning', taskId);
      return;
    }

    try {
      await blockerService.addBlocker(taskId, reason, user.uid, task.status);
    } catch (err) {
      onError(err, 'create', 'blockers');
    }
  }, [user, tasks, toast, onError]);

  // ─── resolveBlocker ──────────────────────────────────────────────────────
  const resolveBlocker = useCallback(async (blockerId: string) => {
    if (!user) return;
    const blocker = blockers.find(b => b.id === blockerId);
    if (!blocker) return;

    if (isOfflineNow()) {
      const now = Date.now();
      offlineQueue.enqueue('blockers', 'update', { isResolved: true, resolvedAt: now }, blockerId);
      const remaining = blockers.filter(b => b.taskId === blocker.taskId && b.id !== blockerId && !b.isResolved);
      if (remaining.length === 0) offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS', updatedAt: now }, blocker.taskId);
      toast('✅ Çevrimdışı Risk Çözüldü', 'Engel çözümü lokal sıraya alındı.', 'warning', blocker.taskId);
      return;
    }

    try {
      const taskBlockers = blockers.filter(b => b.taskId === blocker.taskId && !b.isResolved);
      await blockerService.resolveBlocker(blockerId, blocker.taskId, taskBlockers.length - 1, user.uid);
    } catch (err) {
      onError(err, 'update', `blockers/${blockerId}`);
    }
  }, [user, blockers, toast, onError]);

  // ─── addComment ──────────────────────────────────────────────────────────
  const addComment = useCallback(async (taskId: string, text: string) => {
    if (!user) return;

    if (isOfflineNow()) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        const tempComments = [...(task.comments || []), { userId: user.uid, text, timestamp: Date.now() }];
        offlineQueue.enqueue('tasks', 'update', { comments: tempComments, updatedAt: Date.now() }, taskId);
        toast('💬 Çevrimdışı Yorum', 'Şerh/yorum lokal sıraya eklendi.', 'warning', taskId);
      }
      return;
    }

    try {
      await taskService.addComment(taskId, user.uid, text);
    } catch (err) {
      onError(err, 'update', `tasks/${taskId}/comments`);
    }
  }, [user, tasks, toast, onError]);

  // ─── Kullanıcı yönetimi ──────────────────────────────────────────────────
  const addUser = useCallback(async (data: any) => {
    if (!user) return;
    try { await userService.addUser(data); }
    catch (err) { onError(err, 'create', 'users'); }
  }, [user, onError]);

  const updateUserRole = useCallback(async (userId: string, data: any) => {
    if (!user) return;
    try { await userService.updateUser(userId, data); }
    catch (err) { onError(err, 'update', `users/${userId}`); }
  }, [user, onError]);

  const deleteUser = useCallback(async (userId: string) => {
    if (!user) return;
    try { await userService.deleteUser(userId); }
    catch (err) { onError(err, 'delete', `users/${userId}`); }
  }, [user, onError]);

  // ─── Blocker yönetimi ────────────────────────────────────────────────────
  const updateBlocker = useCallback(async (blockerId: string, reason: string) => {
    if (!user) return;
    try { await blockerService.editBlocker(blockerId, reason); }
    catch (err) { onError(err, 'update', `blockers/${blockerId}`); }
  }, [user, onError]);

  const deleteBlocker = useCallback(async (blockerId: string) => {
    if (!user) return;
    const blocker = blockers.find(b => b.id === blockerId);
    if (!blocker) return;

    if (isOfflineNow()) {
      offlineQueue.enqueue('blockers', 'delete', undefined, blockerId);
      const others = blockers.filter(b => b.taskId === blocker.taskId && b.id !== blockerId && !b.isResolved);
      if (others.length === 0) {
        const task = tasks.find(t => t.id === blocker.taskId);
        if (task?.status === 'BLOCKED') offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS', updatedAt: Date.now() }, blocker.taskId);
      }
      toast('🗑 Çevrimdışı Risk Silindi', 'Risk unsuru kaldırılması lokal sıraya eklendi.', 'warning', blocker.taskId);
      return;
    }

    try {
      await blockerService.deleteBlocker(blockerId);
      const others = blockers.filter(b => b.taskId === blocker.taskId && b.id !== blockerId && !b.isResolved);
      if (others.length === 0) {
        const task = tasks.find(t => t.id === blocker.taskId);
        if (task?.status === 'BLOCKED') await taskService.updateTaskStatus(blocker.taskId, 'IN_PROGRESS', 'BLOCKED', user.uid);
      }
    } catch (err) {
      onError(err, 'delete', `blockers/${blockerId}`);
    }
  }, [user, blockers, tasks, toast, onError]);

  return {
    updateTaskStatus,
    createTask,
    updateTask,
    deleteTask,
    addBlocker,
    resolveBlocker,
    addComment,
    addUser,
    updateUserRole,
    deleteUser,
    updateBlocker,
    deleteBlocker,
  };
}
