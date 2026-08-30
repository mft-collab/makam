/**
 * #4 — Zamanlanmış İstatistik Mutabakatı (Cloud Function)
 *
 * Her gün Europe/Istanbul saatiyle 03:30'da çalışır (scheduledDailyAudit'in
 * 08:00 koşusundan kasıtlı olarak farklı bir saatte — ikisi de aynı
 * `system/stats` dokümanına yazdığından çakışan yazımları azaltır, tek başına
 * doğruluk için zorunlu değil).
 *
 * `system/stats` dokümanındaki totalTasks/status_X sayaçları client
 * (src/services/taskService.ts) ve scheduledAudit.ts tarafından
 * increment()/decrement() ile BİRBİRİNDEN BAĞIMSIZ güncellenir — tek bir
 * atomik yazıma bağlı değildirler. Eşzamanlı silme/durum-geçişi yarışları
 * (bkz. taskService.ts deleteTask'taki oku-sonra-yaz aralığı) ya da yeniden
 * denenen offline mutasyonlar bu sayaçları gerçek `tasks` koleksiyonundan
 * zamanla koparabilir — panoda "7 tamamlanan / 6 toplam" gibi matematiksel
 * olarak imkânsız bir görünüme yol açar (bkz. kod denetimi;
 * src/components/dashboard/helpers.ts'teki computeStats artık bu sapmayı
 * anlık olarak client tarafında tespit edip yerel görev listesine düşüyor —
 * bu fonksiyon o geçici korumanın KALICI/kök çözümüdür: sayaçları düzenli
 * olarak gerçek kaynakla senkronize eder).
 *
 * `tasks` koleksiyonunun tamamını (potansiyel olarak binlerce doküman) okumak
 * yerine Firestore'un count() agregasyon sorguları kullanılır: her sorgu,
 * eşleşen doküman sayısından bağımsız olarak sabit ve çok düşük maliyetlidir
 * (aggregation query ücretlendirmesi normal doküman okumasından farklı ve
 * çok daha ucuzdur) — Spark kotasına uygun tasarım.
 *
 * Deploy: firebase deploy --only functions:scheduledStatsReconciliation
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// src/types.ts'teki TaskStatusSchema ile AYNI liste — orada zod enum olarak,
// burada (ayrı bir TS projesi olduğundan, bkz. CLAUDE.md) düz bir dizi olarak
// tutulur. Yeni bir durum eklenirse iki tarafta da güncellenmelidir.
const TASK_STATUSES = [
  'ASSIGNED',
  'PENDING_DELEGATION',
  'IN_PROGRESS',
  'BLOCKED',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'CANCELLED',
  'CRISIS',
] as const;

export const scheduledStatsReconciliation = functions
  .region('europe-west1')        // Frankfurt — TR'ye en yakın bölge
  .pubsub
  .schedule('30 3 * * *')        // Her gün 03:30 — aşağıdaki timeZone nedeniyle İstanbul saatiyle yorumlanır
  .timeZone('Europe/Istanbul')
  .onRun(async (_context: functions.EventContext) => {
    const now = Date.now();
    console.log(`[StatsReconciliation] Başlatıldı: ${new Date(now).toISOString()}`);

    try {
      const totalSnap = await db.collection('tasks').count().get();
      const statusSnaps = await Promise.all(
        TASK_STATUSES.map(status =>
          db.collection('tasks').where('status', '==', status).count().get()
        )
      );

      const reconciled: Record<string, number> = {
        totalTasks: totalSnap.data().count,
      };
      TASK_STATUSES.forEach((status, i) => {
        reconciled[`status_${status}`] = statusSnaps[i]!.data().count;
      });

      // Mevcut değerle karşılaştır — sayaçlar zaten tutarlıyken gereksiz bir
      // Firestore yazımı (ve buna bağlı olarak tüm açık dashboard'ların
      // onSnapshot ile yeniden render tetiklemesi) yapılmaz.
      const currentSnap = await db.collection('system').doc('stats').get();
      const current: FirebaseFirestore.DocumentData = currentSnap.exists ? (currentSnap.data() ?? {}) : {};
      const hasDrift = Object.entries(reconciled).some(([key, value]) => (current[key] ?? 0) !== value);

      if (!hasDrift) {
        console.log('[StatsReconciliation] Sapma yok, yazım atlandı.');
        await _logReconciliation(now, false, reconciled);
        return null;
      }

      // merge:true — schema dışı olası ek alanları korur, ama burada
      // hesaplanan her alanı (totalTasks + 8 status_X) gerçek değeriyle
      // TAMAMEN üzerine yazar (increment DEĞİL, doğrudan set).
      await db.collection('system').doc('stats').set(reconciled, { merge: true });
      console.log('[StatsReconciliation] Sapma tespit edildi, system/stats yeniden hesaplanan değerlerle senkronize edildi.', reconciled);
      await _logReconciliation(now, true, reconciled);

      return null;
    } catch (error) {
      console.error('[StatsReconciliation] Hata:', error);
      throw error;
    }
  });

async function _logReconciliation(
  timestamp: number,
  driftDetected: boolean,
  reconciled: Record<string, number>
): Promise<void> {
  await db.collection('system_logs').add({
    type: 'StatsReconciliation',
    timestamp,
    driftDetected,
    reconciled,
    source: 'CloudFunction',
  });
}
