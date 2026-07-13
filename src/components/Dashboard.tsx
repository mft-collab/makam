import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckCircle2, Clock, AlertTriangle, AlertCircle, TrendingUp, Activity, Target, ArrowRight, ShieldCheck, ListChecks, Gauge, Users as UsersIcon, Info } from 'lucide-react';
import { Task, User } from '../types';
import { motion } from 'motion/react';
import { Modal } from './ui/Modal';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { cn, formatTimeAgo } from '../lib/utils';
import { STATUS_LABELS } from '../constants';
import { RollingNumber } from './ui/RollingNumber';
import { DashboardSkeleton } from './ui/Skeleton';
import { useDataStore } from '../store/dataStore';
import { getInterventionQueue, getUserPerformanceProfiles, isTaskInCrisis, type InterventionItem, type UserPerformanceProfile } from '../lib/executiveMetrics';

interface DashboardProps {
  tasks: Task[];
  users: User[];
  user: User | null;
  onViewTask?: (task: Task) => void;
  setActiveTab?: (tab: string) => void;
  /** Firestore verisi ilk yüklenene kadar skeleton gösterir */
  isLoading?: boolean;
  /** Odak filtresi aktif olduğunda globalStats bypass edilir */
  isFiltered?: boolean;
}

// ─── Compact Stat Card ────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number;
  max: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'orange' | 'red' | 'gray';
  onClick?: () => void;
  index?: number;
  delta?: number;
}

const StatCard = ({ label, value, max, icon: Icon, color, onClick, index = 0, delta = 0 }: StatCardProps) => {
  const accentColor = {
    blue:   { bg: 'bg-executive-blue/5',   text: 'text-executive-blue' },
    green:  { bg: 'bg-status-success/10',  text: 'text-status-success' },
    orange: { bg: 'bg-executive-gold/10',  text: 'text-executive-gold' },
    red:    { bg: 'bg-status-danger/10',   text: 'text-status-danger' },
    gray:   { bg: 'bg-surface-glass',      text: 'text-text-muted' },
  }[color];

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.06 }}
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group w-full text-left flex items-center gap-2.5 sm:gap-3 p-3 sm:p-3.5 min-h-[74px]',
        'bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl',
        'shadow-[0_1px_8px_rgba(22,21,19,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]',
        'transition-all duration-300 hover:bg-surface-elevated hover:border-surface-border',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        onClick && 'cursor-pointer'
      )}
    >
      {/* Icon */}
      <div className={cn(
        'w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center transition-all duration-300',
        accentColor.bg,
        'group-hover:scale-105'
      )}>
        <Icon className={cn('w-4 h-4 stroke-[1.5]', accentColor.text)} />
      </div>

      {/* Label + Value */}
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-[9px] font-semibold text-text-tertiary uppercase tracking-[0.16em] truncate">{label}</span>
        <div className="flex items-baseline gap-1 min-w-0">
          <RollingNumber value={value} className="text-[20px] sm:text-[22px] font-light text-executive-blue tracking-tight tabular-nums leading-none shrink-0" />
          {max > 0 && <span className="text-[10px] text-text-tertiary font-light truncate min-w-0">/ {max}</span>}
          {delta !== 0 && (
            <span className={cn(
              "text-[10px] font-bold px-1 py-0.5 rounded-md ml-1 flex items-center gap-0.5 shrink-0",
              delta > 0
                ? (color === 'red' || color === 'orange' ? "bg-status-danger/10 text-status-danger" : "bg-status-success/10 text-status-success")
                : (color === 'red' || color === 'orange' ? "bg-status-success/10 text-status-success" : "bg-status-danger/10 text-status-danger")
            )}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
};

const riskTone = {
  low: 'bg-surface-glass text-text-muted border-surface-border',
  medium: 'bg-status-warning/10 text-status-warning border-status-warning/20',
  high: 'bg-status-danger/10 text-status-danger border-status-danger/20',
  // Kritik risk: dolgu rengi solid kalır (görsel ağırlık korunur); metin,
  // her iki temada da zeminle yüksek kontrast veren surface-base tonudur.
  critical: 'bg-status-danger text-surface-base border-status-danger',
};

const laneLabel: Record<InterventionItem['lane'], string> = {
  crisis: 'Kriz',
  blocked: 'Engel',
  approval: 'Onay',
  stalled: 'Atalet',
  deadline: 'Mühlet',
  workload: 'Yük',
};

// ─── Müdahale kuyruğu sinyal filtreleri ───────────────────────────────────────
type QueueSignalKey = 'critical' | 'approval' | 'workload' | 'stalled';

const SIGNAL_MATCHERS: Record<QueueSignalKey, (item: InterventionItem) => boolean> = {
  critical: item => item.level === 'critical',
  approval: item => item.lane === 'approval',
  workload: item => item.lane === 'workload',
  stalled:  item => item.lane === 'stalled',
};

interface InterventionRowProps {
  item: InterventionItem;
  users: User[];
  onView?: () => void;
  index?: number;
}

const InterventionRow = ({ item, users, onView, index = 0 }: InterventionRowProps) => {
  const assignee = users.find(u => u.uid === item.task.assigneeId || u.email === item.task.assigneeId);

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.04 }}
      onClick={onView}
      className="group w-full text-left grid grid-cols-[auto_1fr_auto] gap-3 p-3 rounded-xl border border-surface-border bg-surface-elevated/70 hover:bg-makam-glass hover:border-executive-blue/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
    >
      <div className="flex flex-col items-center gap-1">
        <div className={cn('w-11 h-11 rounded-xl border flex items-center justify-center font-display text-[16px] tabular-nums', riskTone[item.level])}>
          {item.score}
        </div>
        <span className="text-[10px] text-text-tertiary uppercase tracking-[0.2em]">Risk</span>
      </div>

      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={item.level === 'critical' || item.level === 'high' ? 'danger' : item.level === 'medium' ? 'warning' : 'default'}>
            {laneLabel[item.lane]}
          </Badge>
          <span className="text-[12px] font-medium text-executive-blue line-clamp-1 font-display">{item.task.title}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={assignee?.fullName ?? '?'} photoURL={assignee?.photoURL} size="sm" />
          <span className="text-[9px] text-text-muted truncate">{assignee?.fullName ?? 'Sorumlu bulunamadı'}</span>
          <span className="text-[9px] text-text-tertiary truncate">· {item.reasons.join(' · ')}</span>
        </div>
        <span className="text-[9px] font-medium text-text-heading uppercase tracking-[0.18em]">{item.action}</span>
      </div>

      <div className="flex items-center justify-center">
        <ArrowRight className="w-4 h-4 text-text-tertiary group-hover:text-executive-blue group-hover:translate-x-0.5 transition-all" />
      </div>
    </motion.button>
  );
};

interface PerformanceRowProps {
  profile: UserPerformanceProfile;
  index?: number;
}

const PerformanceRow = ({ profile, index = 0 }: PerformanceRowProps) => {
  const loadTone = profile.loadScore >= 75
    ? 'text-status-danger bg-status-danger/10 border-status-danger/20'
    : profile.loadScore >= 45
      ? 'text-status-warning bg-status-warning/10 border-status-warning/20'
      : 'text-status-success bg-status-success/10 border-status-success/20';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.04 }}
      className="grid grid-cols-[auto_1fr_auto] gap-3 p-3 rounded-xl border border-surface-border bg-surface-elevated/70"
    >
      <Avatar name={profile.user.fullName} photoURL={profile.user.photoURL} size="md" />
      <div className="min-w-0 flex flex-col gap-1">
        <span className="text-[12px] font-medium text-executive-blue truncate font-display">{profile.user.fullName}</span>
        <div className="flex flex-wrap gap-2 text-[10px] text-text-tertiary uppercase tracking-[0.15em]">
          <span>{profile.activeCount} aktif</span>
          <span>{profile.completedCount} icra</span>
          <span>{profile.overdueCount} gecikmiş</span>
          <span>{profile.blockedCount} engelli</span>
          <span>SLA %{profile.onTimeCompletionRate}</span>
        </div>
      </div>
      <div className={cn('w-12 h-10 rounded-xl border flex flex-col items-center justify-center', loadTone)}>
        <span className="text-[13px] font-semibold tabular-nums leading-none">{profile.loadScore}</span>
        <span className="text-[10px] uppercase tracking-[0.16em]">Yük</span>
      </div>
    </motion.div>
  );
};


// ─── Custom Tooltip for Recharts (Frosted Glass) ──────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-makam-glass backdrop-blur-xl border border-surface-border p-3 rounded-2xl shadow-xl flex flex-col gap-1.5 min-w-[120px] text-left">
        <span className="text-[9px] font-bold text-text-tertiary uppercase tracking-wider">{label}</span>
        <div className="h-px bg-executive-blue/[0.05]" />
        <div className="flex flex-col gap-1 text-[11px] font-medium">
          {payload.map((entry: any) => (
            <div key={entry.name} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-text-muted">{entry.name}:</span>
              </div>
              <span className="font-bold text-text-heading">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};


// ─── Dashboard ────────────────────────────────────────────────────────────────
export const Dashboard = ({ tasks, users, user, onViewTask, setActiveTab, isLoading = false, isFiltered = false }: DashboardProps) => {
  const [selectedStatCategory, setSelectedStatCategory] = useState<
    'total' | 'waiting' | 'inProgress' | 'blocked' | 'inReview' | 'completed' | 'crisis' | null
  >(null);
  // Müdahale kuyruğu sinyal filtresi (chip'e tıklayınca aç/kapa)
  const [queueFilter, setQueueFilter] = useState<QueueSignalKey | null>(null);
  // Canlı SLA sayacı — her dakika güncellenir
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const globalStats = useDataStore(state => state.stats);

  // Staff için pano tamamen kişiseldir: tüm metrikler yalnızca kendi
  // görevlerinden (assigneeId eşleşmesi) türetilir.
  const isPersonalView = user?.role === 'Staff';
  const myTasks = useMemo(
    () => tasks.filter(t => t.assigneeId === user?.uid || t.assigneeId === user?.email),
    [tasks, user]
  );
  const scopeTasks = isPersonalView ? myTasks : tasks;

  const deltas = useMemo(() => {
    // Takvim günü bazlı pencereler (rolling 24h yerine)
    const now = new Date(tick);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const yesterdayEnd = todayStart - 1;

    const todayInProgress = scopeTasks.filter(t => t.status === 'IN_PROGRESS' && t.updatedAt >= todayStart).length;
    const yesterdayInProgress = scopeTasks.filter(t => t.status === 'IN_PROGRESS' && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const inProgressDelta = todayInProgress - yesterdayInProgress;

    const todayReview = scopeTasks.filter(t => t.status === 'AWAITING_APPROVAL' && t.updatedAt >= todayStart).length;
    const yesterdayReview = scopeTasks.filter(t => t.status === 'AWAITING_APPROVAL' && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const reviewDelta = todayReview - yesterdayReview;

    const todayBlocked = scopeTasks.filter(t => t.status === 'BLOCKED' && t.updatedAt >= todayStart).length;
    const yesterdayBlocked = scopeTasks.filter(t => t.status === 'BLOCKED' && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const blockedDelta = todayBlocked - yesterdayBlocked;

    const todayCrisis = scopeTasks.filter(t => isTaskInCrisis(t, tick) && t.updatedAt >= todayStart).length;
    const yesterdayCrisis = scopeTasks.filter(t => isTaskInCrisis(t, tick) && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const crisisDelta = todayCrisis - yesterdayCrisis;

    return {
      inProgress: inProgressDelta,
      inReview:   reviewDelta,
      blocked:    blockedDelta,
      crisis:     crisisDelta
    };
  }, [scopeTasks, tick]);

  const stats = useMemo(() => {
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
      return {
        total:      globalStats.totalTasks || scopeTasks.length,
        waiting:    globalStats.status_ASSIGNED || 0,
        inProgress: globalStats.status_IN_PROGRESS || 0,
        blocked:    globalStats.status_BLOCKED || 0,
        inReview:   globalStats.status_AWAITING_APPROVAL || 0,
        completed:  globalStats.status_COMPLETED || 0,
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
  }, [scopeTasks, globalStats, isFiltered, isPersonalView, tick]);

  const executiveQueue = useMemo(
    () => getInterventionQueue(scopeTasks, users, tick, 8),
    [scopeTasks, users, tick]
  );

  // Kişisel görünümde tam görev listesi verilir (fonksiyon sahiplik eşlemesini
  // kendi içinde assigneeId ile yapar; ön-filtre çifte filtreleme olurdu) ve
  // yalnızca kullanıcının kendi profili gösterilir.
  const performanceProfiles = useMemo(() => {
    const profiles = getUserPerformanceProfiles(tasks, users, tick);
    if (isPersonalView) return profiles.filter(p => p.user.uid === user?.uid);
    return profiles.filter(p => p.activeCount > 0 || p.completedCount > 0).slice(0, 6);
  }, [tasks, users, tick, isPersonalView, user]);

  const executiveSignals = useMemo(() => {
    const countBy = (key: QueueSignalKey) => executiveQueue.filter(SIGNAL_MATCHERS[key]).length;
    const criticalCount = countBy('critical');
    const approvalCount = countBy('approval');
    const workloadCount = countBy('workload');
    const stalledCount  = countBy('stalled');

    return [
      { key: 'critical' as const, label: 'Acil Müdahale', value: criticalCount, tone: criticalCount > 0 ? 'red' : 'green' },
      { key: 'approval' as const, label: 'Onay Kararı', value: approvalCount, tone: approvalCount > 0 ? 'amber' : 'green' },
      { key: 'workload' as const, label: 'Yük Aşımı', value: workloadCount, tone: workloadCount > 0 ? 'red' : 'green' },
      { key: 'stalled' as const, label: 'Atalet', value: stalledCount, tone: stalledCount > 0 ? 'amber' : 'green' },
    ];
  }, [executiveQueue]);

  // Sinyal filtresi aktifken kuyruğun tamamı (en çok 8 kayıt), değilken ilk 5 kayıt
  const visibleQueue = useMemo(() => {
    if (!queueFilter) return executiveQueue.slice(0, 5);
    return executiveQueue.filter(SIGNAL_MATCHERS[queueFilter]).slice(0, 8);
  }, [executiveQueue, queueFilter]);

  // NOT: Bu seri bilinçli olarak değişmez (immutable) zaman damgalarına dayanır.
  // Önceki sürüm görevleri updatedAt penceresine ve CANLI status'e göre kovalıyordu;
  // bir görev sonradan güncellendiğinde geçmiş günün çubuğundan siliniyor, grafik
  // retroaktif olarak değişiyordu. createdAt/completedAt asla değişmediği için
  // "Yeni Talimat" ve "İcra Edilen" metrikleri geçmişe dönük tutarlıdır.
  // Gün sınırı tick'ten türetilir ki gece yarısı geçişinde pencere bayatlamasın.
  const last7DaysData = useMemo(() => {
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
  }, [scopeTasks, tick]);

  const chartSummary = useMemo(
    () => last7DaysData
      .map(d => `${d.name}: ${d['Yeni Talimat']} yeni talimat, ${d['İcra Edilen']} icra edildi`)
      .join('; '),
    [last7DaysData]
  );

  const filteredStatTasks = useMemo(() => {
    let list: Task[] = [];
    switch (selectedStatCategory) {
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
  }, [scopeTasks, selectedStatCategory, tick]);

  const completionRatePercent = useMemo(() => {
    // Lağvedilen görevler paydaya girmez: ne icra edilmiş ne de icrası
    // beklenen iştir; skoru yapay olarak düşürmemeli.
    const considered = scopeTasks.filter(t => t.status !== 'CANCELLED');
    if (considered.length === 0) return 0;
    return Math.round((considered.filter(t => t.status === 'COMPLETED').length / considered.length) * 100);
  }, [scopeTasks]);

  // SLA standardize edilmiş formul: zamanında tamamlanan / toplam tamamlanan
  // (tüm ekranlarda tutarlı tek tanım)
  const slaCompliancePercent = useMemo(() => {
    const completed = scopeTasks.filter(t => t.status === 'COMPLETED');
    if (completed.length === 0) return 100;
    const onTime = completed.filter(t => (t.completedAt || t.updatedAt) <= t.deadline).length;
    return Math.round((onTime / completed.length) * 100);
  }, [scopeTasks]);

  const healthScore = useMemo(() => {
    const total = scopeTasks.length;
    if (total === 0) return 100;
    const completionRate = completionRatePercent / 100;
    const slaRate = slaCompliancePercent / 100;
    return Math.round(((completionRate * 0.6) + (slaRate * 0.4)) * 100);
  }, [scopeTasks, completionRatePercent, slaCompliancePercent]);

  const statModalTitle: Record<string, string> = {
    total: 'Toplam Talimatlar', waiting: 'Bekleyen Talimatlar', inProgress: 'İcra Aşamasındakiler',
    blocked: 'Engellenen Talimatlar', inReview: 'Onay Sürecindekiler',
    crisis: 'SLA İhlali (Kriz)', completed: 'İcra Edilenler',
  };

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Stratejik Sağlık Endeksi Banner ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 28 }}
        className="relative overflow-hidden p-5 rounded-3xl bg-makam-glass backdrop-blur-xl border border-surface-border shadow-md flex flex-col md:flex-row items-center justify-between gap-6"
      >
        {/* Ambient backglow matching health score state */}
        <div className={cn(
          "absolute -inset-10 opacity-30 blur-3xl pointer-events-none transition-all duration-1000",
          healthScore >= 80 ? "bg-status-success/[0.035]" :
          healthScore >= 50 ? "bg-status-warning/[0.04]" :
          "bg-status-danger/[0.04]"
        )} />

        <div className="relative z-10 flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner flex-shrink-0",
            healthScore >= 80 ? "bg-status-success/10 text-status-success border-status-success/20" :
            healthScore >= 50 ? "bg-status-warning/10 text-status-warning border-status-warning/20" :
            "bg-status-danger/10 text-status-danger border-status-danger/20"
          )}>
            <Target className="w-6 h-6 stroke-[1.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13px] font-medium text-executive-blue tracking-tight font-display">Stratejik Sağlık Endeksi</h3>
              {/* Veri tazeliği göstergesi — tick state'inden türetilir, ek okuma yok */}
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-status-success/25 bg-status-success/10 text-status-success text-[10px] font-semibold uppercase tracking-[0.14em] tabular-nums"
                title="Veriler canlı olarak izlenir; sayaçlar her dakika tazelenir."
              >
                <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" aria-hidden="true" />
                Canlı · {new Date(tick).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">
              {isPersonalView ? 'Kişisel Performans & İcra Düzeyi' : 'Organizasyonel Performans & İcra Düzeyi'}
            </p>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-8 justify-between w-full md:w-auto">
          <div className="flex flex-col items-start md:items-end gap-1">
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.2em] font-medium">Sistem Durumu</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "w-2 h-2 rounded-full",
                healthScore >= 80 ? "bg-status-success shadow-[0_0_8px_var(--color-status-success)]" :
                healthScore >= 50 ? "bg-status-warning shadow-[0_0_8px_var(--color-status-warning)]" :
                "bg-status-danger shadow-[0_0_8px_var(--color-status-danger)]"
              )} />
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-widest",
                // NOT: Semantik status token'ları kullanılır — light modda AA-uyumlu
                // koyu tonlar (#047857/#B45309/#DC2626), dark modda pastel tonlar.
                // (Eski emerald/amber-700 + dark: çifti aynı değerlere denk geliyordu.)
                healthScore >= 80 ? "text-status-success" :
                healthScore >= 50 ? "text-status-warning" :
                "text-status-danger"
              )}>
                {healthScore >= 80 ? "STABİL / GÜVENLİ" :
                 healthScore >= 50 ? "GÖZETİM ALTINDA" :
                 "ACİL PROTOKOL"}
               </span>
            </div>
            {/* Sub-metrics transparency indicators */}
            <div className="flex gap-2.5 text-[10px] text-text-tertiary font-bold uppercase mt-1">
              <span>İcra: %{completionRatePercent}</span>
              <span>SLA: %{slaCompliancePercent}</span>
            </div>
          </div>

          <div className="h-10 w-[1px] bg-executive-blue/10 hidden md:block" />

          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <span className="text-[24px] font-light text-executive-blue tracking-tight tabular-nums leading-none">
                {healthScore}%
              </span>
              <span
                className="flex items-center gap-1 text-[10px] text-text-tertiary uppercase tracking-[0.25em] mt-1 cursor-help"
                title="Hesap yöntemi: İcra Oranı (%60 ağırlık) + SLA Uyumu (%40 ağırlık). Lağvedilen görevler hesaba katılmaz."
                aria-label="Sağlık skoru hesap yöntemi: İcra oranının yüzde 60'ı ile SLA uyumunun yüzde 40'ının toplamıdır. Lağvedilen görevler hesaba katılmaz."
              >
                SAĞLIK SKORU
                <Info className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Stat Cards Grid ─────────────────────────────────────────── */}
      {/* Mobile: 2 cols | Tablet: 3 cols | Desktop: 6 cols */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Bekleyen"   value={stats.waiting}    max={stats.total} icon={Clock}        color="gray"   index={0} onClick={() => setSelectedStatCategory('waiting')} />
        <StatCard label="İşlemde"    value={stats.inProgress} max={stats.total} icon={Activity}     color="blue"   index={1} delta={deltas.inProgress} onClick={() => setSelectedStatCategory('inProgress')} />
        <StatCard label="Denetimde"  value={stats.inReview}   max={stats.total} icon={CheckCircle2} color="green"  index={2} delta={deltas.inReview} onClick={() => setSelectedStatCategory('inReview')} />
        <StatCard label="Engel"      value={stats.blocked}    max={stats.total} icon={ShieldCheck}  color="orange" index={3} delta={deltas.blocked} onClick={() => setSelectedStatCategory('blocked')} />
        <StatCard label="Gecikme"    value={stats.crisis}     max={stats.total} icon={AlertCircle}  color="red"    index={4} delta={deltas.crisis} onClick={() => setSelectedStatCategory('crisis')} />
        <StatCard label="Tamamlanan" value={stats.completed}  max={stats.total} icon={ListChecks}   color="green"  index={5} onClick={() => setSelectedStatCategory('completed')} />
      </div>

      {/* ── Executive Decision Surface ───────────────────────────────── */} 
      <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_0.95fr] gap-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.18 }}
          className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-[13px] font-medium text-executive-blue tracking-tight font-display">{isPersonalView ? 'Önceliklerim' : 'Yönetici Müdahale Kuyruğu'}</h3>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.16em] mt-0.5">
                {queueFilter
                  ? <>Filtre: {executiveSignals.find(s => s.key === queueFilter)?.label} · <button type="button" onClick={() => setQueueFilter(null)} className="underline hover:text-executive-blue">Temizle</button></>
                  : isPersonalView ? 'Size ait risk ve mühlet önceliği' : 'Risk, mühlet, atalet ve onay önceliği'}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 w-full md:w-auto">
              {executiveSignals.map(signal => (
                <button
                  key={signal.key}
                  type="button"
                  onClick={() => setQueueFilter(prev => prev === signal.key ? null : signal.key)}
                  aria-pressed={queueFilter === signal.key}
                  className={cn(
                    'min-w-0 rounded-xl border px-2 py-1.5 text-center transition-all duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                    // NOT: Tailwind'in varsayılan red/amber/emerald paleti (oklch
                    // tabanlı) axe-core taramasında bu bileşende beklenmedik
                    // şekilde neredeyse görünmez metin olarak ölçüldü. Solid hex
                    // semantik status token'larına geçirildi (bkz. index.css).
                    signal.tone === 'red' ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
                    signal.tone === 'amber' ? 'bg-status-warning/10 text-status-warning border-status-warning/20' :
                    'bg-status-success/10 text-status-success border-status-success/20',
                    queueFilter === signal.key && 'ring-2 ring-offset-2 ring-offset-surface-base ring-executive-blue/40 scale-[0.97]'
                  )}
                >
                  <div className="text-[14px] font-semibold tabular-nums leading-none">{signal.value}</div>
                  <div className="text-[7px] uppercase tracking-[0.12em] mt-1 truncate">{signal.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {visibleQueue.length > 0 ? (
              visibleQueue.map((item, index) => (
                <InterventionRow
                  key={item.task.id}
                  item={item}
                  users={users}
                  index={index}
                  onView={() => onViewTask?.(item.task)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-2 rounded-xl border border-dashed border-executive-blue/[0.05] bg-[#F5F3EF]/50">
                <ShieldCheck className="w-7 h-7 text-status-success stroke-[1.2]" />
                <span className="text-[9px] text-text-tertiary uppercase tracking-[0.16em]">
                  {queueFilter ? 'Bu filtrede müdahale yok' : 'Müdahale Gerektiren Başlık Yok'}
                </span>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.24 }}
          className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-[13px] font-medium text-executive-blue tracking-tight font-display">{isPersonalView ? 'Performans Özetim' : 'Kadro Yük Matrisi'}</h3>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.16em] mt-0.5">{isPersonalView ? 'Kendi yükünüz ve SLA disiplininiz' : 'Aktif yük ve SLA disiplini'}</p>
            </div>
            <UsersIcon className="w-4 h-4 text-text-tertiary" />
          </div>

          <div className="flex flex-col gap-2">
            {performanceProfiles.length > 0 ? (
              performanceProfiles.slice(0, 5).map((profile, index) => (
                <PerformanceRow key={profile.user.uid} profile={profile} index={index} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-2 rounded-xl border border-dashed border-executive-blue/[0.05] bg-[#F5F3EF]/50">
                <Gauge className="w-7 h-7 text-text-muted/40 stroke-[1.2]" />
                <span className="text-[9px] text-text-tertiary uppercase tracking-[0.16em]">Yük Verisi Yok</span>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Chart ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.25 }}
        className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
      >
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className="text-[13px] font-medium text-executive-blue tracking-tight font-display">Performans Analitiği</h3>
            <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">Son 7 Gün</p>
          </div>
          {user?.role === 'Admin' && (
            <button
              onClick={() => setActiveTab?.('reports')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-executive-blue/[0.03] border border-executive-blue/[0.06] text-text-muted hover:bg-executive-blue hover:text-white transition-all duration-300 text-[9px] font-medium uppercase tracking-[0.2em]"
            >
              <TrendingUp className="w-3 h-3" />
              Analiz
            </button>
          )}
        </div>
        {/* Chart: reduced height on mobile */}
        <div className="h-[160px] sm:h-[200px] lg:h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
            <BarChart data={last7DaysData} barGap={4} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="chartCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-executive-blue)" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="var(--color-executive-blue)" stopOpacity="0.35" />
                </linearGradient>
                <linearGradient id="chartCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#82C29C" />
                  <stop offset="100%" stopColor="#1B7A51" />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="name"
                stroke="transparent"
                fontSize={9}
                tickLine={false}
                axisLine={false}
                tick={{ dy: 8, fill: '#94A3B8', fontWeight: 400 }}
              />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(22, 21, 19, 0.01)' }} />
              <Bar dataKey="Yeni Talimat" fill="url(#chartCreated)" radius={[4,4,0,0]} />
              <Bar dataKey="İcra Edilen" fill="url(#chartCompleted)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-executive-blue/[0.04]">
          {[
            { color: 'var(--color-executive-blue)', label: 'Yeni Talimat' },
            { color: '#1B7A51', label: 'İcra Edilen' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[8px] text-text-tertiary uppercase tracking-[0.2em]">{label}</span>
            </div>
          ))}
        </div>

        {/* Ekran okuyucular için grafiğin metinsel özeti — recharts SVG'si erişilebilir değildir */}
        <p className="sr-only">{chartSummary}</p>
      </motion.div>

      {/* ── Stat Detail Modal ────────────────────────────────────────── */}
      <Modal
        isOpen={!!selectedStatCategory}
        onClose={() => setSelectedStatCategory(null)}
        title={selectedStatCategory ? statModalTitle[selectedStatCategory] ?? '' : ''}
        size="lg"
      >
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {filteredStatTasks.length > 0 ? (
            filteredStatTasks.map(task => (
              <div
                key={task.id}
                className="flex items-center gap-3 p-3 bg-surface-elevated border border-surface-border rounded-xl group cursor-pointer hover:bg-makam-glass hover:border-executive-blue/10 transition-all duration-300 shadow-sm"
                onClick={() => { setSelectedStatCategory(null); onViewTask?.(task); }}
              >
                <div className={cn(
                  'w-8 h-8 rounded-xl flex items-center justify-center border flex-shrink-0',
                  task.status === 'COMPLETED' ? 'bg-status-success/10 text-status-success border-status-success/20' :
                  task.status === 'BLOCKED'   ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
                  task.status === 'IN_PROGRESS'? 'bg-executive-blue/5 text-executive-blue border-executive-blue/10' :
                  'bg-surface-border/20 text-text-muted border-surface-border'
                )}>
                  {task.status === 'COMPLETED' ? <CheckCircle2 className="w-4 h-4 stroke-[1.3]" /> :
                   task.status === 'BLOCKED'   ? <AlertTriangle className="w-4 h-4 stroke-[1.3]" /> :
                   <Activity className="w-4 h-4 stroke-[1.3]" />}
                </div>
                <div className="flex flex-col flex-1 gap-1.5 min-w-0 items-start">
                  <span className="text-[13px] font-medium text-executive-blue tracking-tight line-clamp-1 font-display">{task.title}</span>
                  <Badge variant={
                    task.status === 'COMPLETED' ? 'success' :
                    task.status === 'BLOCKED' ? 'danger' :
                    task.status === 'IN_PROGRESS' ? 'info' :
                    task.status === 'AWAITING_APPROVAL' ? 'warning' :
                    'default'
                  }>
                    {STATUS_LABELS[task.status] || task.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[9px] text-text-tertiary uppercase tracking-[0.2em] hidden sm:block">
                    {formatTimeAgo(task.updatedAt, task.status)}
                  </span>
                  <div className="w-7 h-7 rounded-full bg-surface-border/20 flex items-center justify-center group-hover:bg-executive-blue group-hover:text-white transition-all duration-300 opacity-0 group-hover:opacity-100">
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
              <CheckCircle2 className="w-10 h-10 text-text-muted/50 stroke-[1]" />
              <span className="text-[11px] text-text-tertiary uppercase tracking-[0.4em]">Veri Bulunamadı</span>
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
};
