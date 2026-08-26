/**
 * useNotifications — Gerçek Zamanlı Bildirim Hook'u
 *
 * Kullanıcıya ait okunmamış bildirimleri Firestore'dan dinler.
 * App.tsx'teki notification snapshot mantığını merkezîleştirir.
 *
 * NOT: okundu-işaretleme burada DEĞİL, src/services/notificationService.ts'te
 * yaşar (NotificationPanel.tsx onu kullanır) — bu hook eskiden kendi
 * markAsRead/markAllAsRead'ini de taşıyordu ama hiç çağrılmıyordu ve
 * markAllAsRead'i yalnızca bu hook'un NOTIF_LIMIT=5 ile sınırlı local
 * state'i üzerinde çalışıyordu (servisteki eşdeğeri sunucudan TÜM
 * okunmamışları çeker) — kullanılırsa sessizce eksik işaretleme yapardı.
 */
import { useState, useEffect } from 'react';
import { db, collection, query, where, orderBy, limit, onSnapshot } from '../firebase';
import { logger } from '../lib/logger';
import type { Notification } from '../types';

const NOTIF_LIMIT = 5;

interface UseNotificationsReturn {
  notifications: Notification[];
}

export function useNotifications(
  userId: string | null,
  // App.tsx'teki handleFirestoreError — logout sırasındaki izin hatalarını
  // zaten kendi başına süzüyor (bkz. kod denetimi: bu hook eskiden AYNI
  // süzmeyi burada, logout durumundan habersiz, salt mesaj metnine bakarak
  // ikinci kez ve daha kaba biçimde yapıyor, gerçek bir rules hatasını da
  // sessizce yutuyordu). Verilmezse davranış eskisi gibi yalnızca console'a düşer.
  onError?: (err: unknown, type: string, path: string) => void
): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('isRead', '==', false),
      orderBy('timestamp', 'desc'),
      limit(NOTIF_LIMIT)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setNotifications(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Notification)));
      },
      (err) => {
        if (onError) {
          onError(err, 'list', 'notifications');
        } else {
          logger.warn('[useNotifications] Snapshot error:', err);
        }
      }
    );

    return unsubscribe;
  }, [userId, onError]);

  return { notifications };
}
