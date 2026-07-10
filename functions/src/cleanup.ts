/**
 * Temizlik Fonksiyonları (Cloud Functions)
 * 
 * cleanupOldNotifications — 30 günden eski okunmuş bildirimleri siler
 * cleanupSystemLogs       — 90 günden eski system_logs kayıtlarını siler
 * 
 * Deploy: firebase deploy --only functions:cleanupOldNotifications
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const NOTIFICATION_TTL_DAYS = 30;
const SYSTEM_LOG_TTL_DAYS = 90;

// ── Eski Bildirimleri Temizle ────────────────────────────────────────────────
export const cleanupOldNotifications = functions
  .region('europe-west1')
  .pubsub
  .schedule('0 2 * * 0')           // Her Pazar 02:00 UTC (05:00 TR)
  .timeZone('Europe/Istanbul')
  .onRun(async (_context: functions.EventContext) => {
    const cutoff = Date.now() - NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;
    console.log(`[Cleanup] ${NOTIFICATION_TTL_DAYS} günden eski okunmuş bildirimler siliniyor...`);

    let deleted = 0;
    let hasMore = true;

    while (hasMore) {
      const snap = await db
        .collection('notifications')
        .where('isRead', '==', true)
        .where('timestamp', '<', cutoff)
        .limit(500)
        .get();

      if (snap.empty) {
        hasMore = false;
        break;
      }

      const batch = db.batch();
      snap.docs.forEach((doc: admin.firestore.QueryDocumentSnapshot) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snap.size;

      if (snap.size < 500) hasMore = false;
    }

    console.log(`[Cleanup] ${deleted} bildirim silindi.`);

    // System logs temizliği
    const logCutoff = Date.now() - SYSTEM_LOG_TTL_DAYS * 24 * 60 * 60 * 1000;
    let logDeleted = 0;
    let logHasMore = true;

    while (logHasMore) {
      const logSnap = await db
        .collection('system_logs')
        .where('timestamp', '<', logCutoff)
        .limit(200)
        .get();

      if (logSnap.empty) {
        logHasMore = false;
        break;
      }

      const logBatch = db.batch();
      logSnap.docs.forEach((doc: admin.firestore.QueryDocumentSnapshot) => logBatch.delete(doc.ref));
      await logBatch.commit();
      logDeleted += logSnap.size;

      if (logSnap.size < 200) logHasMore = false;
    }

    console.log(`[Cleanup] ${logDeleted} sistem logu silindi.`);
    return null;
  });
