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
   *  veriyi ezmesini engellemek için kullanılır (bkz. mergeDataState()).
   *  ALAN BAZINDA ayrı ayrı izlenir: tasks/users/blockers/stats dört bağımsız
   *  Firestore dinleyicisidir ve farklı hızlarda döner. Tek bir paylaşılan
   *  bayrak kullanılırsa, hızlı dönen bir dinleyici (ör. küçük system/stats
   *  dokümanı) bayrağı erkenden true yapıp, henüz kendi canlı verisi gelmemiş
   *  DİĞER alanların (ör. tasks) IDB önbelleğinden geri yüklenmesini de
   *  engelleyebilir — kullanıcı geçici olarak "hiç görev yok" boş ekranıyla
   *  karşılaşır. */
  hasLiveTasks: boolean;
  hasLiveUsers: boolean;
  hasLiveBlockers: boolean;
  hasLiveStats: boolean;
  taskLimit: number;
  setTasks: (tasks: Task[]) => void;
  setUsers: (users: User[]) => void;
  setBlockers: (blockers: TaskBlocker[]) => void;
  setStats: (stats: GlobalStats) => void;
  setHydrated: () => void;
  loadMoreTasks: () => void;
  /** Çıkış (logout) yapıldığında çağrılır — aksi halde önceki kullanıcının
   *  görev/kullanıcı/engel verisi hem bellekte hem idb-keyval diskinde kalır
   *  ve aynı cihazda giriş yapan bir sonraki kullanıcıya (yeni onSnapshot
   *  verisi gelene kadar, offline'sa hiç gelmeyebilir) görünür kalabilir
   *  (bkz. kod denetimi). hasLive* bayrakları da sıfırlanır ki yeni oturumun
   *  ilk IDB rehydration'ı mergeDataState tarafından doğru değerlendirilsin.
   */
  reset: () => void;
}

// IDB okuması Firestore'un ilk canlı anlık görüntüsünden daha uzun sürerse,
// rehydration bu sırada zaten gelmiş taze veriyi bayat önbellekle ezebilir.
// hasLive* bayrakları bu oturumda HER alan için ayrı ayrı canlı veri gelip
// gelmediğini işaretler; bir alan için geldiyse yalnızca O ALANIN rehydration'ı
// engellenir, henüz canlı verisi gelmemiş diğer alanlar IDB önbelleğinden
// normal şekilde geri yüklenmeye devam eder. Ayrı export edilmiştir — böylece
// asenkron persist/rehydrate akışını tetiklemeden doğrudan test edilebilir.
export function mergeDataState(persistedState: unknown, currentState: DataState): DataState {
  const persisted = (persistedState as Partial<DataState>) ?? {};
  return {
    ...currentState,
    tasks: currentState.hasLiveTasks ? currentState.tasks : (persisted.tasks ?? currentState.tasks),
    users: currentState.hasLiveUsers ? currentState.users : (persisted.users ?? currentState.users),
    blockers: currentState.hasLiveBlockers ? currentState.blockers : (persisted.blockers ?? currentState.blockers),
    stats: currentState.hasLiveStats ? currentState.stats : (persisted.stats ?? currentState.stats),
  };
}

export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      tasks: [],
      users: [],
      blockers: [],
      stats: null,
      isHydrated: false,
      hasLiveTasks: false,
      hasLiveUsers: false,
      hasLiveBlockers: false,
      hasLiveStats: false,
      taskLimit: 200,
      setTasks: (tasks) => set({ tasks, hasLiveTasks: true }),
      setUsers: (users) => set({ users, hasLiveUsers: true }),
      setBlockers: (blockers) => set({ blockers, hasLiveBlockers: true }),
      setStats: (stats) => set({ stats, hasLiveStats: true }),
      setHydrated: () => set({ isHydrated: true }),
      loadMoreTasks: () => set((state) => ({ taskLimit: state.taskLimit + 200 })),
      reset: () => set({
        tasks: [],
        users: [],
        blockers: [],
        stats: null,
        hasLiveTasks: false,
        hasLiveUsers: false,
        hasLiveBlockers: false,
        hasLiveStats: false,
        taskLimit: 200,
      }),
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
