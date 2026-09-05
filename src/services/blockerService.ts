import {
  collection,
  doc,
  deleteDoc,
  writeBatch,
  runTransaction,
  db
} from '../firebase';
import { auditLogType, auditTaskTitle, transitionTaskInTransaction } from './taskService';
import { runWithRetry } from '../lib/retry';
import { TaskPriority } from '../types';

export const blockerService = {
  // Engel dokümanı ve görevin BLOCKED'a alınması AYNI transaction'da yapılır —
  // biri başarısız olursa diğeri de uygulanmaz (ör. sahipsiz bir engel kaydı
  // kalıp görevin durumu güncellenmemiş olması engellenir). Görev geçişi zaten
  // transitionTaskInTransaction içinde audit_logs'a yazıyor, bu yüzden burada
  // AYRICA bir audit log gerekmiyor (kod denetimi: yalnızca transaction-DIŞI
  // yollar — editBlocker ve deleteBlocker'ın son-engel-olmayan dalı — audit
  // log'suzdu, aşağıda düzeltildi).
  // NOT: eskiden burada bir `_oldStatus: TaskStatus` parametresi vardı —
  // hiçbir zaman kullanılmıyordu (transitionTaskInTransaction kendi
  // transaction.get()'iyle sunucudaki güncel durumu zaten okuyor), yalnızca
  // çağıranların hâlâ görevin eski durumunu geçirmesini gerektiren yanıltıcı
  // bir ölü parametreydi (bkz. kod denetimi).
  async addBlocker(taskId: string, reason: string, userId: string, expectedVersion?: number, severity: TaskPriority = 'Medium') {
    const blockerRef = doc(collection(db, 'blockers'));
    await runWithRetry(async () => {
      await runTransaction(db, async (transaction) => {
        // Firestore kuralı: tüm okumalar yazmalardan önce olmalı — bu yüzden
        // transitionTaskInTransaction (kendi transaction.get'ini yapar) ÖNCE çağrılır.
        await transitionTaskInTransaction(transaction, taskId, 'BLOCKED', userId, { expectedVersion });
        transaction.set(blockerRef, {
          id: blockerRef.id,
          taskId,
          reason,
          severity,
          isResolved: false,
          createdAt: Date.now()
        });
      });
    });
    return blockerRef.id;
  },

  // `taskTitle`: bu servis görevin kendisini okumaz (engel dokümanı + görev
  // geçişi dışında ek bir getDoc, Spark kotasında bedava değildir) — bu yüzden
  // denetim kaydına donacak başlık, görevi zaten elinde tutan çağırandan
  // (useAppHandlers) opsiyonel olarak geçilir. Verilmezse alan yazılmaz ve
  // AuditLogList eski kayıtlardaki gibi yüklü görev listesine düşer
  // (bkz. taskService.auditTaskTitle).
  async resolveBlocker(blockerId: string, taskId: string, otherActiveCount: number, userId: string, expectedVersion?: number, taskTitle?: string) {
    const blockerRef = doc(db, 'blockers', blockerId);

    if (otherActiveCount === 0) {
      // Son aktif engel çözülüyorsa: engel dokümanı + görevin IN_PROGRESS'e
      // dönmesi tek transaction'da — biri başarısız olursa diğeri de olmaz.
      // Görev geçişi audit_logs'a kendi içinde yazıyor.
      await runWithRetry(async () => {
        await runTransaction(db, async (transaction) => {
          await transitionTaskInTransaction(transaction, taskId, 'IN_PROGRESS', userId, { expectedVersion });
          transaction.update(blockerRef, { isResolved: true, resolvedAt: Date.now() });
        });
      });
    } else {
      // Görev durumu değişmiyor (başka aktif engel var) — burada bir görev
      // transaction'ı yok, dolayısıyla otomatik audit log da yok; kendi
      // audit kaydımızı ayrıca yazıyoruz (bkz. kod denetimi).
      await runWithRetry(async () => {
        const batch = writeBatch(db);
        batch.update(blockerRef, { isResolved: true, resolvedAt: Date.now() });
        batch.set(doc(collection(db, 'audit_logs')), {
          taskId,
          ...auditTaskTitle(taskTitle),
          // Risk unsurunun yaşam döngüsü olayı (aktif → çözüldü) — görevin
          // durumu bu dalda değişmiyor olsa da kayıt bir DURUM olayını
          // anlatır, bir içerik düzenlemesini değil (bkz. auditLogType).
          ...auditLogType('STATUS'),
          changedBy: userId,
          oldValue: 'Risk Unsuru Aktif',
          newValue: 'Risk Unsuru Çözüldü',
          timestamp: Date.now(),
        });
        await batch.commit();
      });
    }
  },

  async editBlocker(blockerId: string, reason: string, actorId: string, taskId: string, taskTitle?: string) {
    // Eskiden bu fonksiyon audit_logs'a hiç yazmıyordu — bir risk/engel
    // gerekçesinin ne zaman/kim tarafından değiştirildiği iz bırakmıyordu
    // (bkz. kod denetimi). writeBatch ile blocker güncellemesi + audit kaydı
    // atomik yazılır.
    await runWithRetry(async () => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'blockers', blockerId), { reason });
      batch.set(doc(collection(db, 'audit_logs')), {
        taskId,
        ...auditTaskTitle(taskTitle),
        // Serbest metin bir GEREKÇE düzenlemesi — risk unsurunun durumu
        // değişmiyor, yalnızca içeriği. İstemci-taraflı eski tahmin bu kaydı
        // `changes` yazmadığı için "Durum Değişikliği" sayıyordu; yanlıştı
        // (bkz. auditLogType).
        ...auditLogType('FIELD'),
        changedBy: actorId,
        oldValue: 'Risk Gerekçesi',
        newValue: reason,
        timestamp: Date.now(),
      });
      await batch.commit();
    });
  },

  async deleteBlocker(blockerId: string, taskId?: string, otherActiveCount?: number, userId?: string, expectedVersion?: number, taskTitle?: string) {
    const blockerRef = doc(db, 'blockers', blockerId);

    if (taskId !== undefined && otherActiveCount === 0 && userId !== undefined) {
      // Son aktif engel siliniyorsa: engel dokümanının silinmesi + görevin
      // IN_PROGRESS'e dönmesi (ve pausedAt/totalPausedTime'ın transitionTaskInTransaction
      // tarafından temizlenmesi) TEK transaction'da — biri başarısız olursa diğeri de olmaz.
      // Görev geçişi audit_logs'a kendi içinde yazıyor.
      await runWithRetry(async () => {
        await runTransaction(db, async (transaction) => {
          await transitionTaskInTransaction(transaction, taskId, 'IN_PROGRESS', userId, { expectedVersion });
          transaction.delete(blockerRef);
        });
      });
      return;
    }

    // Başka aktif engel varsa görev durumu değişmiyor — otomatik audit log
    // yok, bu yüzden burada ayrıca yazılır (taskId/userId varsa; eski/legacy
    // çağrılarda bu bilgi yoksa audit kaydı atlanır, en azından silme işlemi
    // eskisi gibi çalışmaya devam eder — bkz. kod denetimi).
    await runWithRetry(async () => {
      if (taskId !== undefined && userId !== undefined) {
        const batch = writeBatch(db);
        batch.delete(blockerRef);
        batch.set(doc(collection(db, 'audit_logs')), {
          taskId,
          ...auditTaskTitle(taskTitle),
          // resolveBlocker ile AYNI gerekçe: risk unsurunun yaşam döngüsü sonu.
          ...auditLogType('STATUS'),
          changedBy: userId,
          oldValue: 'Risk Unsuru Aktif',
          newValue: 'Risk Unsuru Silindi',
          timestamp: Date.now(),
        });
        await batch.commit();
      } else {
        await deleteDoc(blockerRef);
      }
    });
  }
};
