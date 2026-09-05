import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireTabAccess } from './RequireTabAccess';
import { TAB_ROLES, APP_TAB_IDS, type AppTabId } from '../constants';
import type { UserRole } from '../types';

/**
 * Sekme yetki kontrolü, routing öncesinde AuthenticatedApp'teki bir
 * useEffect'ti ve HİÇ testi yoktu — RBAC güvenlik duvarı olarak davranan bu
 * mantık artık adres çubuğundan gelen derin linkleri de karşılıyor (bkz. kod
 * denetimi P1-6), o yüzden burada doğrudan test ediliyor.
 */
const renderAt = (route: string, role: UserRole) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        {APP_TAB_IDS.map((tab) => (
          <Route
            key={tab}
            path={tab}
            element={
              <RequireTabAccess tab={tab} role={role}>
                <div>EKRAN:{tab}</div>
              </RequireTabAccess>
            }
          />
        ))}
      </Routes>
    </MemoryRouter>
  );

describe('RequireTabAccess', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('yetkili rol ekranı görür', () => {
    renderAt('/reports', 'Admin');
    expect(screen.getByText('EKRAN:reports')).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('yetkisiz derin link Harekat Merkezi\'ne yönlendirilir ve ekran BİR KARE BİLE render edilmez', () => {
    renderAt('/reports', 'Staff');

    expect(screen.queryByText('EKRAN:reports')).not.toBeInTheDocument();
    expect(screen.getByText('EKRAN:dashboard')).toBeInTheDocument();
  });

  it('yetkisiz erişimde aynı [Security] uyarısı log\'lanır (eski useEffect sürümüyle birebir)', () => {
    renderAt('/audit', 'Manager');

    expect(warnSpy).toHaveBeenCalledWith(
      "[Security] Yetkisiz ekran erişimi engellendi (audit). Harekat Merkezi'ne yönlendiriliyor."
    );
  });

  /**
   * Guard'ın TAB_ROLES'u DOĞRUDAN okuduğunun kanıtı: burada tekrarlanmış bir
   * beklenti tablosu yok, matris tek doğruluk kaynağından üretiliyor. Yeni bir
   * sekme/rol eklendiğinde bu test kendiliğinden onu da kapsar.
   */
  it('TAB_ROLES matrisinin tamamı için izin/ret davranışı tutarlıdır', () => {
    const roles: UserRole[] = ['Admin', 'Manager', 'Staff'];

    for (const tab of APP_TAB_IDS) {
      for (const role of roles) {
        const { unmount } = renderAt(`/${tab}`, role);
        const allowed = TAB_ROLES[tab as AppTabId].includes(role);

        expect(
          screen.queryByText(`EKRAN:${tab}`) !== null,
          `${role} → /${tab} beklenen erişim: ${allowed}`
        ).toBe(allowed);

        unmount();
      }
    }
  });
});
