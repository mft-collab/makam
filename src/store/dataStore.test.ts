import { describe, it, expect } from 'vitest';
import { mergeDataState } from './dataStore';
import type { Task } from '../types';

const baseState = {
  tasks: [] as Task[],
  users: [],
  blockers: [],
  stats: null,
  isHydrated: false,
  hasLiveTasks: false,
  hasLiveUsers: false,
  hasLiveBlockers: false,
  hasLiveStats: false,
  taskLimit: 200,
  setTasks: () => {},
  setUsers: () => {},
  setBlockers: () => {},
  setStats: () => {},
  setHydrated: () => {},
  loadMoreTasks: () => {},
};

describe('mergeDataState — IDB rehydration yarışı koruması', () => {
  it('canlı veri henüz gelmediyse (normal akış) IDB\'den gelen önbellek uygulanır', () => {
    const persisted = { tasks: [{ id: 'cached-task' }] as Task[] };
    const result = mergeDataState(persisted, { ...baseState, hasLiveTasks: false });
    expect(result.tasks).toEqual(persisted.tasks);
  });

  it('rehydration tamamlanmadan ÖNCE canlı Firestore verisi geldiyse, IDB önbelleği taze veriyi EZMEZ', () => {
    const liveTasks: Task[] = [{ id: 'live-task' } as Task];
    const currentState = { ...baseState, tasks: liveTasks, hasLiveTasks: true };
    const stalePersisted = { tasks: [{ id: 'stale-cached-task' }] as Task[] };

    const result = mergeDataState(stalePersisted, currentState);

    // Bayat IDB verisi değil, o oturumda zaten gelmiş canlı veri korunur
    expect(result.tasks).toEqual(liveTasks);
    expect(result.tasks).not.toEqual(stalePersisted.tasks);
  });

  it('bir alanın (stats) canlı verisi erken gelse bile, henüz canlı verisi gelmemiş DİĞER bir alan (tasks) IDB önbelleğinden geri yüklenmeye devam eder', () => {
    // Bu, düzeltilen yarış durumunu doğrudan test eder: eskiden tek paylaşılan
    // hasLiveData bayrağı, hızlı dönen stats dinleyicisi yüzünden erken true
    // olup tasks'ın IDB'den geri yüklenmesini de engelliyordu.
    const currentState = { ...baseState, stats: { totalTasks: 5 } as any, hasLiveStats: true, hasLiveTasks: false };
    const persisted = { tasks: [{ id: 'cached-task' }] as Task[], stats: { totalTasks: 999 } as any };

    const result = mergeDataState(persisted, currentState);

    expect(result.tasks).toEqual(persisted.tasks);
    expect(result.stats).toEqual({ totalTasks: 5 }); // canlı stats korunur, IDB'deki bayat değer değil
  });
});
