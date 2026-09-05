import {
  collection,
  doc,
  writeBatch,
  db
} from '../firebase';
import { runWithRetry } from '../lib/retry';
import { User, UserRole } from '../types';

// audit_logs şeması task-merkezli tasarlandığı için (`taskId` zorunlu alan,
// bkz. firestore.rules isValidAuditLog) kullanıcı-yönetimi kayıtlarında bu
// alanı etkilenen KULLANICININ id'sini taşımak için yeniden kullanıyoruz —
// gerçek bir görev id'si olması şart değil, yalnızca `is string` kontrolü var.
// Faydalı bir yan etkisi de var: audit_logs okuma kuralı bu "taskId" için
// hiçbir gerçek görevle eşleşmeyeceğinden, bu kayıtlar otomatik olarak
// yalnızca Admin/kaydı yazan kişiyle sınırlı kalır — hassas kullanıcı-yönetimi
// logları için doğru görünürlük sınırı budur.
// Aynı nedenle bu kayıtlara denormalize `taskTitle` alanı BİLEREK yazılmaz
// (bkz. taskService.auditTaskTitle): buradaki "taskId" bir görev değil bir
// kullanıcı id'sidir, dolayısıyla yazılacak her başlık uydurma olurdu.
// Etkilenen personelin adı zaten `newValue` metninde taşınıyor.
function userAuditLogRef() {
  return doc(collection(db, 'audit_logs'));
}

export const userService = {
  async addUser(data: { email: string; fullName: string; role: UserRole; departmentId?: string }, actorId: string) {
    const emailId = data.email.toLowerCase().trim();
    const userRef = doc(db, 'users', emailId);
    // Eskiden bu üç fonksiyonun HİÇBİRİ audit_logs yazmıyordu — sistemdeki en
    // hassas yetki değişiklikleri (rol yükseltme, kullanıcı silme) hiçbir
    // denetim izi bırakmadan gerçekleşiyordu (bkz. kod denetimi). writeBatch
    // ile ana yazma + audit kaydı atomik olarak birlikte uygulanır.
    await runWithRetry(async () => {
      const batch = writeBatch(db);
      batch.set(userRef, {
        uid: emailId, // Temporary ID until they log in
        ...data,
        email: emailId
      });
      batch.set(userAuditLogRef(), {
        taskId: emailId,
        changedBy: actorId,
        oldValue: 'Yok',
        newValue: `Personel Eklendi: ${data.fullName} (${data.role})`,
        timestamp: Date.now(),
      });
      await batch.commit();
    });
  },

  async updateUser(userId: string, data: Partial<User>, actorId: string) {
    await runWithRetry(async () => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', userId), data);
      batch.set(userAuditLogRef(), {
        taskId: userId,
        changedBy: actorId,
        oldValue: 'Personel Bilgisi',
        newValue: 'Personel Bilgisi Güncellendi',
        timestamp: Date.now(),
        // Bu katmanda eski değerler bilinmiyor (yalnızca değişen alanlar
        // Partial<User> olarak geliyor) — en azından HANGİ alanların
        // değiştiği ve yeni değerleri denetim izinde kalıcı olarak görünür.
        changes: (Object.keys(data) as (keyof User)[]).reduce((acc, key) => ({
          ...acc,
          [key]: { old: null, new: data[key] === undefined ? null : data[key] }
        }), {} as Record<string, { old: unknown; new: unknown }>)
      });
      await batch.commit();
    });
  },

  async deleteUser(userId: string, actorId: string) {
    await runWithRetry(async () => {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'users', userId));
      batch.set(userAuditLogRef(), {
        taskId: userId,
        changedBy: actorId,
        oldValue: 'Aktif',
        newValue: 'Personel Silindi',
        timestamp: Date.now(),
      });
      await batch.commit();
    });
  }
};
