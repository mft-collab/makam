/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { TAB_ROLES, DEFAULT_TAB, tabPath, type AppTabId } from '../constants';
import type { UserRole } from '../types';

interface Props {
  tab: AppTabId;
  role: UserRole;
  children: ReactNode;
}

/**
 * Sekme yetki kontrolü (Güvenlik Duvarı) — routing öncesi AuthenticatedApp'te
 * `activeTab`'i izleyen bir useEffect'ti; artık her route element'ini saran bir
 * guard. Davranış (DEFAULT_TAB'a yönlendirme + aynı console.warn) korunur ama
 * iki fark önemlidir:
 *   1. Yetkisiz ekran artık BİR KARE BİLE render edilmez (useEffect sürümünde
 *      bileşen önce monte olup veri çekmeye başlıyor, ancak sonraki tick'te
 *      geri alınıyordu).
 *   2. Adres çubuğuna elle yazılan/paylaşılan bir derin link de aynı kontrolden
 *      geçer — eski sürümde böyle bir giriş noktası hiç yoktu.
 *
 * TAB_ROLES DOĞRUDAN okunur; route'a gömülü ikinci bir rol listesi YOKTUR
 * (bkz. constants.ts — tek doğruluk kaynağı gerekçesi).
 *
 * Not: uyarı render sırasında basılır. StrictMode'un çift render'ı geliştirme
 * ortamında log'u iki kez gösterebilir; bu bilinçli bir ödünç — güvenlik
 * log'unun yönlendirmeyle AYNI karede oluşması, effect'e ertelenmesinden
 * (yukarıdaki 1. madde) daha değerli.
 */
export function RequireTabAccess({ tab, role, children }: Props) {
  if (!TAB_ROLES[tab].includes(role)) {
    console.warn(`[Security] Yetkisiz ekran erişimi engellendi (${tab}). Harekat Merkezi'ne yönlendiriliyor.`);
    return <Navigate to={tabPath(DEFAULT_TAB)} replace />;
  }
  return <>{children}</>;
}
