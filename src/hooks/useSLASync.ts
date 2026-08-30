/**
 * useSLASync — Gerçek Zamanlı SLA Konfigürasyon Senkronizasyonu
 *
 * Firestore'daki `system/sla_config` dökümanını dinler ve
 * değişiklikleri localStorage'a yazar. Bu sayede SLA hesaplamaları
 * her zaman güncel kalır.
 */
import { useEffect } from 'react';
import { db, doc, onSnapshot } from '../firebase';
import { logger } from '../lib/logger';
import type { SLAConfigEntry } from '../lib/sla';
import type { User } from '../types';

// localStorage'a yazan bu hook TEK bir sekme/oturumda çalışır (App.tsx kök
// seviyesinde) — 'storage' event'i yalnızca DİĞER sekmelerde tetiklenir, aynı
// sekmede localStorage'ı okuyan Settings.tsx gibi bileşenler bu yazmadan
// habersiz kalırdı (bkz. kod denetimi: başka bir admin SLA'yı değiştirdiğinde
// panel açık olan admin canlı güncelleme görmüyordu). Bu özel DOM event'i
// AYNI sekme içindeki dinleyicilere haber verir.
export const SLA_CONFIG_SYNCED_EVENT = 'makam:sla-config-synced';

export type SlaConfigMap = Record<'Low' | 'Medium' | 'High' | 'Urgent', SLAConfigEntry>;

const DEFAULTS = {
  Low:    { value: 15, unit: 'days' as const },
  Medium: { value: 5,  unit: 'days' as const },
  High:   { value: 2,  unit: 'days' as const },
  Urgent: { value: 4,  unit: 'hours' as const },
};

function normalize(val: unknown, defaultVal: number, defaultUnit: 'days' | 'hours') {
  if (val && typeof val === 'object' && typeof (val as { value?: unknown }).value === 'number') {
    const entry = val as { value: number; unit?: 'days' | 'hours' };
    return { value: entry.value, unit: entry.unit || defaultUnit };
  }
  if (typeof val === 'number') return { value: val, unit: defaultUnit };
  return { value: defaultVal, unit: defaultUnit };
}

export function useSLASync(
  user: User | null,
  // Verilmezse davranış eskisi gibi yalnızca console'a düşer (bkz. kod
  // denetimi: bu hook hatayı önceden merkezi toast kanalına hiç iletmiyordu —
  // SLA config senkronizasyonu sessizce başarısız olursa kullanıcı hiçbir
  // uyarı görmeden eski/varsayılan SLA süreleriyle çalışmaya devam ederdi).
  onError?: (err: unknown, type: string, path: string) => void
) {
  // Yalnızca uid'e (primitive) bağımlı — user nesnesi, kullanıcının Firestore
  // dokümanındaki SLA ile alakasız her değişiklikte (fotoğraf, fcmTokens vb.)
  // yeni bir referansla set ediliyor (bkz. App.tsx); tüm `user` nesnesini
  // dependency array'e koymak bu tür alakasız güncellemelerde gereksiz
  // resubscribe'a yol açardı — useFirestoreData.ts'teki aynı desen (bkz. kod
  // denetimi).
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;

    const slaDocRef = doc(db, 'system', 'sla_config');
    const unsubscribe = onSnapshot(
      slaDocRef,
      (docSnap) => {
        const data = docSnap.exists() ? docSnap.data() : null;
        const config = data
          ? {
              Low:    normalize(data.Low,    15, 'days'),
              Medium: normalize(data.Medium, 5,  'days'),
              High:   normalize(data.High,   2,  'days'),
              Urgent: normalize(data.Urgent, 4,  'hours'),
            }
          : DEFAULTS;
        localStorage.setItem('makam_sla_config', JSON.stringify(config));
        window.dispatchEvent(new CustomEvent<SlaConfigMap>(SLA_CONFIG_SYNCED_EVENT, { detail: config }));
        if (data) logger.debug('[SLA Sync] Synchronized from Firestore.');
      },
      (err) => {
        logger.warn('[SLA Sync] Failed:', err);
        onError?.(err, 'list', 'system/sla_config');
      }
    );

    return () => unsubscribe();
  }, [uid, onError]);
}
