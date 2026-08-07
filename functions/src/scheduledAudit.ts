/**
 * #3 — Zamanlanmış Günlük Denetim (Cloud Function)
 * 
 * Her gün saat 08:00 TR saatinde çalışır.
 * 24 saattir güncellenmemiş görevleri tespit eder,
 * Admin kullanıcılara kriz bildirimi gönderir ve
 * ilgili görevleri otomatik olarak CRISIS durumuna alır.
 * 
 * Client-side performAudit() artık bu fonksiyon devredeyken devre dışı kalabilir.
 * Deploy: firebase deploy --only functions:scheduledDailyAudit
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const IDLE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 saat

// Spark (ücretsiz) plan zaman aşımı/kota riskine karşı üst sınır — kalan görevler
// bir sonraki günlük koşuda (cron zaten her gün tekrar çalışıyor) işlenir.
const MAX_TASKS_PER_RUN = 500;

export const scheduledDailyAudit = functions
  .region('europe-west1')        // Frankfurt — TR'ye en yakın bölge
  .pubsub
  .schedule('0 8 * * *')         // Her gün 08:00 — aşağıdaki timeZone nedeniyle İstanbul saatiyle yorumlanır
  .timeZone('Europe/Istanbul')
  .onRun(async (_context: functions.EventContext) => {
    const now = Date.now();
    console.log(`[DailyAudit] Başlatıldı: ${new Date(now).toISOString()}`);

    try {
      // 1. Aktif görevleri çek
      const tasksSnap = await db
        .collection('tasks')
        .where('status', 'not-in', ['COMPLETED', 'CANCELLED'])
        .limit(MAX_TASKS_PER_RUN)
        .get();

      if (tasksSnap.empty) {
        console.log('[DailyAudit] Aktif görev yok, çıkılıyor.');
        return null;
      }

      // 2. Atıl görevleri filtrele
      const idleTasks = tasksSnap.docs.filter((doc: admin.firestore.QueryDocumentSnapshot) => {
        const data = doc.data();
        return (now - (data.updatedAt ?? 0)) > IDLE_THRESHOLD_MS;
      });

      console.log(`[DailyAudit] ${idleTasks.length} atıl görev tespit edildi.`);

      if (idleTasks.length === 0) {
        await _logAudit(now, 0, 'no_idle_tasks');
        return null;
      }

      // 3. Batch: atıl görevleri CRISIS'e al, audit ve istatistikleri birlikte güncelle
      const statusDeltas: Record<string, number> = { status_CRISIS: idleTasks.length };
      for (const taskDoc of idleTasks) {
        const status = taskDoc.data().status;
        statusDeltas[`status_${status}`] = (statusDeltas[`status_${status}`] ?? 0) - 1;
      }

      const batches: admin.firestore.WriteBatch[] = [];
      let batch = db.batch();
      let writeCount = 0;
      const commitIfFull = () => {
        if (writeCount >= 450) {
          batches.push(batch);
          batch = db.batch();
          writeCount = 0;
        }
      };

      for (const taskDoc of idleTasks) {
        const task = taskDoc.data();
        batch.update(taskDoc.ref, {
          status: 'CRISIS',
          updatedAt: now,
          changedBy: 'system:scheduledDailyAudit',
          lockVersion: admin.firestore.FieldValue.increment(1),
        });
        writeCount++;

        const auditRef = db.collection('audit_logs').doc();
        batch.set(auditRef, {
          taskId: taskDoc.id,
          changedBy: 'system:scheduledDailyAudit',
          oldValue: task.status,
          newValue: 'CRISIS',
          changes: {
            status: { old: task.status, new: 'CRISIS' },
          },
          timestamp: now,
        });
        writeCount++;
        commitIfFull();
      }

      const statsPayload: Record<string, admin.firestore.FieldValue> = {};
      Object.entries(statusDeltas).forEach(([key, value]) => {
        if (value !== 0) statsPayload[key] = admin.firestore.FieldValue.increment(value);
      });
      batch.set(db.collection('system').doc('stats'), statsPayload, { merge: true });
      writeCount++;

      if (writeCount > 0) batches.push(batch);
      await Promise.all(batches.map(b => b.commit()));
      console.log(`[DailyAudit] ${idleTasks.length} görev CRISIS durumuna alındı.`);

      // 4. Admin kullanıcıları bul
      const adminsSnap = await db
        .collection('users')
        .where('role', 'in', ['Admin', 'Manager'])
        .get();

      // 5. Her admin'e bildirim oluştur
      const notifBatch = db.batch();
      for (const adminDoc of adminsSnap.docs) {
        const notifRef = db.collection('notifications').doc();
        notifBatch.set(notifRef, {
          userId: adminDoc.id,
          title: '🚨 Otomatik Kriz Tespiti',
          message: `${idleTasks.length} görev 24 saattir hareketsiz kaldı. Sistem bu görevleri KRİZ moduna aldı.`,
          type: 'Crisis',
          timestamp: now,
          isRead: false,
          taskIds: idleTasks.map((d: admin.firestore.QueryDocumentSnapshot) => d.id),
        });
      }
      await notifBatch.commit();
      console.log(`[DailyAudit] ${adminsSnap.size} yöneticiye bildirim gönderildi.`);

      // 6. Audit logu kaydet
      await _logAudit(now, idleTasks.length, 'crisis_escalated');

      return null;
    } catch (error) {
      console.error('[DailyAudit] Hata:', error);
      throw error;
    }
  });

async function _logAudit(
  timestamp: number,
  idleTaskCount: number,
  result: string
): Promise<void> {
  await db.collection('system_logs').add({
    type: 'DailyAudit',
    timestamp,
    idleTaskCount,
    result,
    source: 'CloudFunction',
  });
}
