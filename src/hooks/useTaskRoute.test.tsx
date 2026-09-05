import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSelectedTaskId, useTaskNavigation } from './useTaskRoute';
import { useActiveTab } from './useActiveTab';

const wrapperAt = (route: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
  );

describe('URL tabanlı navigasyon (uiStore.activeTab/selectedTaskId yerine)', () => {
  describe('useSelectedTaskId', () => {
    it('/tasks/:taskId üzerinde görev kimliğini döner (derin link)', () => {
      const { result } = renderHook(() => useSelectedTaskId(), { wrapper: wrapperAt('/tasks/task-42') });
      expect(result.current).toBe('task-42');
    });

    it('detay alt-route\'u dışında null döner', () => {
      const { result } = renderHook(() => useSelectedTaskId(), { wrapper: wrapperAt('/tasks') });
      expect(result.current).toBeNull();
    });

    it('başka bir sekmedeyken null döner (modal açık kalmaz)', () => {
      const { result } = renderHook(() => useSelectedTaskId(), { wrapper: wrapperAt('/dashboard') });
      expect(result.current).toBeNull();
    });
  });

  describe('useActiveTab', () => {
    it('yol parçasını sekmeye çevirir', () => {
      const { result } = renderHook(() => useActiveTab(), { wrapper: wrapperAt('/reports') });
      expect(result.current).toBe('reports');
    });

    // Görev detayı açıkken sekme HÂLÂ 'tasks' olmalı — aksi halde AppHeader
    // başlığı ve sayfa geçiş animasyonu (AnimatePresence key) modal her
    // açılıp kapandığında sıfırlanırdı.
    it('/tasks/:taskId üzerinde de "tasks" döner', () => {
      const { result } = renderHook(() => useActiveTab(), { wrapper: wrapperAt('/tasks/abc') });
      expect(result.current).toBe('tasks');
    });

    it('bilinmeyen yol varsayılan sekmeye düşer', () => {
      const { result } = renderHook(() => useActiveTab(), { wrapper: wrapperAt('/olmayan-ekran') });
      expect(result.current).toBe('dashboard');
    });
  });

  describe('useTaskNavigation', () => {
    it('openTask/closeTask/goToTab URL\'i günceller', () => {
      const { result } = renderHook(
        () => ({ nav: useTaskNavigation(), location: useLocation() }),
        { wrapper: wrapperAt('/dashboard') }
      );

      act(() => { result.current.nav.openTask('task-7'); });
      expect(result.current.location.pathname).toBe('/tasks/task-7');

      act(() => { result.current.nav.closeTask(); });
      expect(result.current.location.pathname).toBe('/tasks');

      act(() => { result.current.nav.goToTab('settings'); });
      expect(result.current.location.pathname).toBe('/settings');
    });
  });
});
