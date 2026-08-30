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
// taskTriggers.ts'teki idempotency ledger'ı (processed_events) yalnızca
// Cloud Functions'ın "en az bir kez" teslimat penceresindeki yakın zamanlı
// yeniden-teslimleri yakalamak için var — bu pencere dakikalar/saatler
// mertebesindedir, bu yüzden 7 gün bol bol güvenli bir tampon.
const PROCESSED_EVENT_TTL_DAYS = 7;
const ERROR_LOG_TTL_DAYS = 30;

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
  .schedule('0 2 * * 0')           // Her Pazar 02:00 — .timeZone() set edildiğinde cron
                                    // string'i DOĞRUDAN o saat diliminde yorumlanır (bkz.
                                    // scheduledAudit.ts'teki aynı açıklama), yani bu 02:00
                                    // İSTANBUL saatidir, UTC değil (eskiden yorum "02:00 UTC
                                    // (05:00 TR)" diyordu — 3 saatlik yanıltıcı dokümantasyon
                                    // hatası, bkz. kod denetimi).
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

    console.log(`[Cleanup] ${PROCESSED_EVENT_TTL_DAYS} günden eski idempotency kayıtları siliniyor...`);
    const processedEventCutoff = Date.now() - PROCESSED_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000;
    const deletedProcessedEvents = await deleteOldDocs('processed_events', [
      ['processedAt', '<', processedEventCutoff],
    ]);
    console.log(`[Cleanup] ${deletedProcessedEvents} idempotency kaydı silindi.`);

    // error_logs (isValidErrorLog, firestore.rules) önceden hiç temizlenmiyordu
    // — client tarafından yazılabilen (isSignedIn() ile açık create) tek
    // koleksiyonlardan biri olduğundan, notifications/system_logs gibi bir
    // TTL'e sahip olmaması sınırsız birikime açık bırakıyordu (bkz. kod
    // denetimi).
    console.log(`[Cleanup] ${ERROR_LOG_TTL_DAYS} günden eski hata logları siliniyor...`);
    const errorLogCutoff = Date.now() - ERROR_LOG_TTL_DAYS * 24 * 60 * 60 * 1000;
    const deletedErrorLogs = await deleteOldDocs('error_logs', [
      ['timestamp', '<', errorLogCutoff],
    ]);
    console.log(`[Cleanup] ${deletedErrorLogs} hata logu silindi.`);

    return null;
  });
