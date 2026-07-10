import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  db 
} from '../firebase';
import { taskService } from './taskService';
import { TaskStatus } from '../types';

export const blockerService = {
  async addBlocker(taskId: string, reason: string, userId: string, oldStatus: TaskStatus) {
    const blockerRef = await addDoc(collection(db, 'blockers'), {
      taskId,
      reason,
      isResolved: false,
      createdAt: Date.now()
    });
    await updateDoc(blockerRef, { id: blockerRef.id });
    
    // Update task status to Blocked
    await taskService.updateTaskStatus(taskId, 'BLOCKED', oldStatus, userId);
    return blockerRef.id;
  },

  async resolveBlocker(blockerId: string, taskId: string, otherActiveCount: number, userId: string) {
    await updateDoc(doc(db, 'blockers', blockerId), {
      isResolved: true,
      resolvedAt: Date.now()
    });

    // If no more active blockers for this task, set back to In_Progress
    if (otherActiveCount === 0) {
      await taskService.updateTaskStatus(taskId, 'IN_PROGRESS', 'BLOCKED', userId);
    }
  },

  async editBlocker(blockerId: string, reason: string) {
    await updateDoc(doc(db, 'blockers', blockerId), { reason });
  },

  async deleteBlocker(blockerId: string) {
    await deleteDoc(doc(db, 'blockers', blockerId));
  }
};
