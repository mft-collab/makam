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
import type { Task, TaskStatus, TaskBlocker, User, UserRole } from '../types';

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
  // Selector bazlı okuma — bu hook yalnızca selectedTaskId'nin değişmesiyle
  // ilgileniyor; whole-store `useUIStore()` kullanmak toasts/filter/isOffline
  // gibi ilgisiz her alan değişiminde (ör. her toast eklenip 6sn sonra otomatik
  // kaldırıldığında) App.tsx'in gereksiz yere yeniden render olmasına yol
  // açıyordu. Action fonksiyonları zustand'da stabil referanslar olduğundan
  // selector ile alınmaları da re-render tetiklemez.
  const selectedTaskId = useUIStore(s => s.selectedTaskId);
  const setSelectedTaskId = useUIStore(s => s.setSelectedTaskId);
  const setIsCreateModalOpen = useUIStore(s => s.setIsCreateModalOpen);
  const setIsEditModalOpen = useUIStore(s => s.setIsEditModalOpen);
  const addToast = useUIStore(s => s.addToast);

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
    const oldTask = tasks.find(t => t.id === taskId);

    if (isOfflineNow()) {
      if (newStatus === 'BLOCKED') {
        const hasBlocker = blockers.some(b => b.taskId === taskId && !b.isResolved);
        if (!hasBlocker) {
          const bid = 'temp_blocker_' + Math.random().toString(36).substring(2, 9);
          // Engel oluşturma + görevi BLOCKED'a alma tek mutasyonda birleştirilir —
          // sync sırasında blockerService.addBlocker ile aynı transaction'da uygulanır.
          offlineQueue.enqueue(
            'blockers', 'create',
            { id: bid, taskId, reason: 'Hızlı kaydırma ile kriz bildirimi.', isResolved: false, createdAt: Date.now() },
            undefined, undefined,
            { taskId, newStatus: 'BLOCKED', userId: user.uid, expectedVersion: oldTask?.lockVersion }
          );
        } else {
          // statusTransition: pausedAt/totalPausedTime burada elle hesaplanmaz —
          // senkronda transitionTaskInTransaction, online ile birebir aynı mantıkla hesaplar.
          offlineQueue.enqueue(
            'tasks', 'update', undefined, taskId, undefined, undefined,
            { newStatus: 'BLOCKED', userId: user.uid, evidence, evidenceType, expectedVersion: oldTask?.lockVersion }
          );
        }
      } else {
        offlineQueue.enqueue(
          'tasks', 'update', undefined, taskId, undefined, undefined,
          { newStatus, userId: user.uid, evidence, evidenceType, expectedVersion: oldTask?.lockVersion }
        );
      }
      toast('🔄 Çevrimdışı Güncelleme', `Durum lokal kuyrukta güncellendi: ${newStatus}`, 'warning', taskId);
      return;
    }

    try {
      if (newStatus === 'BLOCKED') {
        const hasBlocker = blockers.some(b => b.taskId === taskId && !b.isResolved);
        if (!hasBlocker) {
          await blockerService.addBlocker(taskId, 'Hızlı kaydırma ile kriz bildirimi.', user.uid, oldTask?.status ?? 'IN_PROGRESS', oldTask?.lockVersion);
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
  const createTask = useCallback(async (data: Partial<Task>) => {
    if (!user) return;

    if (isOfflineNow()) {
      const id = tempId();
      const slaConfig = getSLAConfigForPriority(data.priority ?? 'Medium');
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
      toast('📋 Talimat Tanımlandı', `"${data.title?.slice(0, 50) ?? 'Yeni talimat'}" dizgeye işlendi.`, 'success');
    } catch (err) {
      onError(err, 'create', 'tasks');
    }
  }, [user, setIsCreateModalOpen, toast, onError]);

  // ─── updateTask ──────────────────────────────────────────────────────────
  const updateTask = useCallback(async (taskId: string, data: Partial<Task>) => {
    if (!user) return;
    const oldTask = tasks.find(t => t.id === taskId);

    if (isOfflineNow()) {
      offlineQueue.enqueue('tasks', 'update', { ...data, updatedAt: Date.now() }, taskId, oldTask?.lockVersion);
      setIsEditModalOpen(false);
      toast('🔄 Çevrimdışı Güncelleme', 'Talimat düzenlemesi lokal sıraya alındı.', 'warning', taskId);
      return;
    }

    try {
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
      // Engel oluşturma + görevi BLOCKED'a alma tek mutasyonda birleştirilir —
      // sync sırasında blockerService.addBlocker ile aynı transaction'da uygulanır.
      offlineQueue.enqueue(
        'blockers', 'create',
        { id: bid, taskId, reason, isResolved: false, createdAt: now },
        undefined, undefined,
        { taskId, newStatus: 'BLOCKED', userId: user.uid, expectedVersion: task.lockVersion }
      );
      toast('🚫 Çevrimdışı Risk Bildirimi', 'Gelişen kriz lokal sıraya eklendi.', 'warning', taskId);
      return;
    }

    try {
      await blockerService.addBlocker(taskId, reason, user.uid, task.status, task.lockVersion);
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
      const remaining = blockers.filter(b => b.taskId === blocker.taskId && b.id !== blockerId && !b.isResolved);
      if (remaining.length === 0) {
        // Son aktif engel çözülüyor: engel dokümanı + görevin IN_PROGRESS'e dönüşü
        // tek mutasyonda birleştirilir — sync sırasında aynı transaction'da uygulanır.
        const task = tasks.find(t => t.id === blocker.taskId);
        offlineQueue.enqueue(
          'blockers', 'update',
          { isResolved: true, resolvedAt: now },
          blockerId, undefined,
          { taskId: blocker.taskId, newStatus: 'IN_PROGRESS', userId: user.uid, expectedVersion: task?.lockVersion }
        );
      } else {
        offlineQueue.enqueue('blockers', 'update', { isResolved: true, resolvedAt: now }, blockerId);
      }
      toast('✅ Çevrimdışı Risk Çözüldü', 'Engel çözümü lokal sıraya alındı.', 'warning', blocker.taskId);
      return;
    }

    try {
      const taskBlockers = blockers.filter(b => b.taskId === blocker.taskId && !b.isResolved);
      const task = tasks.find(t => t.id === blocker.taskId);
      await blockerService.resolveBlocker(blockerId, blocker.taskId, taskBlockers.length - 1, user.uid, task?.lockVersion);
    } catch (err) {
      onError(err, 'update', `blockers/${blockerId}`);
    }
  }, [user, blockers, tasks, toast, onError]);

  // ─── addComment ──────────────────────────────────────────────────────────
  const addComment = useCallback(async (taskId: string, text: string) => {
    if (!user) return;
    const task = tasks.find(t => t.id === taskId);

    if (isOfflineNow()) {
      if (task) {
        const tempComments = [...(task.comments || []), { userId: user.uid, text, timestamp: Date.now() }];
        offlineQueue.enqueue('tasks', 'update', { comments: tempComments, updatedAt: Date.now() }, taskId, task.lockVersion);
        toast('💬 Çevrimdışı Yorum', 'Şerh/yorum lokal sıraya eklendi.', 'warning', taskId);
      }
      return;
    }

    try {
      await taskService.addComment(taskId, user.uid, text, task?.lockVersion);
    } catch (err) {
      onError(err, 'update', `tasks/${taskId}/comments`);
    }
  }, [user, tasks, toast, onError]);

  // ─── delegateTask (izin/mazeret devri, Müdür → Müdür) ───────────────────
  const delegateTask = useCallback(async (taskId: string, newAssigneeId: string) => {
    if (!user) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (isOfflineNow()) {
      // statusTransition: pausedAt/totalPausedTime burada elle hesaplanmaz —
      // senkronda transitionTaskInTransaction, online ile birebir aynı mantıkla hesaplar.
      offlineQueue.enqueue(
        'tasks', 'update', undefined, taskId, undefined, undefined,
        { newStatus: 'PENDING_DELEGATION', userId: user.uid, assigneeId: newAssigneeId, expectedVersion: task.lockVersion }
      );
      toast('🔄 Çevrimdışı Devir', 'Talimat devri lokal sıraya alındı.', 'warning', taskId);
      return;
    }

    try {
      await taskService.delegateTask(taskId, newAssigneeId, user.uid, task.lockVersion);
      toast('🔄 Talimat Devredildi', 'Görev başka bir müdüre devredildi.', 'info', taskId);
    } catch (err) {
      onError(err, 'update', `tasks/${taskId}`);
    }
  }, [user, tasks, toast, onError]);

  // ─── Kullanıcı yönetimi ──────────────────────────────────────────────────
  const addUser = useCallback(async (data: { email: string; fullName: string; role: UserRole; departmentId?: string }) => {
    if (!user) return;
    try { await userService.addUser(data); }
    catch (err) { onError(err, 'create', 'users'); }
  }, [user, onError]);

  const updateUserRole = useCallback(async (userId: string, data: Partial<User>) => {
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
        if (task?.status === 'BLOCKED') offlineQueue.enqueue('tasks', 'update', { status: 'IN_PROGRESS', updatedAt: Date.now() }, blocker.taskId, task.lockVersion);
      }
      toast('🗑 Çevrimdışı Risk Silindi', 'Risk unsuru kaldırılması lokal sıraya eklendi.', 'warning', blocker.taskId);
      return;
    }

    try {
      await blockerService.deleteBlocker(blockerId);
      const others = blockers.filter(b => b.taskId === blocker.taskId && b.id !== blockerId && !b.isResolved);
      if (others.length === 0) {
        const task = tasks.find(t => t.id === blocker.taskId);
        if (task?.status === 'BLOCKED') await taskService.updateTaskStatus(blocker.taskId, 'IN_PROGRESS', 'BLOCKED', user.uid, undefined, undefined, task.lockVersion);
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
    delegateTask,
    addUser,
    updateUserRole,
    deleteUser,
    updateBlocker,
    deleteBlocker,
  };
}
