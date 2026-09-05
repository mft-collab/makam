/**
 * Firebase/Firestore hata kodlarını kullanıcıya gösterilecek Türkçe, eylem
 * odaklı metinlere çevirir. Eskiden yalnızca `auth/unauthorized-domain`
 * insanlaştırılmıştı — geri kalan HER hata ham SDK metnini ("Hata:
 * FirebaseError: Missing or insufficient permissions.") doğrudan toast'a
 * sızdırıyordu (bkz. kod denetimi). Bu dosya TEK haritalama noktasıdır —
 * yeni bir eşleme eklerken burayı güncelleyin, çağrı noktalarını değil.
 */
export interface HumanizedError {
  title: string;
  body: string;
  type: 'danger' | 'warning';
}

function getErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `supportReference` — errorLoggingService.logError'ın döndürdüğü `error_logs`
 * doküman ID'si. Kayıt zaten tutuluyordu ama kullanıcıya hiç yansıtılmıyordu;
 * Admin bu referansla ilgili kaydı doğrudan bulabilir.
 */
export function humanizeError(error: unknown, supportReference?: string | null): HumanizedError {
  const code = getErrorCode(error).toLowerCase();
  const message = getErrorMessage(error);
  const normalized = `${code} ${message}`.toLowerCase();

  const withReference = (body: string) =>
    supportReference ? `${body}\n\nDestek Referansı: ${supportReference}` : body;

  if (normalized.includes('auth/unauthorized-domain')) {
    const currentDomain = typeof window !== 'undefined' ? window.location.hostname : 'bu domain';
    return {
      title: 'Giriş Domaini Yetkisiz',
      body: `Firebase Authentication ayarlarında "${currentDomain}" yetkili domain olarak tanımlı olmalı. Console > Authentication > Settings > Authorized domains listesini kontrol edin.`,
      type: 'warning',
    };
  }

  if (normalized.includes('auth/popup-closed-by-user') || normalized.includes('auth/cancelled-popup-request')) {
    return {
      title: 'Giriş İptal Edildi',
      body: 'Google giriş penceresi kapatıldı. Tekrar denemek için "Kurumsal Giriş Yap" butonuna basabilirsiniz.',
      type: 'warning',
    };
  }

  if (normalized.includes('auth/network-request-failed') || normalized.includes('auth/timeout')) {
    return {
      title: 'Ağ Bağlantısı Sorunu',
      body: 'İnternet bağlantınızı kontrol edip tekrar deneyin.',
      type: 'warning',
    };
  }

  if (normalized.includes('permission-denied') || normalized.includes('insufficient permissions')) {
    return {
      title: 'Yetkiniz Yok',
      body: withReference('Bu işlemi gerçekleştirmek için gerekli yetkiye sahip değilsiniz. Yetkinizin güncel olduğundan emin değilseniz sayfayı yenileyin, sorun sürerse yöneticinizle görüşün.'),
      type: 'warning',
    };
  }

  if (normalized.includes('unavailable')) {
    return {
      title: 'Dizgeye Şu An Ulaşılamıyor',
      body: 'Sunucu geçici olarak yanıt vermiyor. Birkaç saniye içinde otomatik olarak tekrar denenecektir; sorun sürerse internet bağlantınızı kontrol edin.',
      type: 'warning',
    };
  }

  if (normalized.includes('resource-exhausted')) {
    return {
      title: 'Sistem Kapasitesi Aşıldı',
      body: withReference('Günlük kullanım kotası geçici olarak doldu. Lütfen bir süre sonra tekrar deneyin.'),
      type: 'danger',
    };
  }

  if (normalized.includes('failed-precondition')) {
    return {
      title: 'İşlem Şu An Gerçekleştirilemiyor',
      body: 'Bu işlem, verinin başka bir işlemle çakışması nedeniyle tamamlanamadı. Sayfayı yenileyip tekrar deneyin.',
      type: 'warning',
    };
  }

  if (normalized.includes('deadline-exceeded')) {
    return {
      title: 'İşlem Zaman Aşımına Uğradı',
      body: 'Sunucu yanıtı beklenen sürede alınamadı. Bağlantınızı kontrol edip tekrar deneyin.',
      type: 'warning',
    };
  }

  return {
    title: 'Dizge Hatası',
    body: withReference('Beklenmeyen bir hata oluştu. Sorun devam ederse yöneticinizle görüşün.'),
    type: 'danger',
  };
}
