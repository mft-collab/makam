import { describe, it, expect } from 'vitest';
import { computeStats, computeCompletionRatePercent, computeHealthScore } from './helpers';
import type { Task } from '../../types';
import type { GlobalStats } from '../../store/dataStore';

const now = Date.parse('2026-08-26T12:00:00');

const baseTask: Task = {
  id: 't-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'ASSIGNED', priority: 'Medium', deadline: now + 100_000,
  createdAt: now, updatedAt: now, totalPausedTime: 0, lockVersion: 0,
  tags: [], checklist: [], comments: [],
} as Task;

const emptyGlobalStats: GlobalStats = {
  totalTasks: 0, status_ASSIGNED: 0, status_PENDING_DELEGATION: 0, status_IN_PROGRESS: 0,
  status_AWAITING_APPROVAL: 0, status_COMPLETED: 0, status_BLOCKED: 0, status_CANCELLED: 0, status_CRISIS: 0,
};

describe('computeStats — "Bekleyen" kartı, globalStats ve yerel hesap yolları arasında tutarlılık', () => {
  it('globalStats yolu (Admin/Müdür varsayılan pano): ASSIGNED + PENDING_DELEGATION toplamını sayar', () => {
    // Eskiden yalnızca status_ASSIGNED sayılıyordu, status_PENDING_DELEGATION
    // (izin/mazeret devri bekleyen görevler) bu kartta görünmüyordu.
    const stats = computeStats([], now, { ...emptyGlobalStats, status_ASSIGNED: 3, status_PENDING_DELEGATION: 2 }, false, false);
    expect(stats.waiting).toBe(5);
  });

  it('yerel hesap yolu (Staff kişisel görünüm / odak filtresi aktif): ASSIGNED + PENDING_DELEGATION toplamını sayar', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'ASSIGNED' },
      { ...baseTask, id: 't2', status: 'PENDING_DELEGATION' },
      { ...baseTask, id: 't3', status: 'IN_PROGRESS' },
    ];
    const stats = computeStats(tasks, now, null, false, true);
    expect(stats.waiting).toBe(2);
  });

  it('aynı veri için globalStats ve yerel hesap yolu AYNI "Bekleyen" sayısını üretir', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'ASSIGNED' },
      { ...baseTask, id: 't2', status: 'ASSIGNED' },
      { ...baseTask, id: 't3', status: 'PENDING_DELEGATION' },
      { ...baseTask, id: 't4', status: 'IN_PROGRESS' },
      { ...baseTask, id: 't5', status: 'COMPLETED' },
    ];
    const localStats = computeStats(tasks, now, null, false, false);
    const matchingGlobalStats: GlobalStats = { ...emptyGlobalStats, status_ASSIGNED: 2, status_PENDING_DELEGATION: 1, status_IN_PROGRESS: 1, status_COMPLETED: 1, totalTasks: tasks.length };
    const globalStatsPath = computeStats(tasks, now, matchingGlobalStats, false, false);

    expect(globalStatsPath.waiting).toBe(localStats.waiting);
    expect(globalStatsPath.waiting).toBe(3);
  });

  it('isFiltered veya kişisel görünümde globalStats verilse bile yok sayılır, her zaman yerel hesap kullanılır', () => {
    const tasks: Task[] = [{ ...baseTask, id: 't1', status: 'PENDING_DELEGATION' }];
    // globalStats kasıtlı olarak yanlış/tutarsız bir değer taşıyor —
    // isFiltered=true olduğundan hiç okunmamalı.
    const stats = computeStats(tasks, now, { ...emptyGlobalStats, status_ASSIGNED: 999 }, true, false);
    expect(stats.waiting).toBe(1);
  });
});

describe('computeCompletionRatePercent / computeHealthScore — sınır durumları', () => {
  it('görev yokken %0 tamamlanma, ama sağlık skoru %100 döner (boş küme "kötü" değil "veri yok" anlamına gelir)', () => {
    expect(computeCompletionRatePercent([])).toBe(0);
    expect(computeHealthScore(0, 0, 100)).toBe(100);
  });

  it('CANCELLED görevler tamamlanma oranı paydasından çıkarılır', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 't1', status: 'COMPLETED' },
      { ...baseTask, id: 't2', status: 'CANCELLED' },
    ];
    expect(computeCompletionRatePercent(tasks)).toBe(100);
  });
});
