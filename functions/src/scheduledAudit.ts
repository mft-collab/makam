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

// Spark (ücretsiz) plan zaman aşımı/kota riskine karşı üst sınır — koleksiyon
// bu sınırdan büyükse kalan görevler `system/auditCursor` imleciyle sonraki
// günlük koşularda sırayla işlenir (bkz. aşağıdaki cursor mantığı).
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
      // 1. Aktif görevleri çek — sayfalama imleci ile. `not-in` filtresi + limit
      // tek başına kullanılırsa (önceki hâli) koleksiyon 500'den büyük olduğunda
      // her gün aynı pencere taranır ve ötesindeki görevler hiç denetlenmez.
      // İmleç olarak son işlenen dokümanın DocumentSnapshot'ı saklanır —
      // startAfter(snapshot), sorgunun (not-in filtresiyle) örtük doküman-ID
      // sıralamasını otomatik kullanır; elle orderBy eşleştirmesi gerekmez ve
      // Firestore'un "inequality filtresiyle orderBy aynı alanda olmalı"
      // kısıtına çarpılmaz.
      const cursorRef = db.collection('system').doc('auditCursor');
      const cursorSnap = await cursorRef.get();
      const lastDocId = cursorSnap.exists ? (cursorSnap.data()?.lastDocId as string | undefined) : undefined;

      const baseQuery = () =>
        db
          .collection('tasks')
          .where('status', 'not-in', ['COMPLETED', 'CANCELLED'])
          .limit(MAX_TASKS_PER_RUN);

      let tasksSnap: admin.firestore.QuerySnapshot;
      if (lastDocId) {
        const lastDocSnap = await db.collection('tasks').doc(lastDocId).get();
        tasksSnap = lastDocSnap.exists
          ? await baseQuery().startAfter(lastDocSnap).get()
          : await baseQuery().get(); // imleç dokümanı silinmiş — baştan başla
      } else {
        tasksSnap = await baseQuery().get();
      }

      // Sayfa boşsa imleç koleksiyonun sonuna ulaşmış demektir — baştan başla
      if (tasksSnap.empty && lastDocId) {
        tasksSnap = await baseQuery().get();
      }

      // Bir sonraki koşu için imleci güncelle: tam sayfa geldiyse muhtemelen
      // daha fazla kayıt var (imleç ilerletilir); kısmi sayfa koleksiyonun
      // sonuna ulaşıldığı anlamına gelir (imleç silinir, döngü baştan başlar).
      const lastDoc = tasksSnap.docs[tasksSnap.docs.length - 1];
      if (lastDoc && tasksSnap.docs.length >= MAX_TASKS_PER_RUN) {
        await cursorRef.set({ lastDocId: lastDoc.id, updatedAt: now });
      } else {
        await cursorRef.delete();
      }

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

        // pausedAt/totalPausedTime senkronizasyonu — src/services/taskService.ts
        // (transitionTaskInTransaction) ile AYNI kural: bir görev BLOCKED/
        // AWAITING_APPROVAL/PENDING_DELEGATION iken (hedef durum ne olursa olsun,
        // burada CRISIS'e) geçerse, o ana kadar duraklamış geçen süre
        // totalPausedTime'a eklenir ve pausedAt sıfırlanır. Bu yapılmazsa pausedAt
        // eski (BLOCKED anındaki) değerinde kalıcı olarak takılı kalır ve SLA
        // sayacı görev fiilen ilerlese bile sonsuza dek "duraklatıldı" görünür
        // (bkz. src/lib/sla.ts getRemainingTime — yalnızca pausedAt'in dolu olup
        // olmadığına bakar, status'e bakmaz).
        const wasPausing = task.status === 'BLOCKED' || task.status === 'AWAITING_APPROVAL' || task.status === 'PENDING_DELEGATION';
        const pauseUpdate: Record<string, unknown> = {};
        if (wasPausing && task.pausedAt) {
          pauseUpdate.totalPausedTime = (task.totalPausedTime || 0) + (now - task.pausedAt);
          pauseUpdate.pausedAt = null;
        }

        batch.update(taskDoc.ref, {
          status: 'CRISIS',
          updatedAt: now,
          changedBy: 'system:scheduledDailyAudit',
          lockVersion: admin.firestore.FieldValue.increment(1),
          ...pauseUpdate,
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
