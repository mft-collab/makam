import { getToken } from 'firebase/messaging';
import { collection, addDoc, query, where, getDocs, updateDoc, setDoc, doc, limit, orderBy, writeBatch, db, messaging, auth } from '../firebase';
import type { Notification as AppNotification, User } from '../types';

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

  // Kullanıcının panelde GÖRDÜĞÜ (useNotifications'ın limit(5) ile çektiği)
  // bildirimlerin id'leri geçilir — eskiden burada sunucudan TÜM okunmamış
  // bildirimler sorgulanıp toptan işaretleniyordu; panel yalnızca en yeni 5'ini
  // gösterdiğinden, 5'ten eski hiç görülmemiş bir bildirim (ör. bir Kriz
  // uyarısı) kullanıcı hiç görmeden sessizce "okundu" işaretlenip kalıcı
  // olarak kayboluyordu (bkz. kod denetimi). Artık yalnızca gerçekten
  // gösterilmiş olan id'ler işaretlenir — hiçbir bildirim görülmeden kaybolmaz.
  async markManyAsRead(notificationIds: string[]) {
    if (notificationIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      notificationIds.forEach(id => {
        batch.update(doc(db, 'notifications', id), { isRead: true });
      });
      await batch.commit();
    } catch (error) {
      return handleFirestoreError(error, OperationType.WRITE, `notifications`);
    }
  },

};
