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
import type { User } from '../types';

const DEFAULTS = {
  Low:    { value: 15, unit: 'days' as const },
  Medium: { value: 5,  unit: 'days' as const },
  High:   { value: 2,  unit: 'days' as const },
  Urgent: { value: 4,  unit: 'hours' as const },
};

function normalize(val: any, defaultVal: number, defaultUnit: 'days' | 'hours') {
  if (val && typeof val.value === 'number') return { value: val.value, unit: val.unit || defaultUnit };
  if (typeof val === 'number') return { value: val, unit: defaultUnit };
  return { value: defaultVal, unit: defaultUnit };
}

export function useSLASync(user: User | null) {
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
        if (data) logger.debug('[SLA Sync] Synchronized from Firestore.');
      },
      (err) => logger.warn('[SLA Sync] Failed:', err)
    );

    return () => unsubscribe();
  }, [uid]);
}
