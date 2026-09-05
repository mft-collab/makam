/**
 * backfillDepartments — TEK SEFERLİK, Admin-only callable (P0-1/P0-2 taşıması)
 *
 * Üretimde departman referans varlığına geçişin veri tarafını yapar:
 *  (a) users + tasks içindeki tüm distinct departmentId değerleri için eksik
 *      `departments/{value}` dokümanlarını oluşturur,
 *  (b) departmanı eksik/null/boş olan her görevi sorumlusunun güncel
 *      departmanıyla doldurur (sorumlu da departmansızsa 'Genel'e düşürür).
 *
 * SIRALAMA KRİTİKTİR: bu fonksiyon, tasks okuma kuralındaki eski
 * "departmanı yoksa serbest" fallback'leri KALDIRILMADAN ÖNCE çalıştırılmalıdır
 * — aksi halde departmansız görevler, backfill onlara bir departman atayana
 * kadar sorumlusu dışındaki herkes için görünmez olur. Tam adım listesi ve
 * doğrulama sorguları için bkz. functions/BACKFILL_RUNBOOK.md.
 *
 * Mantığın kendisi departmentBackfillCore.ts'te durur (orada `firebase-functions`
 * ithal edilmez) — böylece kök projedeki emulator testi gerçek kodu
 * doğrulayabilir; gerekçe için o dosyanın başlığına bakın.
 *
 * Deploy: firebase deploy --only functions:backfillDepartments
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { runDepartmentBackfill } from './departmentBackfillCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Çağıranın gerçekten Admin olduğunu doğrular — firestore.rules'taki
 *  isAdmin() ile AYNI sözleşme: custom claim tercih edilir, yoksa
 *  users/{uid}.role == 'Admin'. Callable fonksiyonlar rules'ı BYPASS ettiğinden
 *  bu kontrol burada elle yapılmak zorundadır. */
async function assertCallerIsAdmin(auth: functions.https.CallableContext['auth']): Promise<string> {
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Bu işlem için oturum açmanız gerekir.');
  }
  if (auth.token?.admin === true) return auth.uid;

  const userSnap = await db.collection('users').doc(auth.uid).get();
  if (userSnap.exists && userSnap.data()?.role === 'Admin') return auth.uid;

  throw new functions.https.HttpsError('permission-denied', 'Bu işlem yalnızca Admin tarafından çalıştırılabilir.');
}

export const backfillDepartments = functions
  .region('europe-west1')
  // Tek seferlik ve tüm koleksiyonu tarayan bir taşıma — varsayılan 60 sn'lik
  // süre büyük bir koleksiyonda yetmeyebilir. Bellek varsayılanda bırakıldı:
  // veri sayfa sayfa okunuyor, tamamı aynı anda bellekte tutulmuyor.
  .runWith({ timeoutSeconds: 540 })
  .https.onCall(async (_data: unknown, context: functions.https.CallableContext) => {
    const actorId = await assertCallerIsAdmin(context.auth);

    const startedAt = Date.now();
    const result = await runDepartmentBackfill(db, actorId);
    const durationMs = Date.now() - startedAt;

    // Denetlenebilirlik: taşımanın çalıştığı, system_logs'ta kalıcı iz bırakır
    // (bu koleksiyona yalnızca Admin SDK yazabilir, bkz. firestore.rules).
    // Başarısız olursa taşımanın kendisi geri alınmaz — idempotent olduğu için
    // yeniden çalıştırmak güvenlidir.
    try {
      await db.collection('system_logs').add({
        type: 'departmentBackfill',
        timestamp: Date.now(),
        result: `${result.departmentsCreated} birim, ${result.tasksUpdated} talimat`,
        source: 'callable',
      });
    } catch (err) {
      console.error('[backfillDepartments] system_logs kaydı yazılamadı:', err);
    }

    console.log('[backfillDepartments] Tamamlandı:', JSON.stringify({ ...result, durationMs }));
    return { ...result, durationMs };
  });
