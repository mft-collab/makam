/**
 * #2 — useTasks Custom Hook
 * Tüm görev CRUD işlemlerini App.tsx'ten ayırır.
 * createTask, updateTask, deleteTask, updateTaskStatus, addComment
 */
import { useCallback } from 'react';
import { taskService } from '../services/taskService';
import { notificationService } from '../services/notificationService';
import { Task, TaskStatus, User } from '../types';

interface UseTasksProps {
  user: User | null;
  users: User[];
  tasks: Task[];
  onError: (err: any, type: string, path: string) => void;
  onSuccess: (title: string, body: string, taskId?: string) => void;
}


export function useTasks({ user, tasks, onError, onSuccess }: UseTasksProps) {

  const createTask = useCallback(async (taskData: Partial<Task>) => {
    if (!user) return;
    try {
      await taskService.createTask(taskData as any, user.uid);
      onSuccess('Operasyon Oluşturuldu', `"${taskData.title}" başarıyla sisteme alındı.`);

      // İrtibatlı bildirim
      if (taskData.coordinatorId) {
        await notificationService.createNotification({
          userId: taskData.coordinatorId,
          title: 'İrtibatlı Atandınız',
          message: `"${taskData.title}" talimatı için irtibatlı olarak seçildiniz.`,
          type: 'Info',
          timestamp: Date.now(),
          isRead: false,
        });
      }
      // Sorumlu bildirim
      if (taskData.assigneeId && taskData.assigneeId !== user.uid) {
        await notificationService.createNotification({
          userId: taskData.assigneeId,
          title: 'Yeni Talimat Atandı',
          message: `"${taskData.title}" talimatı size atandı.`,
          type: 'Info',
          timestamp: Date.now(),
          isRead: false,
        });
      }
    } catch (err: any) {
      onError(err, 'create', 'tasks');
    }
  }, [user, onError, onSuccess]);

  const updateTask = useCallback(async (taskId: string, data: Partial<Task>) => {
    if (!user) return;
    try {
      const oldTask = tasks.find(t => t.id === taskId);
      if (!oldTask) throw new Error('Güncellenecek talimat bulunamadı.');
      await taskService.updateTask(taskId, data, oldTask, user.uid);
      onSuccess('Operasyon Güncellendi', 'Değişiklikler kaydedildi.');
    } catch (err: any) {
      onError(err, 'update', `tasks/${taskId}`);
    }
  }, [user, tasks, onError, onSuccess]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!user) return;
    try {
      await taskService.deleteTask(taskId, user.uid);
      onSuccess('Operasyon Silindi', 'Talimat sistemden kaldırıldı.');
    } catch (err: any) {
      onError(err, 'delete', `tasks/${taskId}`);
    }
  }, [user, onError, onSuccess]);

  const updateTaskStatus = useCallback(async (
    taskId: string, status: TaskStatus, evidence?: string, type?: string
  ) => {
    if (!user) return;
    try {
      const oldTask = tasks.find(t => t.id === taskId);
      await taskService.updateTaskStatus(taskId, status, oldTask?.status, user.uid, evidence, type as any);
      onSuccess('Durum Güncellendi', `Talimat durumu "${status}" olarak değiştirildi.`, taskId);
    } catch (err: any) {
      onError(err, 'update', `tasks/${taskId}`);
    }
  }, [user, tasks, onError, onSuccess]);

  const addComment = useCallback(async (taskId: string, text: string) => {
    if (!user) return;
    try {
      await taskService.addComment(taskId, user.uid, text);
      onSuccess('Not Eklendi', 'Yorum kaydedildi.');
    } catch (err: any) {
      onError(err, 'create', `tasks/${taskId}/comments`);
    }
  }, [user, onError, onSuccess]);

  return { createTask, updateTask, deleteTask, updateTaskStatus, addComment };
}
