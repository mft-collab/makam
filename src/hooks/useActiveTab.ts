/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocation } from 'react-router-dom';
import { TAB_ROLES, DEFAULT_TAB, type AppTabId } from '../constants';

/**
 * Aktif sekmeyi URL'den türetir — uiStore'daki eski `activeTab` alanının
 * yerini alır (bkz. kod denetimi P1-6: navigasyon durumu hem Zustand'da hem
 * URL'de tutulsaydı iki doğruluk kaynağı oluşurdu).
 *
 * Yalnızca İLK yol parçasına bakar: `/tasks/abc123` de `'tasks'` döner, böylece
 * görev detay alt-route'u açıkken sayfa başlığı/geçiş animasyonu sekme
 * değişmiş gibi davranmaz.
 *
 * Bilinmeyen bir yol (ör. eski bir yer imi) DEFAULT_TAB'a düşer; bu yalnızca
 * GÖRÜNÜM içindir — asıl yönlendirmeyi Routes'taki catch-all yapar.
 */
export function useActiveTab(): AppTabId {
  const { pathname } = useLocation();
  const segment = pathname.split('/')[1] ?? '';
  return segment in TAB_ROLES ? (segment as AppTabId) : DEFAULT_TAB;
}
