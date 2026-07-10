/**
 * useIdleTimer — Hareketsizlik Tespiti ve Otomatik Oturum Kapatma
 *
 * Belirli bir süre kullanıcı etkileşimi olmadığında (fare, klavye, dokunma)
 * otomatik olarak oturumu kapatır. IDLE_THRESHOLD_MS sabiti ile kontrol edilir.
 */
import { useEffect, useRef, useCallback } from 'react';
import { IDLE_THRESHOLD_MS } from '../constants';

interface UseIdleTimerOptions {
  onIdle: () => void;
  enabled: boolean;
}

export function useIdleTimer({ onIdle, enabled }: UseIdleTimerOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onIdle, IDLE_THRESHOLD_MS);
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer(); // ilk zamanlayıcıyı başlat

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, resetTimer]);
}
