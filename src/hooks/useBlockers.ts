/**
 * #2 — useBlockers Custom Hook
 * Tüm blocker işlemlerini App.tsx'ten ayırır.
 */
import { useCallback } from 'react';
import { blockerService } from '../services/blockerService';
import { notificationService } from '../services/notificationService';
import { Task, User } from '../types';

interface UseBlockersProps {
  user: User | null;
  tasks: Task[];
  users: User[];
  onError: (err: any, type: string, path: string) => void;
  onSuccess: (title: string, body: string) => void;
}

export function useBlockers({ user, tasks, users, onError, onSuccess }: UseBlockersProps) {

  const addBlocker = useCallback(async (taskId: string, reason: string) => {
    if (!user) return;
    try {
      const task = tasks.find(t => t.id === taskId);
      // blockerService.addBlocker(taskId, reason, userId, oldStatus)
      await blockerService.addBlocker(taskId, reason, user.uid, task?.status ?? 'IN_PROGRESS');
      onSuccess('Engel Bildirimi', 'Risk kaydedildi ve ilgililere bildirildi.');

      // Yöneticilere bildir
      const managers = users.filter(u => u.role === 'Manager' || u.role === 'Admin');
      for (const manager of managers) {
        await notificationService.createNotification({
          userId: manager.uid,
          title: '🚫 Talimat Engellendi',
          message: `"${task?.title ?? 'Bilinmeyen'}" talimatı engellendi: ${reason}`,
          type: 'Warning',
          timestamp: Date.now(),
          isRead: false,
        });
      }
    } catch (err: any) {
      onError(err, 'create', 'blockers');
    }
  }, [user, tasks, users, onError, onSuccess]);

  const resolveBlocker = useCallback(async (blockerId: string, taskId?: string, otherActiveCount?: number) => {
    if (!user) return;
    try {
      // blockerService.resolveBlocker(blockerId, taskId, otherActiveCount, userId)
      await blockerService.resolveBlocker(blockerId, taskId ?? '', otherActiveCount ?? 0, user.uid);
      onSuccess('Engel Çözüldü', 'Blocker başarıyla giderildi.');
    } catch (err: any) {
      onError(err, 'update', `blockers/${blockerId}`);
    }
  }, [user, onError, onSuccess]);

  return { addBlocker, resolveBlocker };
}
