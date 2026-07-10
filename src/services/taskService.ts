import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  query, 
  orderBy, 
  onSnapshot,
  getDocs,
  where,
  runTransaction,
  writeBatch,
  getDoc,
  setDoc,
  increment,
  db 
} from '../firebase';
import { Task, TaskStatus, AuditLog } from '../types';
import { calculateDeadline, getSLAConfigForPriority } from '../lib/sla';
import { cleanData } from '../lib/utils';
import { runWithRetry } from '../lib/retry';

export const taskService = {
  async createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'lockVersion' | 'totalPausedTime' | 'status'>, userId: string) {
    return runWithRetry(async () => {
      const now = Date.now();
      const slaConfig = getSLAConfigForPriority(taskData.priority);
      const deadline = typeof taskData.deadline === 'number' && taskData.deadline > 0
        ? taskData.deadline
        : calculateDeadline(new Date(now), slaConfig);

      // İş Kuralı: Admin irtibatlı atanamaz
      if (taskData.coordinatorId) {
        const coordSnap = await getDoc(doc(db, 'users', taskData.coordinatorId!));
        if (coordSnap.exists() && (coordSnap.data() as any).role === 'Admin') {
          throw new Error('Admin rolündeki kullanıcı irtibatlı olarak atanamaz.');
        }
      }

      // İş Kuralı: Alt talimatlar yalnızca Staff (memur) rolüne atanabilir
      if (taskData.parentId) {
        const assigneeSnap = await getDoc(doc(db, 'users', taskData.assigneeId));
        if (assigneeSnap.exists() && (assigneeSnap.data() as any).role !== 'Staff') {
          throw new Error('Alt talimatlar yalnızca memur (Personel) rolündeki personele atanabilir.');
        }
      }

      const docRef = await addDoc(collection(db, 'tasks'), cleanData({
        ...taskData,
        status: 'ASSIGNED',
        deadline,
        createdAt: now,
        updatedAt: now,
        lockVersion: 0,
        totalPausedTime: 0
      }));
      
      await updateDoc(docRef, { id: docRef.id });
      
      // Audit Log
      await addDoc(collection(db, 'audit_logs'), {
        taskId: docRef.id,
        changedBy: userId,
        oldValue: 'None',
        newValue: 'Task Created & Assigned',
        timestamp: now
      });
      // Aggregate Stats
      await setDoc(doc(db, 'system', 'stats'), {
        totalTasks: increment(1),
        status_ASSIGNED: increment(1)
      }, { merge: true });
      
      return docRef.id;
    });
  },

  async transitionTask(
    taskId: string, 
    newStatus: TaskStatus, 
    userId: string, 
    options?: { 
      evidence?: string; 
      evidenceType?: Task['evidenceType'];
      assigneeId?: string;
      expectedVersion?: number;
    }
  ) {
    return runWithRetry(async () => {
      return runTransaction(db, async (transaction) => {
        const taskRef = doc(db, 'tasks', taskId);
        const snapshot = await transaction.get(taskRef);
        
        if (!snapshot.exists()) {
          throw new Error('Task does not exist');
        }

        const task = snapshot.data() as Task;
        const now = Date.now();

        // Optimistic Locking Check
        const currentVersion = task.lockVersion || 0;
        if (options?.expectedVersion !== undefined && currentVersion !== options.expectedVersion) {
          throw new Error(`VERSION_MISMATCH: Beklenen Versiyon ${options.expectedVersion}, Sunucu Versiyonu ${currentVersion}`);
        }

        // --- SLA Pause Logic ---
        let pausedAt: number | null = task.pausedAt ?? null;
        let totalPausedTime = task.totalPausedTime || 0;

        // Rule: Transitions OUT of a pausing state (BLOCKED, AWAITING_APPROVAL)
        if (task.status === 'BLOCKED' || task.status === 'AWAITING_APPROVAL') {
          if (task.pausedAt) {
            const pausedDuration = now - task.pausedAt;
            totalPausedTime += pausedDuration;
            pausedAt = null; // Reset pause marker
          }
        }

        // Rule: Transitions OUT of CRISIS
        const isCrisis = task.status !== 'CANCELLED' && task.status !== 'COMPLETED' && task.deadline < now;
        if (isCrisis && newStatus === 'IN_PROGRESS') {
          const effectiveDeadline = task.deadline + totalPausedTime;
          if (now > effectiveDeadline) {
            // Add the breach debt + 24 hours to paused time, effectively extending the deadline
            const extraTime = now - effectiveDeadline + (24 * 60 * 60 * 1000);
            totalPausedTime += extraTime;
          }
        }

        // Rule: Transitions INTO a pausing state (BLOCKED, AWAITING_APPROVAL)
        if (newStatus === 'BLOCKED' || newStatus === 'AWAITING_APPROVAL') {
          pausedAt = now; // Mark current time as start of pause
        }

        const updateData: Partial<Task> = {
          status: newStatus,
          updatedAt: now,
          lockVersion: currentVersion + 1,
          pausedAt,
          totalPausedTime
        };

        // Görev tamamlandığında completedAt otomatik ayarlanır
        if (newStatus === 'COMPLETED') {
          updateData.completedAt = now;
        }

        if (options?.evidence) {
          updateData.evidence = options.evidence;
          updateData.evidenceType = options.evidenceType;
        }

        if (options?.assigneeId) {
          updateData.assigneeId = options.assigneeId;
        }

        transaction.update(taskRef, cleanData(updateData));

        // Audit Log
        const auditRef = doc(collection(db, 'audit_logs'));
        transaction.set(auditRef, {
          taskId,
          changedBy: userId,
          oldValue: task.status,
          newValue: newStatus,
          timestamp: now,
          changes: {
            status: { old: task.status, new: newStatus }
          }
        });

        // Aggregate Stats
        const statsRef = doc(db, 'system', 'stats');
        transaction.set(statsRef, {
          [`status_${task.status}`]: increment(-1),
          [`status_${newStatus}`]: increment(1)
        }, { merge: true });
      });
    });
  },

  async deleteTask(taskId: string, userId: string, isSubTask = false) {
    return runWithRetry(async () => {
      const taskSnap = await getDoc(doc(db, 'tasks', taskId));
      const taskData = taskSnap.exists() ? (taskSnap.data() as Task) : null;

      // Audit Log: sadece kök görev için yaz (alt görevler için üst makam logu yeterli)
      // Cascade delete subtasks
      const subTasksQuery = query(collection(db, 'tasks'), where('parentId', '==', taskId));
      const subTasksSnapshot = await getDocs(subTasksQuery);
      for (const subDoc of subTasksSnapshot.docs) {
        await this.deleteTask(subDoc.id, userId, true); // isSubTask=true → audit log yazma
      }

      // Toplu sil: blockers
      const blockersQuery = query(collection(db, 'blockers'), where('taskId', '==', taskId));
      const blockersSnapshot = await getDocs(blockersQuery);
      if (!blockersSnapshot.empty) {
        const batch = writeBatch(db);
        blockersSnapshot.docs.forEach(bDoc => batch.delete(bDoc.ref));
        await batch.commit();
      }

      // Toplu sil: audit logs (sadece kök görev için)
      if (!isSubTask) {
        const auditLogsQuery = query(collection(db, 'audit_logs'), where('taskId', '==', taskId));
        const auditLogsSnapshot = await getDocs(auditLogsQuery);
        if (!auditLogsSnapshot.empty) {
          const batch = writeBatch(db);
          auditLogsSnapshot.docs.forEach(aDoc => batch.delete(aDoc.ref));
          await batch.commit();
        }
      }

      await deleteDoc(doc(db, 'tasks', taskId));

      if (!isSubTask) {
        await addDoc(collection(db, 'audit_logs'), {
          taskId,
          changedBy: userId,
          oldValue: taskData?.title ?? 'Deleted',
          newValue: 'Deleted',
          timestamp: Date.now(),
          changes: {
            deleted: { old: false, new: true },
            status: { old: taskData?.status ?? null, new: null }
          }
        });
      }

      // Aggregate Stats
      if (taskData) {
        await setDoc(doc(db, 'system', 'stats'), {
          totalTasks: increment(-1),
          [`status_${taskData.status}`]: increment(-1)
        }, { merge: true });
      }
    });
  },

  async addComment(taskId: string, userId: string, text: string) {
    return runTransaction(db, async (transaction) => {
      const taskRef = doc(db, 'tasks', taskId);
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists()) return;

      const task = snapshot.data() as Task;
      const comments = [...(task.comments || []), {
        userId,
        text,
        timestamp: Date.now()
      }];

      transaction.update(taskRef, {
        comments,
        updatedAt: Date.now(),
        lockVersion: (task.lockVersion || 0) + 1
      });
    });
  },

  async updateTask(taskId: string, data: Partial<Task>, oldTask: Task, userId: string) {
    return runWithRetry(async () => {
      const now = Date.now();

      // İş Kuralı: Admin koordinatör atanamaz
      if (data.coordinatorId) {
        const coordSnap = await getDoc(doc(db, 'users', data.coordinatorId!));
        if (coordSnap.exists() && (coordSnap.data() as any).role === 'Admin') {
          throw new Error('Admin rolündeki kullanıcı koordinatör olarak atanamaz.');
        }
      }

      await runTransaction(db, async (transaction) => {
        const taskRef = doc(db, 'tasks', taskId);
        const snapshot = await transaction.get(taskRef);
        if (!snapshot.exists()) {
          throw new Error('Task does not exist');
        }

        const task = snapshot.data() as Task;
        const currentServerVersion = task.lockVersion || 0;
        const expectedVersion = oldTask.lockVersion || 0;

        if (currentServerVersion !== expectedVersion) {
          throw new Error(`VERSION_MISMATCH: Beklenen Versiyon ${expectedVersion}, Sunucu Versiyonu ${currentServerVersion}`);
        }

        transaction.update(taskRef, cleanData({
          ...data,
          updatedAt: now,
          lockVersion: currentServerVersion + 1
        }));
      });

      await addDoc(collection(db, 'audit_logs'), {
        taskId,
        changedBy: userId,
        oldValue: 'Partial Update',
        newValue: 'Partial Update',
        timestamp: now,
        changes: Object.keys(data).reduce((acc, key) => ({
          ...acc,
          [key]: { 
            old: (oldTask as any)[key] === undefined ? null : (oldTask as any)[key], 
            new: (data as any)[key] === undefined ? null : (data as any)[key] 
          }
        }), {})
      });

      // Aggregate Stats
      if (data.status && data.status !== oldTask.status) {
        await setDoc(doc(db, 'system', 'stats'), {
          [`status_${oldTask.status}`]: increment(-1),
          [`status_${data.status}`]: increment(1)
        }, { merge: true });
      }
    });
  },

  async updateTaskStatus(taskId: string, newStatus: TaskStatus, oldStatus: TaskStatus | undefined, userId: string, evidence?: string, evidenceType?: Task['evidenceType'], expectedVersion?: number) {
    return this.transitionTask(taskId, newStatus, userId, { evidence, evidenceType, expectedVersion });
  },

  async cleanupDatabase() {
    try {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const q = query(
        collection(db, 'notifications'),
        where('isRead', '==', true),
        where('timestamp', '<', thirtyDaysAgo)
      );
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  },

  async clearAuditLogs() {
    const q = query(collection(db, 'audit_logs'));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  async clearSystemLogs() {
    const q = query(collection(db, 'system_logs'));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
};
