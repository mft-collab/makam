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

interface UIStore {
  // Görev form modalı (App seviyesi)
  isCreateModalOpen: boolean;
  isEditModalOpen: boolean;
  parentTaskId: string | undefined;
  initialTitle: string | undefined;
  selectedTaskId: string | null;

  // Bildirim paneli — isX adlandırma kuralına uyum için showNotifications'tan
  // yeniden adlandırıldı (bkz. kod denetimi: isCreateModalOpen/isEditModalOpen
  // ile tutarsızdı).
  isNotificationsOpen: boolean;

  // Tema
  theme: 'light' | 'dark' | 'system';

  // Tab durumu
  activeTab: string;

  // Filtreleme
  filter: TaskFilter;

  // Toast bildirimleri
  toasts: ToastItem[];

  // Aksiyonlar — mevcut
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setActiveTab: (tab: string) => void;
  setFilter: (partial: Partial<TaskFilter>) => void;
  resetFilter: () => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;

  // Aksiyonlar — yeni (App seviyesi modal yönetimi)
  setIsCreateModalOpen: (open: boolean) => void;
  setIsEditModalOpen: (open: boolean) => void;
  setParentTaskId: (id: string | undefined) => void;
  setInitialTitle: (title: string | undefined) => void;
  setSelectedTaskId: (id: string | null) => void;
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
      selectedTaskId: null,

      // Bildirim paneli
      isNotificationsOpen: false,

      // Tab
      activeTab: 'dashboard',

      // Filtreleme
      filter: DEFAULT_FILTER,

      // Toastlar
      toasts: [],

      // Tema
      theme: 'system',

      // ─── Tema ───────────────────────────────────────────────────────────────

      setTheme: (theme) => set({ theme }),

    // ─── Tab ────────────────────────────────────────────────────────────────

    setActiveTab: (tab) => set({ activeTab: tab }),

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
    setSelectedTaskId: (id) => set({ selectedTaskId: id }),
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
