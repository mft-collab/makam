/**
 * useOfflineQueue — Çevrimdışı Kuyruk ve Ağ Durumu Hook'u
 * 
 * Tarayıcı online/offline durumunu ve offlineQueue boyutunu takip eder.
 * Bağlantı geldiğinde kuyruğu otomatik olarak senkronize eder.
 * App.tsx'teki dağınık offline mantığını merkezîleştirir.
 */
import { useState, useEffect, useCallback } from 'react';
import { offlineQueue, type OfflineMutation } from '../lib/offlineQueue';
import { logger } from '../lib/logger';


interface UseOfflineQueueReturn {
  isOffline: boolean;
  queueLength: number;
  pendingMutations: OfflineMutation[];
  syncNow: () => Promise<boolean>;
}

export function useOfflineQueue(): UseOfflineQueueReturn {
  const [isOffline, setIsOffline] = useState(
    typeof window !== 'undefined' ? !window.navigator.onLine : false
  );
  const [queueLength, setQueueLength] = useState(0);
  const [pendingMutations, setPendingMutations] = useState<OfflineMutation[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateNetworkStatus = () => {
      setIsOffline(!window.navigator.onLine);
    };

    const updateQueue = () => {
      const queue = offlineQueue.getQueue();
      setQueueLength(queue.length);
      setPendingMutations(queue);
    };

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    window.addEventListener('makam_queue_changed', updateQueue);

    // Bağlantı geri gelince otomatik sync
    const handleOnline = async () => {
      updateNetworkStatus();
      if (offlineQueue.getQueue().length > 0) {
        logger.debug('[useOfflineQueue] Connection restored, syncing queue...');
        await offlineQueue.sync().catch(logger.warn);
        updateQueue();
      }
    };

    window.addEventListener('online', handleOnline);

    // İlk değerleri yükle
    updateNetworkStatus();
    updateQueue();

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', updateNetworkStatus);
      window.removeEventListener('makam_queue_changed', updateQueue);
    };
  }, []);

  const syncNow = useCallback(async (): Promise<boolean> => {
    try {
      const result = await offlineQueue.sync();
      const queue = offlineQueue.getQueue();
      setQueueLength(queue.length);
      setPendingMutations(queue);
      return result;
    } catch {
      return false;
    }
  }, []);

  return { isOffline, queueLength, pendingMutations, syncNow };
}
