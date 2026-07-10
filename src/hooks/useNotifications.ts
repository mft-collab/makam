/**
 * useNotifications — Gerçek Zamanlı Bildirim Hook'u
 * 
 * Kullanıcıya ait okunmamış bildirimleri Firestore'dan dinler.
 * App.tsx'teki notification snapshot mantığını merkezîleştirir.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  db, collection, query, where, orderBy, limit, onSnapshot,
  doc, updateDoc, writeBatch
} from '../firebase';
import type { Notification } from '../types';

const NOTIF_LIMIT = 5;

interface UseNotificationsReturn {
  notifications: Notification[];
  markAsRead: (notifId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export function useNotifications(userId: string | null): UseNotificationsReturn {
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
        // Logout sırasında oluşan permission hataları sessizce geçilir
        if (!err.message?.toLowerCase().includes('permission')) {
          console.warn('[useNotifications] Snapshot error:', err);
        }
      }
    );

    return unsubscribe;
  }, [userId]);

  const markAsRead = useCallback(async (notifId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { isRead: true });
    } catch (err) {
      console.warn('[useNotifications] markAsRead failed:', err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (notifications.length === 0) return;
    try {
      const batch = writeBatch(db);
      notifications.forEach(n => {
        batch.update(doc(db, 'notifications', n.id), { isRead: true });
      });
      await batch.commit();
    } catch (err) {
      console.warn('[useNotifications] markAllAsRead failed:', err);
    }
  }, [notifications]);

  return { notifications, markAsRead, markAllAsRead };
}
