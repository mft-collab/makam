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

export interface GlobalStats {
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
  /** Bu oturumda Firestore'dan en az bir kez canlı veri geldi mi? IDB'den
   *  rehydration asenkron olduğundan, canlı onSnapshot verisi IDB okumasından
   *  ÖNCE gelebilir — bu durumda rehydration'ın bayat önbellek verisiyle taze
   *  veriyi ezmesini engellemek için kullanılır (bkz. merge()). */
  hasLiveData: boolean;
  taskLimit: number;
  setTasks: (tasks: Task[]) => void;
  setUsers: (users: User[]) => void;
  setBlockers: (blockers: TaskBlocker[]) => void;
  setStats: (stats: GlobalStats) => void;
  setHydrated: () => void;
  loadMoreTasks: () => void;
}

// IDB okuması Firestore'un ilk canlı anlık görüntüsünden daha uzun sürerse,
// rehydration bu sırada zaten gelmiş taze veriyi bayat önbellekle ezebilir.
// hasLiveData bayrağı bu oturumda canlı veri gelip gelmediğini işaretler;
// geldiyse rehydration'ın üzerine yazması engellenir. Ayrı export edilmiştir —
// böylece asenkron persist/rehydrate akışını tetiklemeden doğrudan test edilebilir.
export function mergeDataState(persistedState: unknown, currentState: DataState): DataState {
  if (currentState.hasLiveData) return currentState;
  return { ...currentState, ...(persistedState as Partial<DataState>) };
}

export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      tasks: [],
      users: [],
      blockers: [],
      stats: null,
      isHydrated: false,
      hasLiveData: false,
      taskLimit: 200,
      setTasks: (tasks) => set({ tasks, hasLiveData: true }),
      setUsers: (users) => set({ users, hasLiveData: true }),
      setBlockers: (blockers) => set({ blockers, hasLiveData: true }),
      setStats: (stats) => set({ stats, hasLiveData: true }),
      setHydrated: () => set({ isHydrated: true }),
      loadMoreTasks: () => set((state) => ({ taskLimit: state.taskLimit + 200 })),
    }),
    {
      name: 'makam-data-storage',
      storage: createJSONStorage(() => idbStorage),
      merge: mergeDataState,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated();
        }
      },
    }
  )
);
