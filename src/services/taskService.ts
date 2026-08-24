import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  getDocs,
  where,
  runTransaction,
  writeBatch,
  getDoc,
  setDoc,
  increment,
  db
} from '../firebase';
import type { Transaction } from 'firebase/firestore';
import { Task, TaskStatus, User } from '../types';
import { calculateDeadline, getSLAConfigForPriority } from '../lib/sla';
import { cleanData } from '../lib/utils';
import { runWithRetry } from '../lib/retry';
import { isValidTaskTransition } from '../lib/taskStateMachine';

/**
 * Görev geçişinin tüm okuma+yazma mantığını mevcut bir transaction içinde
 * uygular — blockerService gibi çağıranlar, engel dokümanı yazımını görev
 * geçişiyle AYNI transaction'a katarak (ör. engel oluşturma + görev BLOCKED'a
 * alma) atomikliği garanti edebilir. Firestore kuralı: bir transaction'da
 * tüm okumalar tüm yazmalardan önce gelmeli — bu nedenle bu fonksiyon
 * çağrıldığı transaction'daki İLK işlem olmalı (kendi transaction.get'i hariç
 * başka yazma yapılmamış olmalı).
 */
async function transitionTaskInTransaction(
  transaction: Transaction,
  taskId: string,
  newStatus: TaskStatus,
  userId: string,
  options?: {
    evidence?: string;
    evidenceType?: Task['evidenceType'];
    assigneeId?: string;
    expectedVersion?: number;
    /** Çevrimdışı kuyruktan senkronize edilen geçişler için: geçişin sunucuya
     *  YAZILDIĞI an değil, kullanıcının çevrimdışıyken bu aksiyonu GERÇEKTEN
     *  yaptığı an (offlineQueue'nun `mutation.timestamp`'i). Verilmezse
     *  (çevrimiçi çağrılarda olduğu gibi) `Date.now()`'a düşer. Bu olmadan,
     *  ör. bir görev 14:00'de çevrimdışı BLOCKED'a alınıp 17:00'de senkronize
     *  edildiğinde `pausedAt` 17:00 olarak işaretlenir ve gerçek 3 saatlik
     *  duraklama SLA hesabına hiç yansımaz (deadline haksız yere daralır). */
    timestampOverride?: number;
  }
): Promise<Task> {
  const taskRef = doc(db, 'tasks', taskId);
  const snapshot = await transaction.get(taskRef);

  if (!snapshot.exists()) {
    throw new Error('Task does not exist');
  }

  const task = snapshot.data() as Task;
  const now = options?.timestampOverride ?? Date.now();

  // Optimistic Locking Check
  const currentVersion = task.lockVersion || 0;
  if (options?.expectedVersion !== undefined && currentVersion !== options.expectedVersion) {
    throw new Error(`VERSION_MISMATCH: Beklenen Versiyon ${options.expectedVersion}, Sunucu Versiyonu ${currentVersion}`);
  }

  // Client-side savunma hattı — firestore.rules'taki isValidTransition ile
  // aynı kurallar (bkz. lib/taskStateMachine.ts). Rules zaten bunu ayrıca
  // uyguluyor; bu kontrol yalnızca hatayı sunucuya gitmeden, daha erken ve
  // daha anlaşılır bir mesajla yakalar.
  if (!isValidTaskTransition(task.status, newStatus)) {
    throw new Error(`INVALID_TRANSITION: '${task.status}' durumundan '${newStatus}' durumuna geçiş izinli değil.`);
  }

  // --- SLA Pause Logic ---
  let pausedAt: number | null = task.pausedAt ?? null;
  let totalPausedTime = task.totalPausedTime || 0;

  // Rule: Transitions OUT of a pausing state (BLOCKED, AWAITING_APPROVAL, PENDING_DELEGATION)
  if (task.status === 'BLOCKED' || task.status === 'AWAITING_APPROVAL' || task.status === 'PENDING_DELEGATION') {
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

  // Rule: Transitions INTO a pausing state (BLOCKED, AWAITING_APPROVAL, PENDING_DELEGATION)
  if (newStatus === 'BLOCKED' || newStatus === 'AWAITING_APPROVAL' || newStatus === 'PENDING_DELEGATION') {
    pausedAt = now; // Mark current time as start of pause
  }

  const updateData: Partial<Task> = {
    status: newStatus,
    updatedAt: now,
    lockVersion: currentVersion + 1,
    pausedAt,
    totalPausedTime,
    // changedBy ayrıca audit_logs dokümanına da yazılıyor (aşağıda), ama görev
    // dokümanının kendisinde de tutulur — aksi halde onTaskStatusChanged (Cloud
    // Function) trigger'ı after.changedBy'ı hiç okuyamaz ve "değiştiren kişiye
    // bildirim gönderme" filtresi asla çalışmaz (kullanıcı kendi değişikliğinde
    // bile bildirim alır).
    changedBy: userId
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

  return task;
}

export { transitionTaskInTransaction };

/**
 * Genel (durum-dışı) görev güncellemesinin transaction mantığı — mevcut bir
 * transaction içinde çalışır ki offlineQueue senkronu (bkz. offlineQueue.ts),
 * transitionTaskInTransaction'la aynı desende, online taskService.updateTask
 * ile BİREBİR AYNI audit-log/versiyon/stats davranışını offline'da da
 * uygulayabilsin. oldTask yalnızca audit diff'inin "eski değer" tabanı ve
 * optimistic-locking beklenen versiyonu için kullanılır (client'ın enqueue
 * anındaki anlık görüntüsü) — transaction'ın kendi okuduğu sunucu verisi
 * yalnızca versiyon karşılaştırması için kullanılır.
 */
async function updateTaskInTransaction(
  transaction: Transaction,
  taskId: string,
  data: Partial<Task>,
  oldTask: Task,
  userId: string,
  options?: { timestampOverride?: number }
): Promise<Task> {
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

  const now = options?.timestampOverride ?? Date.now();

  transaction.update(taskRef, cleanData({
    ...data,
    updatedAt: now,
    lockVersion: currentServerVersion + 1
  }));

  // Audit Log — görev güncellemesiyle aynı transaction içinde yazılır ki
  // biri başarısız olursa ikisi de geri alınsın (denetim izi bütünlüğü).
  const auditRef = doc(collection(db, 'audit_logs'));
  transaction.set(auditRef, {
    taskId,
    changedBy: userId,
    oldValue: 'Kısmi Güncelleme',
    newValue: 'Kısmi Güncelleme',
    timestamp: now,
    changes: (Object.keys(data) as (keyof Task)[]).reduce((acc, key) => ({
      ...acc,
      [key]: {
        old: oldTask[key] === undefined ? null : oldTask[key],
        new: data[key] === undefined ? null : data[key]
      }
    }), {})
  });

  // Aggregate Stats — aynı transaction içinde
  if (data.status && data.status !== oldTask.status) {
    const statsRef = doc(db, 'system', 'stats');
    transaction.set(statsRef, {
      [`status_${oldTask.status}`]: increment(-1),
      [`status_${data.status}`]: increment(1)
    }, { merge: true });
  }

  return task;
}

export { updateTaskInTransaction };

export const taskService = {
  async createTask(taskData: Partial<Task>, userId: string, options?: { timestampOverride?: number }) {
    return runWithRetry(async () => {
      const now = options?.timestampOverride ?? Date.now();
      const slaConfig = getSLAConfigForPriority(taskData.priority ?? 'Medium');
      const deadline = typeof taskData.deadline === 'number' && taskData.deadline > 0
        ? taskData.deadline
        : calculateDeadline(new Date(now), slaConfig);

      // İş Kuralı: Admin irtibatlı atanamaz
      if (taskData.coordinatorId) {
        const coordSnap = await getDoc(doc(db, 'users', taskData.coordinatorId!));
        if (coordSnap.exists() && (coordSnap.data() as User).role === 'Admin') {
          throw new Error('Admin rolündeki kullanıcı irtibatlı olarak atanamaz.');
        }
      }

      // İş Kuralı: Alt talimatlar yalnızca Staff (memur) rolüne atanabilir
      if (taskData.parentId) {
        const assigneeSnap = await getDoc(doc(db, 'users', taskData.assigneeId!));
        if (assigneeSnap.exists() && (assigneeSnap.data() as User).role !== 'Staff') {
          throw new Error('Alt talimatlar yalnızca Memur rolündeki personele atanabilir.');
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
        oldValue: 'Yok',
        newValue: 'Talimat Oluşturuldu ve Atandı',
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
      return runTransaction(db, (transaction) =>
        transitionTaskInTransaction(transaction, taskId, newStatus, userId, options)
      );
    });
  },

  async deleteTask(taskId: string, userId: string) {
    return runWithRetry(async () => {
      const rootSnap = await getDoc(doc(db, 'tasks', taskId));
      const rootData = rootSnap.exists() ? (rootSnap.data() as Task) : null;

      // Kök görev + tüm iç içe alt görevleri seviye seviye (BFS) topla — silme
      // öncesi hiçbir yazma yapılmaz, böylece yarıda kalan bir hata veri
      // tutarsızlığı bırakmaz (tüm silme/istatistik işlemleri tek bir atomik
      // batch'te yapılır). Önceki hali her düğüm için ayrı bir getDoc + ayrı
      // bir getDocs çağırıyordu (N düğüm → ~2N round-trip); burada aynı
      // seviyedeki tüm ebeveyn id'leri `parentId in [...]` ile TEK sorguda
      // toplanır (Firestore 'in' sınırı 30 olduğundan büyük seviyeler 30'luk
      // gruplara bölünür) ve düğüm verisi zaten sorgu sonucunda geldiği için
      // ayrıca getDoc ile yeniden okunmaz.
      const tasksToDelete: { id: string; status: TaskStatus }[] = [];
      if (rootSnap.exists()) {
        tasksToDelete.push({ id: taskId, status: rootData!.status });
      }
      let currentLevelIds = [taskId];
      while (currentLevelIds.length > 0) {
        const idChunks: string[][] = [];
        for (let i = 0; i < currentLevelIds.length; i += 30) {
          idChunks.push(currentLevelIds.slice(i, i + 30));
        }
        const levelSnapshots = await Promise.all(
          idChunks.map(chunk => getDocs(query(collection(db, 'tasks'), where('parentId', 'in', chunk))))
        );
        const levelChildren = levelSnapshots.flatMap(snap =>
          snap.docs.map(d => ({ id: d.id, status: (d.data() as Task).status }))
        );
        tasksToDelete.push(...levelChildren);
        currentLevelIds = levelChildren.map(c => c.id);
      }

      if (tasksToDelete.length === 0) return;

      const blockerSnapshots = await Promise.all(
        tasksToDelete.map(t => getDocs(query(collection(db, 'blockers'), where('taskId', '==', t.id))))
      );

      // Firestore batch'leri en fazla 500 işlem alır — güvenli pay için 450'de böl.
      const batches: ReturnType<typeof writeBatch>[] = [];
      let batch = writeBatch(db);
      let opCount = 0;
      const addOp = (fn: (b: ReturnType<typeof writeBatch>) => void) => {
        if (opCount >= 450) {
          batches.push(batch);
          batch = writeBatch(db);
          opCount = 0;
        }
        fn(batch);
        opCount++;
      };

      // NOT: Görev silindiğinde denetim izi bilinçli olarak SİLİNMİYOR — audit_logs
      // artık firestore.rules'ta değiştirilemez/silinemez; görevin geçmişi (silme
      // dahil) kanıt bütünlüğü için korunur.
      tasksToDelete.forEach(t => addOp(b => b.delete(doc(db, 'tasks', t.id))));
      blockerSnapshots.forEach(snap => snap.docs.forEach(bDoc => addOp(b => b.delete(bDoc.ref))));

      addOp(b => b.set(doc(collection(db, 'audit_logs')), {
        taskId,
        changedBy: userId,
        oldValue: rootData?.title ?? 'Silindi',
        newValue: 'Silindi',
        timestamp: Date.now(),
        changes: {
          deleted: { old: false, new: true },
          status: { old: rootData?.status ?? null, new: null }
        }
      }));

      // Aggregate Stats — silinen her görev kendi statüsü üzerinden düşülür
      const statusDeltas: Record<string, number> = {};
      tasksToDelete.forEach(t => {
        statusDeltas[`status_${t.status}`] = (statusDeltas[`status_${t.status}`] ?? 0) - 1;
      });
      const statsPayload: Record<string, ReturnType<typeof increment>> = {
        totalTasks: increment(-tasksToDelete.length)
      };
      Object.entries(statusDeltas).forEach(([key, value]) => {
        if (value !== 0) statsPayload[key] = increment(value);
      });
      addOp(b => b.set(doc(db, 'system', 'stats'), statsPayload, { merge: true }));

      batches.push(batch);
      await Promise.all(batches.map(b => b.commit()));
    });
  },

  async addComment(taskId: string, userId: string, text: string, expectedVersion?: number) {
    return runWithRetry(async () => runTransaction(db, async (transaction) => {
      const taskRef = doc(db, 'tasks', taskId);
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists()) return;

      const task = snapshot.data() as Task;
      const currentVersion = task.lockVersion || 0;

      // Optimistic Locking Check
      if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
        throw new Error(`VERSION_MISMATCH: Beklenen Versiyon ${expectedVersion}, Sunucu Versiyonu ${currentVersion}`);
      }

      const comments = [...(task.comments || []), {
        userId,
        text,
        timestamp: Date.now()
      }];

      transaction.update(taskRef, {
        comments,
        updatedAt: Date.now(),
        lockVersion: currentVersion + 1
      });
    }));
  },

  async updateTask(taskId: string, data: Partial<Task>, oldTask: Task, userId: string, options?: { timestampOverride?: number }) {
    return runWithRetry(async () => {
      // İş Kuralı: Admin irtibatlı atanamaz
      if (data.coordinatorId) {
        const coordSnap = await getDoc(doc(db, 'users', data.coordinatorId!));
        if (coordSnap.exists() && (coordSnap.data() as User).role === 'Admin') {
          throw new Error('Admin rolündeki kullanıcı irtibatlı olarak atanamaz.');
        }
      }

      await runTransaction(db, (transaction) =>
        updateTaskInTransaction(transaction, taskId, data, oldTask, userId, options)
      );
    });
  },

  async updateTaskStatus(taskId: string, newStatus: TaskStatus, oldStatus: TaskStatus | undefined, userId: string, evidence?: string, evidenceType?: Task['evidenceType'], expectedVersion?: number) {
    return this.transitionTask(taskId, newStatus, userId, { evidence, evidenceType, expectedVersion });
  },

  // İzin/mazeret devri: görev başka bir Müdür'e devredilir ve PENDING_DELEGATION'a
  // alınır (SLA sayacı BLOCKED/AWAITING_APPROVAL ile aynı şekilde duraklar).
  // Yeni sorumlunun Müdür olması firestore.rules'ta da (isValidTaskBusinessRules)
  // AYRICA doğrulanır — buradaki kontrol yalnızca client'a erken/anlaşılır bir
  // hata mesajı vermek için ikinci bir savunma hattıdır (bkz. kod denetimi).
  async delegateTask(taskId: string, newAssigneeId: string, userId: string, expectedVersion?: number) {
    const assigneeSnap = await getDoc(doc(db, 'users', newAssigneeId));
    if (assigneeSnap.exists() && (assigneeSnap.data() as User).role !== 'Manager') {
      throw new Error('İzin/mazeret devri yalnızca Müdür rolündeki personele yapılabilir.');
    }
    return this.transitionTask(taskId, 'PENDING_DELEGATION', userId, { assigneeId: newAssigneeId, expectedVersion });
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
  }
};
