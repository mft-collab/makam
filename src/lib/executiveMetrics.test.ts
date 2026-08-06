import { describe, expect, it } from 'vitest';
import { calculateTaskRisk, getInterventionQueue, getUserPerformanceProfiles, isTaskInCrisis } from './executiveMetrics';
import type { Task, User } from '../types';

const now = new Date('2026-07-02T09:00:00.000Z').getTime();

const user: User = {
  uid: 'u1',
  fullName: 'Ayşe Yönetici',
  email: 'ayse@example.com',
  role: 'Manager',
};

function task(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'Kritik talimat',
    description: 'Açıklama',
    creatorId: 'admin',
    assigneeId: 'u1',
    status: 'IN_PROGRESS',
    priority: 'Medium',
    deadline: now + 3 * 24 * 60 * 60 * 1000,
    createdAt: now - 24 * 60 * 60 * 1000,
    updatedAt: now - 2 * 60 * 60 * 1000,
    totalPausedTime: 0,
    comments: [],
    lockVersion: 0,
    tags: [],
    ...overrides,
  };
}

describe('executiveMetrics', () => {
  it('raises risk for overdue urgent blocked tasks', () => {
    const risky = task({
      status: 'BLOCKED',
      priority: 'Urgent',
      deadline: now - 2 * 24 * 60 * 60 * 1000,
      updatedAt: now - 3 * 24 * 60 * 60 * 1000,
    });

    const profile = calculateTaskRisk(risky, [risky], now);

    expect(profile.level).toBe('critical');
    expect(profile.score).toBeGreaterThanOrEqual(80);
    expect(profile.reasons.join(' ')).toContain('engel');
  });

  it('orders intervention queue by operational risk', () => {
    const normal = task({ id: 'normal', title: 'Normal iş', priority: 'Low' });
    const approval = task({ id: 'approval', title: 'Onay işi', status: 'AWAITING_APPROVAL' });
    const crisis = task({
      id: 'crisis',
      title: 'Geciken iş',
      status: 'CRISIS',
      priority: 'High',
      deadline: now - 60 * 60 * 1000,
    });

    const queue = getInterventionQueue([normal, approval, crisis], [user], now);

    expect(queue[0]?.task.id).toBe('crisis');
    expect(queue.some(item => item.task.id === 'approval')).toBe(true);
    expect(queue.every(item => item.task.id !== 'normal')).toBe(true);
  });

  it('isTaskInCrisis, orijinal deadline geçmiş ama duraklatma süresiyle uzatılmış efektif deadline içindeki BLOCKED görevi kriz saymaz', () => {
    // Deadline 12:00'da idi (now'dan 2 saat önce), ama görev 3 saat önce
    // BLOCKED'a girdi ve o zamandan beri duraklatılmış durumda — efektif
    // deadline (deadline + duraklatma süresi) hâlâ gelecekte.
    const blockedTask = task({
      status: 'BLOCKED',
      deadline: now - 2 * 60 * 60 * 1000,
      pausedAt: now - 3 * 60 * 60 * 1000,
      totalPausedTime: 0,
    });

    expect(isTaskInCrisis(blockedTask, now)).toBe(false);
  });

  it('isTaskInCrisis, duraklatma süresi eklenince de efektif deadline geçmişse kriz sayar', () => {
    // Deadline 12:00'da idi (now'dan 5 saat önce). Görev 1 saat önce BLOCKED'a
    // girdi (yalnızca 1 saat duraklatıldı) — efektif deadline hâlâ geçmişte.
    const blockedTask = task({
      status: 'BLOCKED',
      deadline: now - 5 * 60 * 60 * 1000,
      pausedAt: now - 1 * 60 * 60 * 1000,
      totalPausedTime: 0,
    });

    expect(isTaskInCrisis(blockedTask, now)).toBe(true);
  });

  it('builds user performance load profiles', () => {
    const profiles = getUserPerformanceProfiles([
      task({ id: 'active-1' }),
      task({ id: 'active-2', status: 'BLOCKED' }),
      task({ id: 'done', status: 'COMPLETED', completedAt: now - 1000, deadline: now + 1000 }),
    ], [user], now);

    expect(profiles[0]?.activeCount).toBe(2);
    expect(profiles[0]?.completedCount).toBe(1);
    expect(profiles[0]?.blockedCount).toBe(1);
    expect(profiles[0]?.onTimeCompletionRate).toBe(100);
  });
});
