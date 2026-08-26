import type { Task } from '../../types';
import type { GlobalStats } from '../../store/dataStore';
import { isTaskInCrisis, type InterventionItem } from '../../lib/executiveMetrics';
import { isCompletedOnTime } from '../../lib/sla';

export type StatCategory = 'total' | 'waiting' | 'inProgress' | 'blocked' | 'inReview' | 'completed' | 'crisis';

export type QueueSignalKey = 'critical' | 'approval' | 'workload' | 'stalled';

export const SIGNAL_MATCHERS: Record<QueueSignalKey, (item: InterventionItem) => boolean> = {
  critical: item => item.level === 'critical',
  approval: item => item.lane === 'approval',
  workload: item => item.lane === 'workload',
  stalled:  item => item.lane === 'stalled',
};

export interface DashboardDeltas {
  inProgress: number;
  inReview: number;
  blocked: number;
  crisis: number;
}

export const computeDeltas = (scopeTasks: Task[], tick: number): DashboardDeltas => {
  // Takvim günü bazlı pencereler (rolling 24h yerine)
  const now = new Date(tick);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const yesterdayEnd = todayStart - 1;

  // Dashboard'da `tick` her 60 saniyede bir güncellenip bu fonksiyonu yeniden
  // tetiklediğinden (bkz. Dashboard.tsx), 8 ayrı filter geçişi yerine tek
  // geçişte tüm sayaçlar biriktirilir.
  let todayInProgress = 0, yesterdayInProgress = 0;
  let todayReview = 0, yesterdayReview = 0;
  let todayBlocked = 0, yesterdayBlocked = 0;
  let todayCrisis = 0, yesterdayCrisis = 0;

  for (const t of scopeTasks) {
    const isToday = t.updatedAt >= todayStart;
    const isYesterday = t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd;
    if (!isToday && !isYesterday) continue;

    if (t.status === 'IN_PROGRESS') {
      if (isToday) todayInProgress++;
      if (isYesterday) yesterdayInProgress++;
    }
    if (t.status === 'AWAITING_APPROVAL') {
      if (isToday) todayReview++;
      if (isYesterday) yesterdayReview++;
    }
    if (t.status === 'BLOCKED') {
      if (isToday) todayBlocked++;
      if (isYesterday) yesterdayBlocked++;
    }
    if (isTaskInCrisis(t, tick)) {
      if (isToday) todayCrisis++;
      if (isYesterday) yesterdayCrisis++;
    }
  }

  return {
    inProgress: todayInProgress - yesterdayInProgress,
    inReview:   todayReview - yesterdayReview,
    blocked:    todayBlocked - yesterdayBlocked,
    crisis:     todayCrisis - yesterdayCrisis,
  };
};

export interface DashboardStats {
  total: number;
  waiting: number;
  inProgress: number;
  blocked: number;
  inReview: number;
  completed: number;
  crisis: number;
}

export const computeStats = (
  scopeTasks: Task[],
  tick: number,
  globalStats: GlobalStats | null,
  isFiltered: boolean,
  isPersonalView: boolean
): DashboardStats => {
  const crisisCount = scopeTasks.filter(t => isTaskInCrisis(t, tick)).length;

  const isBlocked   = (t: Task) => t.status === 'BLOCKED';
  const isCompleted = (t: Task) => t.status === 'COMPLETED';
  const isWaiting   = (t: Task) => t.status === 'ASSIGNED' || t.status === 'PENDING_DELEGATION';
  const isInReview  = (t: Task) => t.status === 'AWAITING_APPROVAL';
  const isInProgress= (t: Task) => t.status === 'IN_PROGRESS';

  // globalStats, tüm organizasyona ait Firestore ön-hesap değeridir.
  // Odak filtresi aktifse (isFiltered) ya da pano kişisel kapsamdaysa,
  // scopeTasks[] zaten bir alt küme olduğundan globalStats kullanmak
  // yanıltıcı olur — her zaman lokal hesap yap.
  if (globalStats && !isFiltered && !isPersonalView) {
    // Firestore increment() sayaçları teorik olarak (eşzamanlılık/veri
    // tutarsızlığı durumunda) negatife düşebilir — panoda negatif sayı
    // göstermemek için sıfırda kırp.
    return {
      total:      Math.max(0, globalStats.totalTasks || scopeTasks.length),
      // "Bekleyen" hem ASSIGNED hem PENDING_DELEGATION'ı kapsar (aşağıdaki
      // yerel `isWaiting` ile AYNI tanım) — eskiden yalnızca ASSIGNED
      // sayılıyordu, izin/mazeret devri bekleyen görevler bu kartta
      // (Admin/Müdür'ün varsayılan, filtresiz pano görünümünde) sessizce
      // sayılmıyordu (bkz. kod denetimi).
      waiting:    Math.max(0, (globalStats.status_ASSIGNED || 0) + (globalStats.status_PENDING_DELEGATION || 0)),
      inProgress: Math.max(0, globalStats.status_IN_PROGRESS || 0),
      blocked:    Math.max(0, globalStats.status_BLOCKED || 0),
      inReview:   Math.max(0, globalStats.status_AWAITING_APPROVAL || 0),
      completed:  Math.max(0, globalStats.status_COMPLETED || 0),
      crisis:     crisisCount,
    };
  }

  return {
    total:      scopeTasks.length,
    waiting:    scopeTasks.filter(isWaiting).length,
    inProgress: scopeTasks.filter(isInProgress).length,
    blocked:    scopeTasks.filter(isBlocked).length,
    inReview:   scopeTasks.filter(isInReview).length,
    completed:  scopeTasks.filter(isCompleted).length,
    crisis:     crisisCount,
  };
};

export interface DashboardChartDay {
  name: string;
  'Yeni Talimat': number;
  'İcra Edilen': number;
}

// NOT: Bu seri bilinçli olarak değişmez (immutable) zaman damgalarına dayanır.
// Önceki sürüm görevleri updatedAt penceresine ve CANLI status'e göre kovalıyordu;
// bir görev sonradan güncellendiğinde geçmiş günün çubuğundan siliniyor, grafik
// retroaktif olarak değişiyordu. createdAt/completedAt asla değişmediği için
// "Yeni Talimat" ve "İcra Edilen" metrikleri geçmişe dönük tutarlıdır.
// Gün sınırı tick'ten türetilir ki gece yarısı geçişinde pencere bayatlamasın.
export const computeLast7DaysData = (scopeTasks: Task[], tick: number): DashboardChartDay[] => {
  const todayStart = new Date(tick);
  todayStart.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - (6 - i));
    const start = d.getTime();
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    const endMs = end.getTime();
    const completedAtOf = (t: Task) => t.completedAt ?? t.updatedAt;
    return {
      name: d.toLocaleDateString('tr-TR', { weekday: 'short' }),
      'Yeni Talimat': scopeTasks.filter(t => t.createdAt >= start && t.createdAt <= endMs).length,
      'İcra Edilen':  scopeTasks.filter(t => t.status === 'COMPLETED' && completedAtOf(t) >= start && completedAtOf(t) <= endMs).length,
    };
  });
};

export const filterStatTasks = (scopeTasks: Task[], category: StatCategory | null, tick: number): Task[] => {
  let list: Task[] = [];
  switch (category) {
    case 'total':      list = scopeTasks; break;
    case 'waiting':    list = scopeTasks.filter(t => t.status === 'ASSIGNED' || t.status === 'PENDING_DELEGATION'); break;
    case 'inProgress': list = scopeTasks.filter(t => t.status === 'IN_PROGRESS'); break;
    case 'blocked':    list = scopeTasks.filter(t => t.status === 'BLOCKED'); break;
    case 'inReview':   list = scopeTasks.filter(t => t.status === 'AWAITING_APPROVAL'); break;
    case 'crisis':     list = scopeTasks.filter(t => isTaskInCrisis(t, tick)); break;
    case 'completed':  list = scopeTasks.filter(t => t.status === 'COMPLETED'); break;
    default:           list = [];
  }

  const priorityWeights: Record<string, number> = { Urgent: 3, High: 2, Medium: 1, Low: 0 };
  return [...list].sort((a, b) => {
    const weightA = priorityWeights[a.priority] ?? 0;
    const weightB = priorityWeights[b.priority] ?? 0;
    if (weightB !== weightA) return weightB - weightA;
    return b.updatedAt - a.updatedAt;
  });
};

export const computeCompletionRatePercent = (scopeTasks: Task[]): number => {
  // Lağvedilen görevler paydaya girmez: ne icra edilmiş ne de icrası
  // beklenen iştir; skoru yapay olarak düşürmemeli.
  const considered = scopeTasks.filter(t => t.status !== 'CANCELLED');
  if (considered.length === 0) return 0;
  return Math.round((considered.filter(t => t.status === 'COMPLETED').length / considered.length) * 100);
};

// SLA standardize edilmiş formul: zamanında tamamlanan / toplam tamamlanan
// (lib/sla.ts'teki isCompletedOnTime üzerinden — tüm ekranlarda tutarlı tek tanım)
export const computeSlaCompliancePercent = (scopeTasks: Task[]): number => {
  const completed = scopeTasks.filter(t => t.status === 'COMPLETED');
  if (completed.length === 0) return 100;
  const onTime = completed.filter(isCompletedOnTime).length;
  return Math.round((onTime / completed.length) * 100);
};

export const computeHealthScore = (scopeTaskCount: number, completionRatePercent: number, slaCompliancePercent: number): number => {
  if (scopeTaskCount === 0) return 100;
  const completionRate = completionRatePercent / 100;
  const slaRate = slaCompliancePercent / 100;
  return Math.round(((completionRate * 0.6) + (slaRate * 0.4)) * 100);
};

export interface ExecutiveSignal {
  key: QueueSignalKey;
  label: string;
  value: number;
  tone: 'red' | 'amber' | 'green';
}

export const computeExecutiveSignals = (executiveQueue: InterventionItem[]): ExecutiveSignal[] => {
  const countBy = (key: QueueSignalKey) => executiveQueue.filter(SIGNAL_MATCHERS[key]).length;
  const criticalCount = countBy('critical');
  const approvalCount = countBy('approval');
  const workloadCount = countBy('workload');
  const stalledCount  = countBy('stalled');

  return [
    { key: 'critical', label: 'Acil Müdahale', value: criticalCount, tone: criticalCount > 0 ? 'red' : 'green' },
    { key: 'approval', label: 'Onay Kararı', value: approvalCount, tone: approvalCount > 0 ? 'amber' : 'green' },
    { key: 'workload', label: 'Yük Aşımı', value: workloadCount, tone: workloadCount > 0 ? 'red' : 'green' },
    { key: 'stalled', label: 'Atalet', value: stalledCount, tone: stalledCount > 0 ? 'amber' : 'green' },
  ];
};
