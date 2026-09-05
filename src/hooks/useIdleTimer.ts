/**
 * useIdleTimer — Hareketsizlik Tespiti, Uyarı ve Otomatik Oturum Kapatma
 *
 * Belirli bir süre kullanıcı etkileşimi olmadığında (fare, klavye, dokunma)
 * otomatik olarak oturumu kapatır. Kapanmadan `warningMs` kadar önce bir uyarı
 * durumu (isWarning + remainingMs geri sayımı) yayınlar; çağıran bileşen bunu
 * bir modalda gösterip `continueSession()` ile oturumu uzatabilir.
 *
 * Süre `timeoutMs` ile dışarıdan verilir (Admin'in `system/settings`
 * dokümanındaki ayarı — bkz. useSessionTimeout); verilmezse
 * DEFAULT_SESSION_TIMEOUT_MS kullanılır.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SESSION_TIMEOUT_MS, SESSION_TIMEOUT_WARNING_MS } from '../constants';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

interface UseIdleTimerOptions {
  onIdle: () => void;
  enabled: boolean;
  /** Toplam hareketsizlik süresi (ms). */
  timeoutMs?: number;
  /** Kapanmadan kaç ms önce uyarılacağı. */
  warningMs?: number;
}

interface UseIdleTimerResult {
  /** Oturum kapanmak üzere — uyarı gösterilmeli. */
  isWarning: boolean;
  /** Uyarı penceresinde kalan süre (ms). Uyarı yokken warningMs'e eşittir. */
  remainingMs: number;
  /** Kullanıcının "Devam Et" eylemi — sayaçları sıfırdan başlatır. */
  continueSession: () => void;
}

export function useIdleTimer({
  onIdle,
  enabled,
  timeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
  warningMs = SESSION_TIMEOUT_WARNING_MS,
}: UseIdleTimerOptions): UseIdleTimerResult {
  // Uyarı penceresi toplam süreden uzun olamaz — aksi halde uyarı hiç
  // görünmeden (negatif gecikmeyle) oturum kapanırdı.
  const effectiveWarningMs = Math.min(warningMs, timeoutMs);

  const [isWarning, setIsWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState(effectiveWarningMs);

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Etkinlik dinleyicisi, her render'da yeniden bağlanmamak için state yerine
  // ref okur (aynı desen: ui/Modal'daki onCloseRef).
  const isWarningRef = useRef(false);

  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  });

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    warnTimerRef.current = null;
    idleTimerRef.current = null;
    tickTimerRef.current = null;
  }, []);

  const startTimers = useCallback(() => {
    clearTimers();
    isWarningRef.current = false;
    setIsWarning(false);
    setRemainingMs(effectiveWarningMs);

    warnTimerRef.current = setTimeout(() => {
      isWarningRef.current = true;
      setIsWarning(true);
      // Geri sayım duvar saatinden türetilir: sekme arka plandayken tarayıcı
      // interval'ları kıstığında sayacın gerçek kalan süreden sapmaması için.
      const deadline = Date.now() + effectiveWarningMs;
      setRemainingMs(effectiveWarningMs);
      tickTimerRef.current = setInterval(() => {
        setRemainingMs(Math.max(0, deadline - Date.now()));
      }, 1000);
    }, Math.max(0, timeoutMs - effectiveWarningMs));

    idleTimerRef.current = setTimeout(() => {
      clearTimers();
      isWarningRef.current = false;
      setIsWarning(false);
      onIdleRef.current();
    }, timeoutMs);
  }, [clearTimers, effectiveWarningMs, timeoutMs]);

  const handleActivity = useCallback(() => {
    // UYARI GÖRÜNÜRKEN etkinlik sayacı SIFIRLAMAZ: aksi halde modalı okumak
    // için fareyi kıpırdatmak ya da modalın üzerinden geçmek uyarıyı sessizce
    // kapatır ve kullanıcı oturumunun uzatıldığını fark etmeden ekranı açık
    // bırakabilirdi. Uyarı aşamasında oturumu yalnızca AÇIK bir onay
    // (continueSession) uzatır.
    if (isWarningRef.current) return;
    startTimers();
  }, [startTimers]);

  const continueSession = useCallback(() => {
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      isWarningRef.current = false;
      setIsWarning(false);
      return;
    }

    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));
    startTimers();

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, handleActivity));
      clearTimers();
    };
  }, [enabled, handleActivity, startTimers, clearTimers]);

  return { isWarning, remainingMs, continueSession };
}
