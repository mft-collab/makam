import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

const initialState = useUIStore.getState();

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState(initialState, true);
  });

  describe('filtreleme', () => {
    it('setFilter mevcut filtreyle birleştirir (kısmi güncelleme)', () => {
      useUIStore.getState().setFilter({ status: 'BLOCKED' });
      expect(useUIStore.getState().filter).toMatchObject({ status: 'BLOCKED', priority: 'ALL', search: '' });

      useUIStore.getState().setFilter({ search: 'acil' });
      expect(useUIStore.getState().filter).toMatchObject({ status: 'BLOCKED', priority: 'ALL', search: 'acil' });
    });

    it('resetFilter varsayılan filtreye döner', () => {
      useUIStore.getState().setFilter({ status: 'COMPLETED', search: 'x' });
      useUIStore.getState().resetFilter();
      expect(useUIStore.getState().filter).toEqual({ status: 'ALL', priority: 'ALL', search: '' });
    });
  });

  describe('toast yönetimi', () => {
    it('addToast benzersiz id ile ekler', () => {
      useUIStore.getState().addToast({ title: 'Başlık', body: 'Gövde', type: 'success' });
      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({ title: 'Başlık', body: 'Gövde', type: 'success' });
      expect(toasts[0]!.id).toBeTruthy();
    });

    it('removeToast yalnızca belirtilen id\'yi kaldırır', () => {
      useUIStore.getState().addToast({ title: 'A', body: '' });
      useUIStore.getState().addToast({ title: 'B', body: '' });
      const [first, second] = useUIStore.getState().toasts;

      useUIStore.getState().removeToast(first!.id);

      const remaining = useUIStore.getState().toasts;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(second!.id);
    });
  });

  describe('App seviyesi modal aksiyonları', () => {
    it('closeAllModals modal state\'ini ve bağlı alanları sıfırlar', () => {
      useUIStore.setState({
        isCreateModalOpen: true,
        isEditModalOpen: true,
        parentTaskId: 'task-1',
        initialTitle: 'Ön Başlık',
      });

      useUIStore.getState().closeAllModals();

      const state = useUIStore.getState();
      expect(state.isCreateModalOpen).toBe(false);
      expect(state.isEditModalOpen).toBe(false);
      expect(state.parentTaskId).toBeUndefined();
      expect(state.initialTitle).toBeUndefined();
    });

    it('closeAllModals selectedTaskId\'ye dokunmaz (bağımsız bir alan)', () => {
      useUIStore.setState({ isCreateModalOpen: true, selectedTaskId: 'task-9' });
      useUIStore.getState().closeAllModals();
      expect(useUIStore.getState().selectedTaskId).toBe('task-9');
    });

    it('setSelectedTaskId ve setShowNotifications bağımsız çalışır', () => {
      useUIStore.getState().setSelectedTaskId('task-42');
      useUIStore.getState().setShowNotifications(true);
      expect(useUIStore.getState().selectedTaskId).toBe('task-42');
      expect(useUIStore.getState().showNotifications).toBe(true);
    });
  });

  describe('tema', () => {
    it('setTheme temayı günceller', () => {
      useUIStore.getState().setTheme('dark');
      expect(useUIStore.getState().theme).toBe('dark');
    });
  });
});
