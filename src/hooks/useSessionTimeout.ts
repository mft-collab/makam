/**
 * useSessionTimeout — Oturum Zaman Aşımı Ayarının Senkronizasyonu
 *
 * Firestore'daki `system/settings` dokümanını dinler ve Admin'in belirlediği
 * `sessionTimeoutMs` değerini döndürür. Yapı, `useSLASync` ile BİLİNÇLİ olarak
 * aynıdır (aynı `system/{docId}` deseni, aynı uid-bağımlılığı, aynı hata
 * kanalı) — tek fark, değeri localStorage üzerinden dolaştırmak yerine
 * doğrudan döndürmesidir: tek tüketicisi (AuthenticatedApp) hook'u zaten
 * çağırdığından SLA'daki "aynı sekmedeki başka bileşene haber verme" sorunu
 * (SLA_CONFIG_SYNCED_EVENT) burada hiç doğmaz.
 *
 * localStorage yine de yazılır ama YALNIZCA ilk değer olarak okunmak için:
 * uygulama çevrimdışı/yavaş açıldığında Firestore ilk snapshot'ı gelene kadar
 * 24 saatlik değil, en son bilinen kurumsal süre uygulanır.
 */
import { useEffect, useState } from 'react';
import { db, doc, onSnapshot } from '../firebase';
import { logger } from '../lib/logger';
import { DEFAULT_SESSION_TIMEOUT_MS, normalizeSessionTimeoutMs } from '../constants';
import type { User } from '../types';

export const SESSION_TIMEOUT_STORAGE_KEY = 'makam_session_timeout_ms';

function readCachedTimeout(): number {
  try {
    const raw = localStorage.getItem(SESSION_TIMEOUT_STORAGE_KEY);
    if (raw === null) return DEFAULT_SESSION_TIMEOUT_MS;
    return normalizeSessionTimeoutMs(Number(raw));
  } catch {
    return DEFAULT_SESSION_TIMEOUT_MS;
  }
}

export function useSessionTimeout(
  user: User | null,
  onError?: (err: unknown, type: string, path: string) => void
): number {
  const [timeoutMs, setTimeoutMs] = useState<number>(readCachedTimeout);

  // useSLASync ile aynı gerekçe: yalnızca uid'e (primitive) bağımlı olunur,
  // `user` nesnesi alakasız her profil değişikliğinde yeni referans alır.
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;

    const settingsRef = doc(db, 'system', 'settings');
    const unsubscribe = onSnapshot(
      settingsRef,
      (docSnap) => {
        const raw = docSnap.exists() ? (docSnap.data() as { sessionTimeoutMs?: unknown }).sessionTimeoutMs : undefined;
        const next = normalizeSessionTimeoutMs(raw);
        setTimeoutMs(next);
        try {
          localStorage.setItem(SESSION_TIMEOUT_STORAGE_KEY, String(next));
        } catch {
          // Depolama kotası/gizli mod — kritik değil, yalnızca önbellek.
        }
      },
      (err) => {
        logger.warn('[Session Timeout] Failed:', err);
        onError?.(err, 'list', 'system/settings');
      }
    );

    return () => unsubscribe();
  }, [uid, onError]);

  return timeoutMs;
}
