import {
  collection,
  doc,
  updateDoc,
  deleteDoc,
  runTransaction,
  db
} from '../firebase';
import { transitionTaskInTransaction } from './taskService';
import { runWithRetry } from '../lib/retry';
import { TaskStatus } from '../types';

export const blockerService = {
  // Engel dokümanı ve görevin BLOCKED'a alınması AYNI transaction'da yapılır —
  // biri başarısız olursa diğeri de uygulanmaz (ör. sahipsiz bir engel kaydı
  // kalıp görevin durumu güncellenmemiş olması engellenir).
  async addBlocker(taskId: string, reason: string, userId: string, _oldStatus: TaskStatus, expectedVersion?: number) {
    const blockerRef = doc(collection(db, 'blockers'));
    await runWithRetry(async () => {
      await runTransaction(db, async (transaction) => {
        // Firestore kuralı: tüm okumalar yazmalardan önce olmalı — bu yüzden
        // transitionTaskInTransaction (kendi transaction.get'ini yapar) ÖNCE çağrılır.
        await transitionTaskInTransaction(transaction, taskId, 'BLOCKED', userId, { expectedVersion });
        transaction.set(blockerRef, {
          id: blockerRef.id,
          taskId,
          reason,
          isResolved: false,
          createdAt: Date.now()
        });
      });
    });
    return blockerRef.id;
  },

  async resolveBlocker(blockerId: string, taskId: string, otherActiveCount: number, userId: string, expectedVersion?: number) {
    const blockerRef = doc(db, 'blockers', blockerId);

    if (otherActiveCount === 0) {
      // Son aktif engel çözülüyorsa: engel dokümanı + görevin IN_PROGRESS'e
      // dönmesi tek transaction'da — biri başarısız olursa diğeri de olmaz.
      await runWithRetry(async () => {
        await runTransaction(db, async (transaction) => {
          await transitionTaskInTransaction(transaction, taskId, 'IN_PROGRESS', userId, { expectedVersion });
          transaction.update(blockerRef, { isResolved: true, resolvedAt: Date.now() });
        });
      });
    } else {
      await updateDoc(blockerRef, {
        isResolved: true,
        resolvedAt: Date.now()
      });
    }
  },

  async editBlocker(blockerId: string, reason: string) {
    await runWithRetry(async () => {
      await updateDoc(doc(db, 'blockers', blockerId), { reason });
    });
  },

  async deleteBlocker(blockerId: string, taskId?: string, otherActiveCount?: number, userId?: string, expectedVersion?: number) {
    const blockerRef = doc(db, 'blockers', blockerId);

    if (taskId !== undefined && otherActiveCount === 0 && userId !== undefined) {
      // Son aktif engel siliniyorsa: engel dokümanının silinmesi + görevin
      // IN_PROGRESS'e dönmesi (ve pausedAt/totalPausedTime'ın transitionTaskInTransaction
      // tarafından temizlenmesi) TEK transaction'da — biri başarısız olursa diğeri de olmaz.
      await runWithRetry(async () => {
        await runTransaction(db, async (transaction) => {
          await transitionTaskInTransaction(transaction, taskId, 'IN_PROGRESS', userId, { expectedVersion });
          transaction.delete(blockerRef);
        });
      });
      return;
    }

    await runWithRetry(async () => {
      await deleteDoc(blockerRef);
    });
  }
};
