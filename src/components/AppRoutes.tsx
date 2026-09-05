/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireTabAccess } from './RequireTabAccess';
import { APP_TAB_IDS, DEFAULT_TAB, tabPath, type AppTabId } from '../constants';
import type { UserRole } from '../types';

interface Props {
  role: UserRole;
  /**
   * Sekme → ekran elemanı. `Record<AppTabId, ReactNode>` olması bilinçlidir:
   * yeni bir sekme eklendiğinde route'unu eklemeyi UNUTMAK derleme hatası
   * verir (bkz. constants.ts — TAB_ROLES tek doğruluk kaynağı).
   *
   * Elemanlar çağıran tarafta oluşturulur ama bileşenleri hâlâ lazy()
   * facade'leridir — React element'i oluşturmak modülü YÜKLEMEZ, chunk yalnızca
   * eşleşen route render edildiğinde iner (bkz. vite.config.ts chunkFileNames).
   */
  screens: Record<AppTabId, ReactNode>;
}

/**
 * Uygulamanın route ağacı. AuthenticatedApp'ten AYRI bir dosyada olmasının
 * nedeni test edilebilirlik: ağacın kendisi (kök yönlendirmesi, yetki guard'ı,
 * /tasks/:taskId alt route'u, catch-all) Firestore/auth kurulumu olmadan
 * doğrudan render edilebiliyor — testte ikinci bir route tablosu kopyalamak
 * gerekmiyor, ki böyle bir kopya zamanla sessizce sapardı.
 */
export function AppRoutes({ role, screens }: Props) {
  return (
    <Routes>
      {/* Kök → varsayılan ekran. `replace`: geri tuşu kullanıcıyı tekrar
          buraya (ve anında ileri) göndermesin. */}
      <Route path="/" element={<Navigate to={tabPath(DEFAULT_TAB)} replace />} />

      {APP_TAB_IDS.map((tabId) => (
        <Route
          key={tabId}
          path={tabId}
          element={
            <RequireTabAccess tab={tabId} role={role}>
              {screens[tabId]}
            </RequireTabAccess>
          }
        >
          {/* /tasks/:taskId — TaskBoard'un ÜZERİNDE görev detay modalını
              URL'den açık tutan alt-route. Üst route <Outlet/> render ETMEZ;
              bu alt route yalnızca EŞLEŞME için vardır (modalın kendisi bu
              ağacın dışında, tüm sekmelerin üstünde durur — bkz.
              useSelectedTaskId). Alt route olması, /tasks ↔ /tasks/:taskId
              geçişinde TaskBoard'un yeniden monte edilmemesini de sağlar
              (kardeş route olsaydı React ağacı değiştirir, liste kaydırma/
              sanallaştırma durumu sıfırlanırdı).

              element BOŞ FRAGMENT: üst route <Outlet/> render etmediğinden
              hiçbir zaman çizilmez, ama react-router element'i OLMAYAN bir
              yaprak eşleşmede her seferinde "does not have an element or
              Component ... resulting in an empty page" uyarısı basar — görev
              detayı açmak çok sık bir eylem olduğundan bu, dev konsolunu boş
              yere kirletirdi (ölçüldü, bkz. AppRoutes.test.tsx). */}
          {tabId === 'tasks' && <Route path=":taskId" element={<></>} />}
        </Route>
      ))}

      {/* Bilinmeyen yol (eski yer imi, yanlış yazım) — sessizce varsayılan
          ekrana düşer. */}
      <Route path="*" element={<Navigate to={tabPath(DEFAULT_TAB)} replace />} />
    </Routes>
  );
}
