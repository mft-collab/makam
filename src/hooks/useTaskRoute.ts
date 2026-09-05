/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { tabPath, type AppTabId } from '../constants';

/** Görev detay alt-route'u. Tek yerde tanımlıdır: hem eşleştirme (useMatch)
 *  hem de üretim (openTask) buradan okur. */
export const TASK_DETAIL_PATH = '/tasks/:taskId';

/**
 * Açık görev detayının kimliği — uiStore'daki eski `selectedTaskId` alanının
 * yerini alır. `useParams` yerine `useMatch` kullanılır çünkü detay modalı
 * `/tasks/:taskId` route element'inin İÇİNDE değil, AuthenticatedApp'in en üst
 * seviyesinde (tüm sekmelerin dışında, Modal'ın kendi ağacında) render edilir —
 * `useParams` orada boş dönerdi.
 */
export function useSelectedTaskId(): string | null {
  const match = useMatch(TASK_DETAIL_PATH);
  return match?.params.taskId ?? null;
}

/**
 * Programatik navigasyon — eski `setSelectedTaskId(id)` / `(null)` ve
 * `setActiveTab(tab)` çağrılarının karşılığı.
 *
 * `closeTask` `/tasks`'a gider: kullanıcı detayı Harekat Merkezi'nden açmış
 * olsa bile eskiden de `activeTab` 'tasks'a sabitleniyordu (bkz. eski
 * `onViewTask={(t) => { setSelectedTaskId(t.id); setActiveTab('tasks'); }}`) —
 * davranış birebir korunur.
 *
 * `goToTab` yalnızca menü DIŞINDAKİ programatik geçişler içindir (ör.
 * Dashboard'daki "Raporlara git" kartı). Sidebar/MobileDock gibi asıl menüler
 * <NavLink> kullanır: gerçek bir <a href> olmaları orta tık/yeni sekmede aç/
 * bağlantıyı kopyala davranışlarını ücretsiz getirir.
 */
export function useTaskNavigation() {
  const navigate = useNavigate();
  return useMemo(() => ({
    openTask: (taskId: string) => { void navigate(`/tasks/${taskId}`); },
    closeTask: () => { void navigate('/tasks'); },
    goToTab: (tab: AppTabId) => { void navigate(tabPath(tab)); },
  }), [navigate]);
}
