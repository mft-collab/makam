import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';
import type { Task, User, TaskBlocker } from '../types';

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

interface GlobalStats {
  totalTasks: number;
  status_ASSIGNED: number;
  status_IN_PROGRESS: number;
  status_AWAITING_APPROVAL: number;
  status_COMPLETED: number;
  status_BLOCKED: number;
  status_CANCELLED: number;
  status_CRISIS: number;
}

interface DataState {
  tasks: Task[];
  users: User[];
  blockers: TaskBlocker[];
  stats: GlobalStats | null;
  isHydrated: boolean;
  taskLimit: number;
  setTasks: (tasks: Task[]) => void;
  setUsers: (users: User[]) => void;
  setBlockers: (blockers: TaskBlocker[]) => void;
  setStats: (stats: GlobalStats) => void;
  setHydrated: () => void;
  loadMoreTasks: () => void;
}

export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      tasks: [],
      users: [],
      blockers: [],
      stats: null,
      isHydrated: false,
      taskLimit: 200,
      setTasks: (tasks) => set({ tasks }),
      setUsers: (users) => set({ users }),
      setBlockers: (blockers) => set({ blockers }),
      setStats: (stats) => set({ stats }),
      setHydrated: () => set({ isHydrated: true }),
      loadMoreTasks: () => set((state) => ({ taskLimit: state.taskLimit + 200 })),
    }),
    {
      name: 'makam-data-storage',
      storage: createJSONStorage(() => idbStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated();
        }
      },
    }
  )
);
