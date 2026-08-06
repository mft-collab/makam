import { describe, it, expect } from 'vitest';
import { mergeDataState } from './dataStore';
import type { Task } from '../types';

const baseState = {
  tasks: [] as Task[],
  users: [],
  blockers: [],
  stats: null,
  isHydrated: false,
  hasLiveData: false,
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
    const result = mergeDataState(persisted, { ...baseState, hasLiveData: false });
    expect(result.tasks).toEqual(persisted.tasks);
  });

  it('rehydration tamamlanmadan ÖNCE canlı Firestore verisi geldiyse, IDB önbelleği taze veriyi EZMEZ', () => {
    const liveTasks: Task[] = [{ id: 'live-task' } as Task];
    const currentState = { ...baseState, tasks: liveTasks, hasLiveData: true };
    const stalePersisted = { tasks: [{ id: 'stale-cached-task' }] as Task[] };

    const result = mergeDataState(stalePersisted, currentState);

    // Bayat IDB verisi değil, o oturumda zaten gelmiş canlı veri korunur
    expect(result.tasks).toEqual(liveTasks);
    expect(result.tasks).not.toEqual(stalePersisted.tasks);
  });
});
