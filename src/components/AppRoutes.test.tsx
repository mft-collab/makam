import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppRoutes } from './AppRoutes';
import { APP_TAB_IDS, type AppTabId } from '../constants';
import { useSelectedTaskId } from '../hooks/useTaskRoute';
import { useActiveTab } from '../hooks/useActiveTab';
import type { UserRole } from '../types';

/**
 * GERÇEK route ağacı test edilir (AppRoutes bileşeninin kendisi) — testte
 * ikinci bir route tablosu kopyalanmaz, ki böyle bir kopya zamanla sessizce
 * AuthenticatedApp'ten sapardı.
 */
const screens = Object.fromEntries(
  APP_TAB_IDS.map((t) => [t, <div key={t}>EKRAN:{t}</div>])
) as Record<AppTabId, ReactNode>;

/** Route ağacıyla birlikte URL'den türetilen navigasyon durumunu da gösterir. */
function Probe() {
  const selected = useSelectedTaskId();
  const activeTab = useActiveTab();
  return (
    <>
      <div data-testid="tab">{activeTab}</div>
      <div data-testid="selected">{selected ?? 'YOK'}</div>
    </>
  );
}

const at = (route: string, role: UserRole = 'Admin') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Probe />
      <AppRoutes role={role} screens={screens} />
    </MemoryRouter>
  );

describe('AppRoutes', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('kök (/) varsayılan ekrana yönlenir', () => {
    at('/');
    expect(screen.getByText('EKRAN:dashboard')).toBeInTheDocument();
  });

  it('bilinmeyen yol (eski yer imi) varsayılan ekrana düşer', () => {
    at('/olmayan-ekran');
    expect(screen.getByText('EKRAN:dashboard')).toBeInTheDocument();
  });

  it('her sekme kendi ekranını render eder', () => {
    for (const tab of APP_TAB_IDS) {
      const { unmount } = at(`/${tab}`);
      expect(screen.getByText(`EKRAN:${tab}`)).toBeInTheDocument();
      unmount();
    }
  });

  describe('/tasks/:taskId (görev detay derin linki)', () => {
    it('TaskBoard ekranını AÇIK tutar, taskId\'yi çözer ve sekme "tasks" kalır', () => {
      at('/tasks/task-77');

      // Detay alt-route'u TaskBoard'un ÜZERİNDE açılır — altındaki ekran
      // kaybolmaz (kardeş route olsaydı TaskBoard unmount olurdu).
      expect(screen.getByText('EKRAN:tasks')).toBeInTheDocument();
      expect(screen.getByTestId('selected').textContent).toBe('task-77');
      expect(screen.getByTestId('tab').textContent).toBe('tasks');
    });

    /**
     * Regresyon: alt route'a `element` verilmezse react-router HER görev
     * detayı açılışında "Matched leaf route ... does not have an element or
     * Component" uyarısı basıyor. Görev detayı açmak uygulamanın en sık
     * eylemlerinden biri olduğundan bu, dev konsolunu sürekli kirletirdi.
     */
    it('konsola react-router uyarısı BASMAZ', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      at('/tasks/task-77');

      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  });

  it('yetkisiz sekmeye derin link, guard üzerinden varsayılan ekrana düşer', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    at('/audit', 'Staff');

    expect(screen.queryByText('EKRAN:audit')).not.toBeInTheDocument();
    expect(screen.getByText('EKRAN:dashboard')).toBeInTheDocument();
  });
});
