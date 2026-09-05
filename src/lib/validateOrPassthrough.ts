import { logger } from './logger';
import { logError } from '../services/errorLoggingService';

/**
 * Şema doğrulama başarısızlıklarının Firestore'a (error_logs) bildirim sıklığı.
 * Koleksiyon bazında uygulanır: onSnapshot her tetiklendiğinde AYNI bozuk
 * doküman tekrar tekrar başarısız olabileceğinden, debounce olmadan tek bir
 * kalıcı şema kayması Spark plan yazma kotasını hızla tüketebilirdi (bkz. kod
 * denetimi — telemetri eksikliği bulgusu). Amaç şema kaymasını GÖRÜNÜR kılmak,
 * her tetiklenmede yeniden yazmak değil.
 */
const SCHEMA_ERROR_LOG_COOLDOWN_MS = 5 * 60 * 1000;
const lastSchemaErrorLogAt = new Map<string, number>();

/**
 * Firestore'dan gelen ham veriyi zod şemasıyla doğrular. Şema uyumsuzluğu
 * (ör. bozuk/eksik alan) veriyi listeden düşürmez — yalnızca konsola uyarı
 * yazar — aksi halde tek bir hatalı doküman tüm listeyi görünmez yapardı.
 * Doğrulama başarılıysa şemanın .default(...) doldurduğu alanlarla döner.
 *
 * console.warn TEK BAŞINA üretimde görünmezdi — kimse konsolu izlemiyor,
 * bu yüzden RBAC'i (role) veya durum makinesini (status) etkileyebilecek bir
 * şema kayması sessizce üretimde kalabiliyordu (bkz. kod denetimi). Koleksiyon
 * bazında debounce'lu olarak errorLoggingService'e de bildirilir.
 *
 * useFirestoreData.ts'in geri kalanından (Firestore query/listener kurulumu,
 * dataStore bağımlılığı) BİLEREK ayrı bir modülde tutulur — App.tsx'teki auth
 * listener (kullanıcı dokümanını doğrular) giriş öncesi de çalıştığından, bu
 * fonksiyonu useFirestoreData.ts'ten import etmek App'in lazy-yüklenen
 * AuthenticatedApp'a ait tüm Firestore veri-katmanı kodunu da ana pakete
 * sürükler (bkz. kod denetimi — bundle bölünmesi analizi).
 */
export function validateOrPassthrough<T>(schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: unknown } }, raw: T, docId: string, collectionName: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    logger.warn(`[useFirestoreData] Şema doğrulama uyarısı (${collectionName}/${docId}):`, result.error);

    const now = Date.now();
    const lastLoggedAt = lastSchemaErrorLogAt.get(collectionName) ?? 0;
    if (now - lastLoggedAt >= SCHEMA_ERROR_LOG_COOLDOWN_MS) {
      lastSchemaErrorLogAt.set(collectionName, now);
      void logError(result.error, 'manual', {
        operationType: 'schema-validation',
        path: `${collectionName}/${docId}`,
        context: { collectionName, docId },
      });
    }

    return raw;
  }
  return result.data as T;
}
