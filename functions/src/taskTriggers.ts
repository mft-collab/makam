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

    // Sorumluya bildirim
    if (task.assigneeId && task.assigneeId !== task.creatorId) {
      const assigneeNotif = db.collection('notifications').doc();
      batch.set(assigneeNotif, {
        userId: task.assigneeId,
        title: '📋 Yeni Görev Atandı',
        message: `"${task.title}" görevi size atandı.`,
        type: 'TaskAssigned',
        taskId,
        timestamp: now,
        isRead: false,
      });
    }

    // İrtibatlıya bildirim
    if (task.coordinatorId && task.coordinatorId !== task.assigneeId) {
      const coordNotif = db.collection('notifications').doc();
      batch.set(coordNotif, {
        userId: task.coordinatorId,
        title: '🤝 İrtibatlı Atandınız',
        message: `"${task.title}" görevi için irtibatlı olarak seçildınız.`,
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

    // COMPLETED ise istatistik güncelle
    if (after.status === 'COMPLETED') {
      const userRef = db.collection('users').doc(after.assigneeId);
      batch.update(userRef, {
        completedTaskCount: admin.firestore.FieldValue.increment(1),
      });
    }

    await batch.commit();
    console.log(`[onTaskStatusChanged] ${taskId}: ${before.status} → ${after.status}`);
    return null;
  });
