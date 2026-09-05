import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type { TaskStatus } from '../types';

interface TaskFilter {
  status: TaskStatus | 'ALL';
  priority: string;
  search: string;
}

export interface ToastItem {
  id: string;
  title: string;
  body: string;
  type?: 'info' | 'danger' | 'success' | 'warning';
  taskId?: string;
}

/**
 * NAVİGASYON DURUMU BURADA TUTULMAZ. Aktif sekme (`activeTab`) ve açık görev
 * detayı (`selectedTaskId`) eskiden bu store'daydı; artık TEK doğruluk kaynağı
 * URL'dir (react-router). Bkz. kod denetimi P1-6: ikisi birlikte tutulduğunda
 * derin link, tarayıcı geri tuşu ve sayfa yenileme sessizce bozuluyordu.
 * Karşılıkları: `useActiveTab()`, `useSelectedTaskId()`, `useTaskNavigation()`.
 */
interface UIStore {
  // Görev form modalı (App seviyesi)
  isCreateModalOpen: boolean;
  isEditModalOpen: boolean;
  parentTaskId: string | undefined;
  initialTitle: string | undefined;

  // Bildirim paneli — isX adlandırma kuralına uyum için showNotifications'tan
  // yeniden adlandırıldı (bkz. kod denetimi: isCreateModalOpen/isEditModalOpen
  // ile tutarsızdı).
  isNotificationsOpen: boolean;

  // Tema
  theme: 'light' | 'dark' | 'system';

  // Filtreleme
  filter: TaskFilter;

  // Toast bildirimleri
  toasts: ToastItem[];

  // Aksiyonlar — mevcut
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setFilter: (partial: Partial<TaskFilter>) => void;
  resetFilter: () => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;

  // Aksiyonlar — yeni (App seviyesi modal yönetimi)
  setIsCreateModalOpen: (open: boolean) => void;
  setIsEditModalOpen: (open: boolean) => void;
  setParentTaskId: (id: string | undefined) => void;
  setInitialTitle: (title: string | undefined) => void;
  setIsNotificationsOpen: (open: boolean) => void;
  closeAllModals: () => void;
}

const DEFAULT_FILTER: TaskFilter = {
  status: 'ALL',
  priority: 'ALL',
  search: '',
};

export const useUIStore = create<UIStore>()(
  persist(
    subscribeWithSelector((set) => ({
      // App seviyesi görev modalları
      isCreateModalOpen: false,
      isEditModalOpen: false,
      parentTaskId: undefined,
      initialTitle: undefined,

      // Bildirim paneli
      isNotificationsOpen: false,

      // Filtreleme
      filter: DEFAULT_FILTER,

      // Toastlar
      toasts: [],

      // Tema
      theme: 'system',

      // ─── Tema ───────────────────────────────────────────────────────────────

      setTheme: (theme) => set({ theme }),

    // ─── Filtreleme ──────────────────────────────────────────────────────────

    setFilter: (partial) => set((state) => ({
      filter: { ...state.filter, ...partial },
    })),

    resetFilter: () => set({ filter: DEFAULT_FILTER }),

    // ─── Toast ──────────────────────────────────────────────────────────────

    addToast: (toast) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set((state) => ({
        toasts: [...state.toasts, { ...toast, id }],
      }));
      // Not: Otomatik kaldırma ExecutiveToast bileşeni tarafından 6s sonra yapılır.
      // uiStore'da ayrıca timer başlatmak çift kaldırma (double removal) sorununa yol açar.
    },

    removeToast: (id) => set((state) => ({
      toasts: state.toasts.filter(t => t.id !== id),
    })),

    // ─── App Seviyesi Modal Aksiyonları ──────────────────────────────────────

    setIsCreateModalOpen: (open) => set({ isCreateModalOpen: open }),
    setIsEditModalOpen: (open) => set({ isEditModalOpen: open }),
    setParentTaskId: (id) => set({ parentTaskId: id }),
    setInitialTitle: (title) => set({ initialTitle: title }),
    setIsNotificationsOpen: (open) => set({ isNotificationsOpen: open }),

    closeAllModals: () => set({
      isCreateModalOpen: false,
      isEditModalOpen: false,
      parentTaskId: undefined,
      initialTitle: undefined,
    }),
  })),
  {
    name: 'makam-ui-settings',
    partialize: (state) => ({ theme: state.theme }),
  }
));
