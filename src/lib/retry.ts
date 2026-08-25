import { logger } from './logger';

// taskStateMachine/taskService'in fırlattığı DETERMİNİSTİK iş kuralı/durum
// makinesi hataları — bunlar bir ağ/sunucu geçiciliği değildir, yeniden
// deneme sonucu asla değiştirmez. Eskiden runWithRetry hata tipini hiç
// ayırt etmiyordu: ör. gerçek bir düzenleme çakışmasında (VERSION_MISMATCH)
// kullanıcı "Düzenleme Çakışması" uyarısını görene kadar ~1.5sn boyunca
// (3 deneme × exponential backoff) aynı sonucu üretecek transaction'ın
// anlamsız yere tekrarlanmasını beklemek zorunda kalıyordu (bkz. kod
// denetimi — offlineQueue.ts'teki eşdeğer sınıflandırmayla tutarlı).
const NON_RETRYABLE_MESSAGE_PATTERNS = [
  /VERSION_MISMATCH/,
  /^INVALID_TRANSITION:/,
  /Admin rolündeki kullanıcı irtibatlı/,
  /yalnızca Memur/,
  /yalnızca Müdür/,
];

function isNonRetryableBusinessError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return NON_RETRYABLE_MESSAGE_PATTERNS.some(p => p.test(msg));
}

/**
 * Exponential Backoff Transaction and Mutation retry wrapper for network resiliency.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  // "maxRetries" değil "maxAttempts" — bu, YENİDEN deneme sayısı değil
  // TOPLAM deneme sayısıdır (maxAttempts=1 → hiç yeniden denemeden tek
  // deneme, bkz. retry.test.ts). Eski isim bir ölçüde yanıltıcıydı (bkz.
  // kod denetimi).
  maxAttempts = 3,
  initialDelay = 500
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (isNonRetryableBusinessError(error)) {
        logger.warn('[Retry Engine] Deterministic business-rule error — skipping retry.', error);
        throw error;
      }

      attempt++;
      if (attempt >= maxAttempts) {
        logger.error(`[Retry Engine] All ${maxAttempts} attempts failed. Throwing error.`, error);
        throw error;
      }

      const delay = initialDelay * Math.pow(2, attempt - 1);
      logger.warn(`[Retry Engine] Attempt ${attempt} failed. Retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
