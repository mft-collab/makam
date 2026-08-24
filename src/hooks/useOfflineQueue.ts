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

    window.addEventListener('offline', updateNetworkStatus);
    window.addEventListener('makam_queue_changed', updateQueue);

    // Bağlantı geri gelince yalnızca ağ durumu güncellenir — senkronizasyonun
    // KENDİSİ offlineQueue.ts'teki modül seviyesi 'online' listener'ında
    // tetiklenir (bkz. offlineQueue.ts sonu). Burada AYRICA offlineQueue.sync()
    // çağırmak, aynı senkronu iki bağımsız yerden tetikleyip (eskiden isSyncing
    // mutex'i sayesinde çakışma olmasa da) sorumluluğu gereksiz yere ikiye
    // bölüyordu (bkz. kod denetimi). Kuyruk uzunluğu zaten offlineQueue.sync()
    // sonunda dispatch edilen 'makam_queue_changed' ile buradan güncellenir.
    window.addEventListener('online', updateNetworkStatus);

    // İlk değerleri yükle
    updateNetworkStatus();
    updateQueue();

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
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
    } catch (e) {
      logger.error('[useOfflineQueue] Manuel senkronizasyon başarısız:', e);
      return false;
    }
  }, []);

  return { isOffline, queueLength, pendingMutations, syncNow };
}
