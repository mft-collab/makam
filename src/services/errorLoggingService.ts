/**
 * errorLoggingService — Firestore Tabanlı Yapılandırılmış Hata Kaydı
 *
 * Sentry.io gerektirmeden üretim hatalarını Firestore'a yazar.
 * ErrorBoundary.componentDidCatch ve kritik async handler'lardan çağrılır.
 *
 * Ücretsiz plan (Spark) uyumlu — Cloud Functions KULLANMAZ.
 * Firestore'a doğrudan yazar, TTL tabanlı temizlik için Security Rules'a güvenir.
 */
import { db, collection, addDoc } from '../firebase';
import { auth } from '../firebase';

export interface ErrorLogEntry {
  /** Hata mesajı */
  message: string;
  /** Hata stack trace (varsa) */
  stack?: string;
  /** Hatanın kaynağı: 'ErrorBoundary' | 'async' | 'firestore' | 'manual' */
  source: 'ErrorBoundary' | 'async' | 'firestore' | 'manual';
  /** İşlem tipi — Firestore operasyonu için */
  operationType?: string;
  /** Etkilenen Firestore path */
  path?: string;
  /** Ek bağlam bilgisi */
  context?: Record<string, unknown>;
  /** Oturum açmış kullanıcı UID */
  userId?: string;
  /** ISO timestamp */
  timestamp: number;
  /** Uygulama sürümü */
  appVersion: string;
  /** Kullanıcı ajanı */
  userAgent: string;
}

const APP_VERSION = '2.3.0';

/**
 * Firestore'a yapılandırılmış hata kaydı yazar.
 * Silently fails — hata loglama sistemi asla uygulamayı çökertmemeli.
 */
export async function logError(
  error: unknown,
  source: ErrorLogEntry['source'],
  options: {
    operationType?: string;
    path?: string;
    context?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    const entry: ErrorLogEntry = {
      message: error instanceof Error ? error.message : String(error),
      stack:   error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
      source,
      operationType: options.operationType,
      path:          options.path,
      context:       options.context,
      userId:        auth.currentUser?.uid,
      timestamp:     Date.now(),
      appVersion:    APP_VERSION,
      userAgent:     navigator.userAgent.slice(0, 200),
    };

    // Tanımsız alanları temizle (Firestore undefined kabul etmez)
    const clean = Object.fromEntries(
      Object.entries(entry).filter(([, v]) => v !== undefined)
    );

    await addDoc(collection(db, 'error_logs'), clean);
  } catch {
    // Hata loglama başarısız olursa sessizce geç — sonsuz döngüyü önle
    console.warn('[ErrorLogging] Firestore log yazımı başarısız — sessizce geçildi.');
  }
}
