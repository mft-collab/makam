/**
 * Görev Firestore Tetikleyicileri (Cloud Functions)
 * 
 * onTaskCreated   — Yeni görev oluşturulduğunda sorumluya bildirim gönderir
 * onTaskStatusChanged — Durum değiştiğinde ilgilileri bilgilendirir
 * 
 * Deploy: firebase deploy --only functions:onTaskCreated,onTaskStatusChanged
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * assigneeId/coordinatorId alanları bazen UID bazen (henüz ilk kez giriş
 * yapmamış, e-posta anahtarlı davet dokümanına sahip) bir e-posta string'i
 * olabilir (bkz. firestore.rules'taki aynı e-posta fallback'i ve
 * src/App.tsx'teki ilk-giriş migrasyonu). Bu durumda notifications.userId
 * gerçek UID ile eşleşmediğinden alıcı bildirimi hiç göremez, ya da
 * users/{id} referansı NOT_FOUND ile tüm batch'i reddedebilir (bkz. kod
 * denetimi). E-posta görünümlü bir ID gelirse gerçek UID'yi users
 * koleksiyonundan arayıp çözer; bulunamazsa orijinal değeri döner (davranış
 * en kötü ihtimalle eskisiyle aynı kalır, asla daha kötü olmaz).
 */
async function resolveUid(candidateId: string | undefined): Promise<string | undefined> {
  if (!candidateId || !candidateId.includes('@')) return candidateId;
  try {
    const snap = await db.collection('users').where('email', '==', candidateId).limit(1).get();
    if (!snap.empty) return snap.docs[0]!.id;
  } catch (err) {
    console.error('[resolveUid] E-posta -> UID çözümlemesi başarısız:', err);
  }
  return candidateId;
}

// ── Yeni Görev Oluşturuldu ───────────────────────────────────────────────────
export const onTaskCreated = functions
  .region('europe-west1')
  .firestore
  .document('tasks/{taskId}')
  .onCreate(async (snap: admin.firestore.DocumentSnapshot, context: functions.EventContext) => {
    const task = snap.data();
    if (!task) return null;
    const taskId = context.params.taskId;
    const now = Date.now();

    const batch = db.batch();

    const assigneeUid = await resolveUid(task.assigneeId);
    const coordinatorUid = await resolveUid(task.coordinatorId);

    // Sorumluya bildirim
    if (assigneeUid && assigneeUid !== task.creatorId) {
      const assigneeNotif = db.collection('notifications').doc();
      batch.set(assigneeNotif, {
        userId: assigneeUid,
        title: '📋 Yeni Görev Atandı',
        message: `"${task.title}" görevi size atandı.`,
        type: 'TaskAssigned',
        taskId,
        timestamp: now,
        isRead: false,
      });
    }

    // İrtibatlıya bildirim
    if (coordinatorUid && coordinatorUid !== assigneeUid) {
      const coordNotif = db.collection('notifications').doc();
      batch.set(coordNotif, {
        userId: coordinatorUid,
        title: '🤝 İrtibatlı Atandınız',
        message: `"${task.title}" görevi için irtibatlı olarak seçildiniz.`,
        type: 'TaskAssigned',
        taskId,
        timestamp: now,
        isRead: false,
      });
    }

    await batch.commit();
    console.log(`[onTaskCreated] Görev ${taskId} bildirimleri gönderildi.`);
    return null;
  });

// ── Görev Durumu Değişti ─────────────────────────────────────────────────────
export const onTaskStatusChanged = functions
  .region('europe-west1')
  .firestore
  .document('tasks/{taskId}')
  .onUpdate(async (change: functions.Change<admin.firestore.DocumentSnapshot>, context: functions.EventContext) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after) return null;
    const taskId = context.params.taskId;

    // Sadece durum değişikliklerini işle
    if (before.status === after.status) return null;

    const now = Date.now();
    const batch = db.batch();

    // Durum bazlı bildirim mesajları
    const STATUS_MESSAGES: Record<string, string> = {
      COMPLETED:          '✅ tamamlandı',
      BLOCKED:            '🚫 engellendi',
      CRISIS:             '🚨 kriz moduna alındı',
      AWAITING_APPROVAL:  '⏳ onay bekliyor',
      IN_PROGRESS:        '🔄 işleme alındı',
    };

    const statusMsg = STATUS_MESSAGES[after.status] ?? `durumu değişti: ${after.status}`;

    // Oluşturana bildirim (eğer o değiştirmediyse)
    if (after.creatorId && after.creatorId !== after.changedBy) {
      const notifRef = db.collection('notifications').doc();
      batch.set(notifRef, {
        userId: after.creatorId,
        title: 'Görev Güncellendi',
        message: `"${after.title}" görevi ${statusMsg}.`,
        type: after.status === 'CRISIS' || after.status === 'BLOCKED' ? 'Crisis' : 'Info',
        taskId,
        timestamp: now,
        isRead: false,
      });
    }

    await batch.commit();

    // completedTaskCount güncellemesi — bildirim batch'inden AYRI, kendi
    // try/catch'i içinde: assigneeId bir e-posta ise (bkz. resolveUid) veya
    // hedef users/{id} dokümanı her nasılsa yoksa, update() NOT_FOUND ile
    // reddedilir; bu artık yukarıdaki bildirim yazımını iptal etmiyor
    // (eskiden aynı batch'te olduğundan biri başarısız olunca ikisi de
    // reddediliyordu — bkz. kod denetimi).
    //
    // Sayaç "şu an COMPLETED durumundaki görev sayısı"nı temsil eder (system/
    // stats.status_COMPLETED ile aynı canlı-sayaç mantığı). Admin, rules'taki
    // isValidTransition'ı override edip tamamlanmış bir görevi yeniden
    // açabilir (COMPLETED→IN_PROGRESS) — bu durumda sayaç düşürülür, aksi
    // halde görev tekrar tamamlandığında (COMPLETED→IN_PROGRESS→COMPLETED)
    // completedTaskCount çift sayılır (bkz. kod denetimi).
    if (after.status === 'COMPLETED' || before.status === 'COMPLETED') {
      const delta = after.status === 'COMPLETED' ? 1 : -1;
      try {
        const assigneeUid = await resolveUid(after.assigneeId);
        if (assigneeUid) {
          await db.collection('users').doc(assigneeUid).update({
            completedTaskCount: admin.firestore.FieldValue.increment(delta),
          });
        }
      } catch (err) {
        console.error(`[onTaskStatusChanged] completedTaskCount güncellemesi başarısız (${taskId}):`, err);
      }
    }

    console.log(`[onTaskStatusChanged] ${taskId}: ${before.status} → ${after.status}`);
    return null;
  });
