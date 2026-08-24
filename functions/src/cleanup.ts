/**
 * Temizlik Fonksiyonu (Cloud Function)
 *
 * cleanupOldNotifications — tek export, iki koleksiyonu temizler:
 *   1. 30 günden eski OKUNMUŞ bildirimler (notifications)
 *   2. 90 günden eski system_logs kayıtları
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

const BATCH_SIZE = 500;
// Spark/1st-gen fonksiyon varsayılan zaman aşımı (60sn) riskine karşı üst
// sınır — bir koleksiyonda birikmiş silinecek kayıt sayısı bu sınırı
// (BATCH_SIZE × MAX_BATCHES_PER_COLLECTION) aşarsa kalanlar bir sonraki
// haftalık koşuda silinir (cutoff her koşuda "şimdi"ye göre yeniden
// hesaplandığından hiçbir kayıt sonsuza dek atlanmaz, yalnızca gecikir) —
// scheduledAudit.ts'teki cursor korumasıyla aynı mühendislik yaklaşımı
// (bkz. kod denetimi: eskiden bu koruma yalnızca scheduledAudit.ts'te vardı).
const MAX_BATCHES_PER_COLLECTION = 20;

/**
 * Belirtilen koleksiyonda verilen koşulları (`wheres`) sağlayan tüm
 * dokümanları sayfalı batch'lerle siler ve silinen kayıt sayısını döner.
 * Bildirim ve system_logs temizleme döngüleri eskiden neredeyse birebir
 * kopyalanmıştı (bkz. kod denetimi) — artık tek yerde.
 */
async function deleteOldDocs(
  collectionName: string,
  wheres: [string, FirebaseFirestore.WhereFilterOp, unknown][]
): Promise<number> {
  let deleted = 0;

  for (let i = 0; i < MAX_BATCHES_PER_COLLECTION; i++) {
    let query: FirebaseFirestore.Query = db.collection(collectionName);
    for (const [field, op, value] of wheres) {
      query = query.where(field, op, value);
    }
    const snap = await query.limit(BATCH_SIZE).get();
    if (snap.empty) return deleted;

    const batch = db.batch();
    snap.docs.forEach((doc: admin.firestore.QueryDocumentSnapshot) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < BATCH_SIZE) return deleted;
  }

  console.warn(`[Cleanup] ${collectionName}: batch sınırına ulaşıldı (${MAX_BATCHES_PER_COLLECTION}×${BATCH_SIZE}), kalan eski kayıtlar sonraki haftalık koşuda silinecek.`);
  return deleted;
}

// ── Eski Bildirimleri ve Sistem Loglarını Temizle ────────────────────────────
export const cleanupOldNotifications = functions
  .region('europe-west1')
  .pubsub
  .schedule('0 2 * * 0')           // Her Pazar 02:00 UTC (05:00 TR)
  .timeZone('Europe/Istanbul')
  .onRun(async (_context: functions.EventContext) => {
    console.log(`[Cleanup] ${NOTIFICATION_TTL_DAYS} günden eski okunmuş bildirimler siliniyor...`);
    const notifCutoff = Date.now() - NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;
    const deletedNotifs = await deleteOldDocs('notifications', [
      ['isRead', '==', true],
      ['timestamp', '<', notifCutoff],
    ]);
    console.log(`[Cleanup] ${deletedNotifs} bildirim silindi.`);

    console.log(`[Cleanup] ${SYSTEM_LOG_TTL_DAYS} günden eski sistem logları siliniyor...`);
    const logCutoff = Date.now() - SYSTEM_LOG_TTL_DAYS * 24 * 60 * 60 * 1000;
    const deletedLogs = await deleteOldDocs('system_logs', [
      ['timestamp', '<', logCutoff],
    ]);
    console.log(`[Cleanup] ${deletedLogs} sistem logu silindi.`);

    return null;
  });
