import {
  db,
  doc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  updateDoc,
  runTransaction,
  FirebaseError
} from '../firebase';
import { logger } from './logger';
import { conflictDetectionService } from '../services/conflictDetectionService';
import { useUIStore } from '../store/uiStore';
import { transitionTaskInTransaction } from '../services/taskService';
import type { TaskStatus } from '../types';

// Sunucu bu hata kodlarıyla reddettiğinde yeniden deneme sonucu asla değişmez
// (ör. firestore.rules'taki bir iş kuralı ihlali veya bozuk veri) — kuyrukta
// sonsuza dek tutmak yerine mutasyon düşürülür ve kullanıcı bilgilendirilir.
const NON_RETRYABLE_CODES = new Set(['permission-denied', 'invalid-argument']);

export interface OfflineMutation {
  id: string;
  collectionName: string;
  docId?: string;
  action: 'create' | 'update' | 'delete' | 'set';
  data?: any;
  timestamp: number;
  /** 'tasks' 'update' mutasyonları için: kuyruğa alındığı andaki lockVersion.
   *  Senkronizasyonda sunucudaki güncel versiyonla karşılaştırılır — eşleşmezse
   *  görev çevrimdışıyken başkası tarafından değiştirilmiş demektir ve mutasyon
   *  sessizce üzerine yazmak yerine çakışma olarak işlenir. */
  expectedVersion?: number;
  /** 'blockers' create/update mutasyonları için: bu engel yazımıyla AYNI
   *  transaction'da uygulanması gereken görev durum geçişi (ör. yeni engel +
   *  görevi BLOCKED'a alma, ya da son engelin çözümü + görevi IN_PROGRESS'e
   *  döndürme). Online blockerService.addBlocker/resolveBlocker ile birebir
   *  aynı atomiklik garantisini çevrimdışı senkrona da taşır — biri başarısız
   *  olursa diğeri de uygulanmaz, sahipsiz engel/durum kaydı oluşmaz. */
  linkedTaskTransition?: {
    taskId: string;
    newStatus: TaskStatus;
    userId: string;
    expectedVersion?: number;
  };
}

const QUEUE_KEY = 'makam_offline_mutations';

let isSyncing = false;

export const offlineQueue = {
  getQueue(): OfflineMutation[] {
    try {
      const data = localStorage.getItem(QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      logger.error('Failed to parse offline mutations queue:', e);
      return [];
    }
  },

  saveQueue(queue: OfflineMutation[]) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      // Trigger a custom event to update the UI banner
      window.dispatchEvent(new CustomEvent('makam_queue_changed'));
    } catch (e) {
      logger.error('Failed to save offline mutations queue:', e);
    }
  },

  enqueue(
    collectionName: string,
    action: OfflineMutation['action'],
    data?: any,
    docId?: string,
    expectedVersion?: number,
    linkedTaskTransition?: OfflineMutation['linkedTaskTransition']
  ) {
    const queue = this.getQueue();

    // Aynı doküman için kuyrukta zaten bekleyen bir 'update' varsa yeni veriyi
    // onun üzerine birleştir. Firestore updateDoc zaten alan bazlı kısmi
    // güncelleme yaptığından, N ayrı sıralı update yerine tek birleşik update
    // göndermek davranışsal olarak eşdeğerdir (son değer kazanır) — kuyruk
    // şişmesini ve senkronda gereksiz yazma sayısını azaltır. linkedTaskTransition
    // taşıyan mutasyonlar (blocker+görev atomik çifti) birleştirilmez — anlamları
    // basit alan birleştirmesinden farklıdır.
    if (action === 'update' && docId && !linkedTaskTransition) {
      const existing = queue.find(m =>
        m.action === 'update' &&
        m.collectionName === collectionName &&
        m.docId === docId &&
        !m.linkedTaskTransition
      );
      if (existing) {
        existing.data = { ...existing.data, ...data };
        existing.timestamp = Date.now();
        if (existing.expectedVersion === undefined) existing.expectedVersion = expectedVersion;
        this.saveQueue(queue);
        logger.debug(`[Offline Queue] Coalesced update mutation for ${collectionName}/${docId}`);
        return;
      }
    }

    const mutation: OfflineMutation = {
      id: Math.random().toString(36).substring(2, 9),
      collectionName,
      docId,
      action,
      data,
      timestamp: Date.now(),
      expectedVersion,
      linkedTaskTransition
    };
    queue.push(mutation);
    this.saveQueue(queue);
    logger.debug(`[Offline Queue] Enqueued mutation: ${action} on ${collectionName}`);
  },

  async sync(): Promise<boolean> {
    if (isSyncing) {
      logger.debug('[Offline Queue] Sync already in progress. Skipping execution to prevent race conditions.');
      return false;
    }

    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      logger.debug('[Offline Queue] Sync skipped: Browser is offline.');
      return false;
    }

    const queue = this.getQueue();
    if (queue.length === 0) return true;

    isSyncing = true;
    logger.debug(`[Offline Queue] Starting sync for ${queue.length} mutations...`);

    const idsToSync = queue.map(m => m.id);

    // Working copy — mutasyonlar (ID remapping) bu kopya uzerinde yapilir
    const workingQueue: OfflineMutation[] = queue.map(m => ({
      ...m,
      data: m.data ? { ...m.data } : m.data
    }));
    const remaining: OfflineMutation[] = [];

    try {
      for (let i = 0; i < workingQueue.length; i++) {
        const mutation = workingQueue[i]!;
        let hadConflict = false;
        try {
          switch (mutation.action) {
            case 'create': {
              if (mutation.collectionName === 'blockers' && mutation.linkedTaskTransition) {
                const { taskId, newStatus, userId, expectedVersion } = mutation.linkedTaskTransition;
                const blockerRef = doc(collection(db, 'blockers'));
                try {
                  await runTransaction(db, async (transaction) => {
                    await transitionTaskInTransaction(transaction, taskId, newStatus, userId, { expectedVersion });
                    transaction.set(blockerRef, { ...mutation.data, id: blockerRef.id });
                  });
                } catch (transitionErr) {
                  if (conflictDetectionService.detectConflict(transitionErr, taskId, 'Talimat', expectedVersion ?? 0)) {
                    hadConflict = true;
                    break;
                  }
                  throw transitionErr;
                }
                break;
              }
              const docRef = await addDoc(collection(db, mutation.collectionName), {
                ...mutation.data,
                createdAt: mutation.data.createdAt || mutation.timestamp,
                updatedAt: Date.now()
              });
              await updateDoc(docRef, { id: docRef.id });

              // Sonraki kuyruk ogelerinde gecici ID'leri kalici Firestore ID'siyle eslestir.
              // Belirli alan adlarını (id/taskId/parentId/...) sabit kodlamak yerine data
              // nesnesindeki HER alanı tarar — yeni bir referans alanı (ör. relatedTaskId)
              // eklendiğinde bu mantığın ayrıca güncellenmesi gerekmez.
              const tempId = mutation.data?.id;
              if (tempId && docRef.id && tempId !== docRef.id) {
                logger.debug(`[Offline Queue] Remapping ${tempId} -> ${docRef.id}`);
                for (let j = i + 1; j < workingQueue.length; j++) {
                  const item = workingQueue[j]!;
                  if (item.docId === tempId) item.docId = docRef.id;
                  if (item.data && typeof item.data === 'object') {
                    for (const key of Object.keys(item.data)) {
                      if (item.data[key] === tempId) item.data[key] = docRef.id;
                    }
                  }
                }
              }
              break;
            }
            case 'set':
              if (mutation.docId) {
                await setDoc(doc(db, mutation.collectionName, mutation.docId), mutation.data, { merge: true });
              }
              break;
            case 'update':
              if (mutation.docId) {
                if (mutation.collectionName === 'blockers' && mutation.linkedTaskTransition) {
                  const { taskId, newStatus, userId, expectedVersion } = mutation.linkedTaskTransition;
                  const blockerRef = doc(db, 'blockers', mutation.docId);
                  try {
                    await runTransaction(db, async (transaction) => {
                      await transitionTaskInTransaction(transaction, taskId, newStatus, userId, { expectedVersion });
                      transaction.update(blockerRef, { ...mutation.data });
                    });
                  } catch (transitionErr) {
                    if (conflictDetectionService.detectConflict(transitionErr, taskId, 'Talimat', expectedVersion ?? 0)) {
                      hadConflict = true;
                      break;
                    }
                    throw transitionErr;
                  }
                } else if (mutation.collectionName === 'tasks' && mutation.expectedVersion !== undefined) {
                  const taskRef = doc(db, 'tasks', mutation.docId);
                  const result = await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(taskRef);
                    if (!snap.exists()) return { conflict: false };
                    const serverTask = snap.data() as { lockVersion?: number; title?: string; status?: string };
                    const currentVersion = serverTask.lockVersion || 0;
                    if (currentVersion !== mutation.expectedVersion) {
                      return { conflict: true, serverTitle: serverTask.title, serverVersion: currentVersion };
                    }
                    transaction.update(taskRef, {
                      ...mutation.data,
                      updatedAt: Date.now(),
                      lockVersion: currentVersion + 1
                    });
                    return { conflict: false };
                  });
                  if (result.conflict) {
                    conflictDetectionService.detectConflict(
                      new Error('VERSION_MISMATCH: Çevrimdışı değişiklik senkronizasyon çakışması'),
                      mutation.docId,
                      result.serverTitle ?? 'Talimat',
                      mutation.expectedVersion,
                      result.serverVersion
                    );
                    // Çakışma tespit edildiyse mutasyonu sonsuza dek yeniden denemek anlamsızdır
                    // (expectedVersion asla eşleşmeyecektir) — kuyruktan düşürülür, kullanıcı
                    // çakışma bildirimiyle bilgilendirilir.
                    hadConflict = true;
                    break;
                  }
                } else {
                  await updateDoc(doc(db, mutation.collectionName, mutation.docId), {
                    ...mutation.data,
                    updatedAt: Date.now()
                  });
                }
              }
              break;
            case 'delete':
              if (mutation.docId) {
                await deleteDoc(doc(db, mutation.collectionName, mutation.docId));
              }
              break;
          }
          if (hadConflict) {
            logger.warn(`[Offline Queue] Mutation ${mutation.id} dropped due to version conflict (task changed on server while offline)`);
          } else {
            logger.debug(`[Offline Queue] Successfully synced mutation ${mutation.id}`);
          }
        } catch (err) {
          const isNonRetryable = err instanceof FirebaseError && NON_RETRYABLE_CODES.has(err.code);
          if (isNonRetryable) {
            logger.error(`[Offline Queue] Mutation ${mutation.id} kalıcı olarak reddedildi (${(err as FirebaseError).code}), kuyruktan düşürülüyor:`, err);
            useUIStore.getState().addToast({
              title: '⚠️ Senkronizasyon Başarısız',
              body: 'Çevrimdışıyken yapılan bir değişiklik sunucu tarafından reddedildi ve uygulanamadı.',
              type: 'danger'
            });
          } else {
            logger.error(`[Offline Queue] Failed to sync mutation ${mutation.id}:`, err);
            remaining.push(mutation);
          }
        }
      }

      // Safe merge to prevent overwriting new offline mutations added during sync
      const currentQueue = this.getQueue();
      const merged = [
        ...remaining,
        ...currentQueue.filter(item => !idsToSync.includes(item.id))
      ];
      this.saveQueue(merged);
    } finally {
      isSyncing = false;
    }

    return remaining.length === 0;
  }
};

// Auto-trigger sync when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    logger.debug('[Offline Queue] Connection restored! Triggering synchronization...');
    offlineQueue.sync().catch(logger.error);
  });

  // Initial sync check on load
  setTimeout(() => {
    if (window.navigator.onLine) {
      offlineQueue.sync().catch(logger.error);
    }
  }, 3000);
}
