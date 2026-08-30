import { logger } from './logger';

/**
 * Firestore'dan gelen ham veriyi zod şemasıyla doğrular. Şema uyumsuzluğu
 * (ör. bozuk/eksik alan) veriyi listeden düşürmez — yalnızca konsola uyarı
 * yazar — aksi halde tek bir hatalı doküman tüm listeyi görünmez yapardı.
 * Doğrulama başarılıysa şemanın .default(...) doldurduğu alanlarla döner.
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
    return raw;
  }
  return result.data as T;
}
