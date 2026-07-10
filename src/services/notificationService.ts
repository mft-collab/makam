import { collection, addDoc, query, where, getDocs, updateDoc, setDoc, doc, limit, orderBy, writeBatch } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import { db, messaging, auth } from '../firebase';
import type { Notification as AppNotification, Task, User } from '../types';
import { IDLE_THRESHOLD_MS } from '../constants';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const notificationService = {
  async requestPermissionAndGetToken(userId: string): Promise<boolean> {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        if (!messaging) {
          console.warn('Messaging is not supported or not initialized, but notification permission was natively granted.');
          return true;
        }
        
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        if (!vapidKey) {
          console.warn('VITE_FIREBASE_VAPID_KEY is not set');
          return true;
        }
        if (vapidKey.length !== 87) {
          console.warn(`[Notification] WARNING: VITE_FIREBASE_VAPID_KEY is ${vapidKey.length} characters long. Standard Firebase Web Push VAPID keys must be exactly 87 characters (usually starting with 'B'). An incorrect VAPID key will cause browser subscription errors.`);
        }
        
        try {
          const token = await getToken(messaging, {
            vapidKey
          });
          
          if (token) {
            // Safe Update: query by 'uid' first to get the correct document reference (handles email or uid doc IDs)
            const userDoc = await getDocs(query(collection(db, 'users'), where('uid', '==', userId)));
            if (!userDoc.empty && userDoc.docs[0]) {
              const docRef = userDoc.docs[0].ref;
              const userData = userDoc.docs[0].data() as User;
              const tokens = userData.fcmTokens || [];
              if (!tokens.includes(token)) {
                await updateDoc(docRef, {
                  fcmTokens: [...tokens, token]
                });
              }
            } else {
              // Fallback: update using direct userId reference if query was empty
              const userRef = doc(db, 'users', userId);
              await setDoc(userRef, {
                fcmTokens: [token]
              }, { merge: true });
            }
          }
        } catch (tokenError) {
          console.warn('Error getting FCM token, but native permission is granted:', tokenError);
          // Return true because notification permission is granted, enabling local push alert fallbacks!
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error requesting permission:', error);
      throw error;
    }
  },

  async createNotification(notification: Omit<AppNotification, 'id'>) {
    try {
      return await addDoc(collection(db, 'notifications'), notification);
    } catch (error) {
      return handleFirestoreError(error, OperationType.WRITE, 'notifications');
    }
  },

  async getUnreadNotifications(userId: string) {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('isRead', '==', false),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    try {
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppNotification));
    } catch (error) {
      return handleFirestoreError(error, OperationType.GET, 'notifications');
    }
  },

  async markAsRead(notificationId: string) {
    const ref = doc(db, 'notifications', notificationId);
    try {
      return await updateDoc(ref, { isRead: true });
    } catch (error) {
      return handleFirestoreError(error, OperationType.WRITE, `notifications/${notificationId}`);
    }
  },

  async markAllAsRead(userId: string) {
    try {
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        where('isRead', '==', false)
      );
      const snapshot = await getDocs(q);
      
      // Batch update to mark all as read
      const batch = writeBatch(db);
      snapshot.docs.forEach(document => {
        batch.update(document.ref, { isRead: true });
      });
      await batch.commit();
    } catch (error) {
      return handleFirestoreError(error, OperationType.WRITE, `notifications`);
    }
  },

  /**
   * #3 NOT: Bu fonksiyon şu an client-side çalışıyor.
   * Üretimde Firebase Cloud Functions'a taşınmalı:
   * functions/src/scheduledAudit.ts → pubsub.schedule('every 24 hours')
   * 
   * Geçici olarak duplicate koruması eklendi: 23 saat içinde audit çalışmaz.
   */
  async performAudit(tasks: Task[], admins: User[]) {
    const now = Date.now();
    const AUDIT_COOLDOWN_MS = 23 * 60 * 60 * 1000; // 23 saat

    // Duplicate guard: son audit zamanını kontrol et
    try {
      const lastAuditSnap = await getDocs(
        query(collection(db, 'system_logs'),
          where('type', '==', 'DailyAudit'),
          orderBy('timestamp', 'desc'),
          limit(1)
        )
      );
      if (!lastAuditSnap.empty && lastAuditSnap.docs.length > 0) {
        const lastTimestamp = lastAuditSnap.docs[0]?.data()?.timestamp as number | undefined;
        if (lastTimestamp && now - lastTimestamp < AUDIT_COOLDOWN_MS) {
          console.log('[Audit] Son 23 saat içinde çalıştırıldı, atlandı.');
          return;
        }
      }
    } catch {
      // Log yoksa veya erişim hatası → devam et
    }

    const idleTasks = tasks.filter(t => 
      t.status !== 'COMPLETED' && 
      t.status !== 'CANCELLED' && 
      (now - t.updatedAt) > IDLE_THRESHOLD_MS
    );

    if (idleTasks.length === 0) return;

    for (const admin of admins) {
      // Check if an unread Crisis notification already exists to prevent spam
      const existingQ = query(
        collection(db, 'notifications'),
        where('userId', '==', admin.uid),
        where('type', '==', 'Crisis'),
        where('isRead', '==', false),
        limit(1)
      );
      try {
        const existingSnap = await getDocs(existingQ);
        if (!existingSnap.empty) continue;
      } catch (e) {
        // Ignore read errors here to prevent breaking the flow
      }

      await this.createNotification({
        userId: admin.uid,
        title: 'KRİTİK: Atalet Uyarısı',
        message: `${idleTasks.length} adet talimat 24 saattir işlem görmedi. Sistem otomatik kriz moduna geçti.`,
        type: 'Crisis',
        timestamp: now,
        isRead: false
      });
    }
    
    try {
      await addDoc(collection(db, 'system_logs'), {
        type: 'DailyAudit',
        timestamp: now,
        idleTaskCount: idleTasks.length
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'system_logs');
    }
  }

};
