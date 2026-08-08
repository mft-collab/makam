import type { Task, User } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const PRIORITY_WEIGHT: Record<Task['priority'], number> = {
  Low: 6,
  Medium: 14,
  High: 24,
  Urgent: 34,
};

const STATUS_WEIGHT: Partial<Record<Task['status'], number>> = {
  ASSIGNED: 8,
  PENDING_DELEGATION: 14,
  IN_PROGRESS: 8,
  BLOCKED: 30,
  AWAITING_APPROVAL: 18,
  CRISIS: 36,
};

export interface TaskRiskProfile {
  task: Task;
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  reasons: string[];
}

export interface InterventionItem extends TaskRiskProfile {
  lane: 'crisis' | 'blocked' | 'approval' | 'stalled' | 'deadline' | 'workload';
  action: string;
}

export interface UserPerformanceProfile {
  user: User;
  activeCount: number;
  completedCount: number;
  overdueCount: number;
  blockedCount: number;
  reviewCount: number;
  onTimeCompletionRate: number;
  loadScore: number;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function isActive(task: Task) {
  return task.status !== 'COMPLETED' && task.status !== 'CANCELLED';
}

/**
 * Efektif kalan süre: orijinal deadline + toplam duraklatma süresi - referans an.
 * Duraklatılmış (BLOCKED/AWAITING_APPROVAL/PENDING_DELEGATION) bir görevde referans
 * an pausedAt'tır — "now" değil, aksi halde duraklatma süresi boyunca mühlet
 * hesapları yanlışlıkla ilerlemeye devam eder. TaskDetails.tsx'in canlı SLA
 * sayacıyla aynı formül — dashboard/kriz/risk hesapları burada tek noktadan türer.
 */
function effectiveMsToDeadline(task: Task, now: number): number {
  const effectiveDeadline = task.deadline + (task.totalPausedTime || 0);
  const referenceTime = task.pausedAt ?? now;
  return effectiveDeadline - referenceTime;
}

/**
 * Görev kriz (SLA ihlali) durumunda mı: hâlâ aktif (icra edilmemiş ve
 * lağvedilmemiş) olduğu hâlde efektif mühleti geçmiş görevler.
 * Dashboard'daki tüm "gecikme/kriz" sayımları için tek otoriter tanım.
 */
export function isTaskInCrisis(task: Task, now: number): boolean {
  return isActive(task) && effectiveMsToDeadline(task, now) < 0;
}

/**
 * `subtasksByParent` verilirse (getInterventionQueue gibi bir görev listesi
 * üzerinde döngü yapan çağıranlar için) alt görevler O(1) lookup ile alınır;
 * verilmezse (ör. doğrudan/tekil çağrılarda — bkz. executiveMetrics.test.ts)
 * eskisi gibi `allTasks` içinde filtrelenir. N görev için N kez çağrıldığında
 * (ör. getInterventionQueue'nun aktif görev döngüsü) map'i önceden bir kez
 * kurmak O(n²)'yi O(n)'e indirir.
 */
export function calculateTaskRisk(
  task: Task,
  allTasks: Task[],
  now = Date.now(),
  subtasksByParent?: Map<string, Task[]>
): TaskRiskProfile {
  if (!isActive(task)) {
    return { task, score: 0, level: 'low', reasons: ['Operasyon sonlanmış'] };
  }

  let score = PRIORITY_WEIGHT[task.priority] ?? 0;
  const reasons: string[] = [];
  const msToDeadline = effectiveMsToDeadline(task, now);
  const ageSinceUpdate = now - task.updatedAt;
  const subtasks = subtasksByParent ? (subtasksByParent.get(task.id) ?? []) : allTasks.filter(t => t.parentId === task.id);
  const overdueSubtasks = subtasks.filter(t => isActive(t) && t.deadline < now).length;
  const blockedSubtasks = subtasks.filter(t => t.status === 'BLOCKED').length;

  score += STATUS_WEIGHT[task.status] ?? 0;

  if (task.priority === 'Urgent') reasons.push('İvedi öncelik');
  if (task.priority === 'High') reasons.push('Yüksek öncelik');

  if (task.status === 'CRISIS') reasons.push('Kriz durumunda');
  if (task.status === 'BLOCKED') reasons.push('Aktif engel var');
  if (task.status === 'AWAITING_APPROVAL') reasons.push('Yönetici onayı bekliyor');

  if (msToDeadline < 0) {
    const daysLate = Math.max(1, Math.ceil(Math.abs(msToDeadline) / DAY_MS));
    score += Math.min(34, 18 + daysLate * 3);
    reasons.push(`${daysLate} gündür SLA dışında`);
  } else if (msToDeadline <= 4 * HOUR_MS) {
    score += 24;
    reasons.push('4 saat içinde mühlet doluyor');
  } else if (msToDeadline <= DAY_MS) {
    score += 16;
    reasons.push('24 saat içinde mühlet doluyor');
  } else if (msToDeadline <= 2 * DAY_MS) {
    score += 8;
    reasons.push('Yakın mühlet');
  }

  if (ageSinceUpdate > 2 * DAY_MS) {
    score += 16;
    reasons.push('48 saattir güncellenmedi');
  } else if (ageSinceUpdate > DAY_MS) {
    score += 9;
    reasons.push('24 saattir güncellenmedi');
  }

  if (overdueSubtasks > 0) {
    score += Math.min(18, overdueSubtasks * 6);
    reasons.push(`${overdueSubtasks} alt talimat gecikti`);
  }

  if (blockedSubtasks > 0) {
    score += Math.min(14, blockedSubtasks * 5);
    reasons.push(`${blockedSubtasks} alt talimat engelli`);
  }

  const normalizedScore = clampScore(score);
  const level = normalizedScore >= 80 ? 'critical' : normalizedScore >= 60 ? 'high' : normalizedScore >= 35 ? 'medium' : 'low';

  return {
    task,
    score: normalizedScore,
    level,
    reasons: reasons.length > 0 ? reasons.slice(0, 3) : ['Normal seyir'],
  };
}

export function getInterventionQueue(tasks: Task[], users: User[], now = Date.now(), limit = 8): InterventionItem[] {
  const activeLoadByUser = new Map<string, number>();
  tasks.filter(isActive).forEach(task => {
    activeLoadByUser.set(task.assigneeId, (activeLoadByUser.get(task.assigneeId) ?? 0) + 1);
  });

  const subtasksByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const list = subtasksByParent.get(t.parentId);
    if (list) list.push(t); else subtasksByParent.set(t.parentId, [t]);
  }

  const usersById = new Map<string, User>();
  for (const u of users) {
    usersById.set(u.uid, u);
    usersById.set(u.email, u);
  }

  return tasks
    .filter(isActive)
    .map(task => {
      const profile = calculateTaskRisk(task, tasks, now, subtasksByParent);
      const assignee = usersById.get(task.assigneeId);
      const load = activeLoadByUser.get(task.assigneeId) ?? 0;
      const msToDeadline = effectiveMsToDeadline(task, now);

      let lane: InterventionItem['lane'] = 'deadline';
      let action = 'Yakından takip et';

      if (task.status === 'CRISIS' || isTaskInCrisis(task, now)) {
        lane = 'crisis';
        action = 'Kriz müdahalesi başlat';
      } else if (task.status === 'BLOCKED') {
        lane = 'blocked';
        action = 'Engel çözümünü hızlandır';
      } else if (task.status === 'AWAITING_APPROVAL') {
        lane = 'approval';
        action = 'Onay veya revizyon kararı ver';
      } else if (now - task.updatedAt > DAY_MS) {
        lane = 'stalled';
        action = 'Sorumludan durum iste';
      } else if (load >= 6) {
        lane = 'workload';
        action = `${assignee?.fullName ?? 'Sorumlu'} yükünü dengele`;
      } else if (msToDeadline <= DAY_MS) {
        lane = 'deadline';
        action = 'Mühlet öncesi teyit al';
      }

      return { ...profile, lane, action };
    })
    .filter(item => item.score >= 35 || item.lane === 'approval')
    .sort((a, b) => b.score - a.score || b.task.updatedAt - a.task.updatedAt)
    .slice(0, limit);
}

export function getUserPerformanceProfiles(tasks: Task[], users: User[], now = Date.now()): UserPerformanceProfile[] {
  // Her kullanıcı için tasks'ı baştan filtrelemek yerine (O(kullanıcı × görev)
  // — Dashboard'da her 60 saniyede bir tick ile tekrarlanıyordu) tek geçişte
  // assigneeId'ye göre gruplanır.
  const tasksByAssignee = new Map<string, Task[]>();
  for (const t of tasks) {
    const list = tasksByAssignee.get(t.assigneeId);
    if (list) list.push(t); else tasksByAssignee.set(t.assigneeId, [t]);
  }

  return users.map(user => {
    const byUid = tasksByAssignee.get(user.uid) ?? [];
    const byEmail = user.email === user.uid ? [] : (tasksByAssignee.get(user.email) ?? []);
    const owned = byEmail.length > 0 ? [...byUid, ...byEmail] : byUid;
    const active = owned.filter(isActive);
    const completed = owned.filter(t => t.status === 'COMPLETED');
    const onTime = completed.filter(t => (t.completedAt ?? t.updatedAt) <= t.deadline).length;

    const activeCount = active.length;
    const overdueCount = active.filter(t => isTaskInCrisis(t, now) || t.status === 'CRISIS').length;
    const blockedCount = active.filter(t => t.status === 'BLOCKED').length;
    const reviewCount = active.filter(t => t.status === 'AWAITING_APPROVAL').length;
    const onTimeCompletionRate = completed.length === 0 ? 100 : Math.round((onTime / completed.length) * 100);
    const loadScore = clampScore(activeCount * 9 + overdueCount * 16 + blockedCount * 12 + reviewCount * 6);

    return {
      user,
      activeCount,
      completedCount: completed.length,
      overdueCount,
      blockedCount,
      reviewCount,
      onTimeCompletionRate,
      loadScore,
    };
  }).sort((a, b) => b.loadScore - a.loadScore || b.activeCount - a.activeCount);
}
