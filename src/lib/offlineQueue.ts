import {
  db,
  doc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  updateDoc
} from '../firebase';
import { logger } from './logger';

export interface OfflineMutation {
  id: string;
  collectionName: string;
  docId?: string;
  action: 'create' | 'update' | 'delete' | 'set';
  data?: any;
  timestamp: number;
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

  enqueue(collectionName: string, action: OfflineMutation['action'], data?: any, docId?: string) {
    const queue = this.getQueue();
    const mutation: OfflineMutation = {
      id: Math.random().toString(36).substring(2, 9),
      collectionName,
      docId,
      action,
      data,
      timestamp: Date.now()
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
        try {
          switch (mutation.action) {
            case 'create': {
              const docRef = await addDoc(collection(db, mutation.collectionName), {
                ...mutation.data,
                createdAt: mutation.data.createdAt || mutation.timestamp,
                updatedAt: Date.now()
              });
              await updateDoc(docRef, { id: docRef.id });

              // Sonraki kuyruk ogelerinde gecici ID'leri kalici Firestore ID'siyle eslestir
              const tempId = mutation.data?.id;
              if (tempId && docRef.id && tempId !== docRef.id) {
                logger.debug(`[Offline Queue] Remapping ${tempId} -> ${docRef.id}`);
                for (let j = i + 1; j < workingQueue.length; j++) {
                  const item = workingQueue[j]!;
                  if (item.docId === tempId) item.docId = docRef.id;
                  if (item.data) {
                    if (item.data.id === tempId) item.data.id = docRef.id;
                    if (item.data.taskId === tempId) item.data.taskId = docRef.id;
                    if (item.data.parentId === tempId) item.data.parentId = docRef.id;
                    if (item.data.blockedTaskId === tempId) item.data.blockedTaskId = docRef.id;
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
                await updateDoc(doc(db, mutation.collectionName, mutation.docId), {
                  ...mutation.data,
                  updatedAt: Date.now()
                });
              }
              break;
            case 'delete':
              if (mutation.docId) {
                await deleteDoc(doc(db, mutation.collectionName, mutation.docId));
              }
              break;
          }
          logger.debug(`[Offline Queue] Successfully synced mutation ${mutation.id}`);
        } catch (err) {
          logger.error(`[Offline Queue] Failed to sync mutation ${mutation.id}:`, err);
          remaining.push(mutation);
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
