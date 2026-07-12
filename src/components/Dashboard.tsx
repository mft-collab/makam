import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckCircle2, Clock, AlertTriangle, AlertCircle, TrendingUp, Activity, Target, ArrowRight, ShieldCheck, ListChecks, Gauge, Users as UsersIcon } from 'lucide-react';
import { Task, User } from '../types';
import { motion } from 'motion/react';
import { Modal } from './ui/Modal';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { cn, formatTimeAgo } from '../lib/utils';
import { STATUS_LABELS, IDLE_THRESHOLD_MS } from '../constants';
import { RollingNumber } from './ui/RollingNumber';
import { DashboardSkeleton } from './ui/Skeleton';
import { useDataStore } from '../store/dataStore';
import { getInterventionQueue, getUserPerformanceProfiles, type InterventionItem, type UserPerformanceProfile } from '../lib/executiveMetrics';

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
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0;
  const circumference = 2 * Math.PI * 14; // r=14
  const strokeDashoffset = circumference * (1 - percentage / 100);

  const accentColor = {
    blue:   { stroke: '#161513', bg: 'bg-executive-blue/5', text: 'text-executive-blue' },
    green:  { stroke: '#10B981', bg: 'bg-emerald-50',  text: 'text-emerald-600' },
    orange: { stroke: '#C5A059', bg: 'bg-[#C5A059]/10', text: 'text-[#C5A059]' },
    red:    { stroke: '#EF4444', bg: 'bg-red-50',      text: 'text-red-600' },
    gray:   { stroke: '#64748B', bg: 'bg-slate-50',    text: 'text-text-muted' },
  }[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.06 }}
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 sm:gap-3 p-3 sm:p-3.5 min-h-[74px]',
        'bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl',
        'shadow-[0_1px_8px_rgba(22,21,19,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]',
        'transition-all duration-300 hover:bg-surface-elevated hover:border-surface-border',
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
              "text-[8px] font-bold px-1 py-0.2 rounded-md ml-1 flex items-center gap-0.5 shrink-0",
              delta > 0
                ? (color === 'red' || color === 'orange' ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600")
                : (color === 'red' || color === 'orange' ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600")
            )}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>

      {/* Mini radial progress */}
      <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="14" fill="none" stroke="#F1F5F9" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="14" fill="none"
            stroke={accentColor.stroke}
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[8px] font-medium text-executive-blue">{percentage}%</span>
        </div>
      </div>
    </motion.div>
  );
};

// ─── Mini Task Row (for critical / review panels) ─────────────────────────────
interface MiniTaskRowProps {
  task: Task;
  type: 'blocked' | 'review';
  onView?: () => void;
  users?: User[];
  now?: number; // canlı sayaç için dışarıdan geçirilir
}

const MiniTaskRow = ({ task, type, onView, users, now = Date.now() }: MiniTaskRowProps) => {
  const isBlocked = type === 'blocked';
  const assignee = users?.find(u => u.uid === task.assigneeId || u.email === task.assigneeId);

  // SLA badge
  const msLeft = task.deadline - now;
  const hoursLeft = Math.floor(Math.abs(msLeft) / (1000 * 60 * 60));
  const daysLeft  = Math.floor(hoursLeft / 24);
  const isOverdue = msLeft < 0;
  const slaLabel  = isOverdue
    ? `${daysLeft > 0 ? `${daysLeft}g ` : ''}${hoursLeft % 24}s geçti`
    : daysLeft > 0
      ? `${daysLeft}g ${hoursLeft % 24}s kaldı`
      : `${hoursLeft}s kaldı`;

  const slaBadgeVariant = () => {
    if (isOverdue) return 'danger';
    if (hoursLeft < 24) return 'warning';
    return 'success';
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      onClick={onView}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border cursor-pointer group transition-all duration-300',
        'hover:bg-makam-glass hover:shadow-sm',
        isBlocked
          ? 'bg-red-50/30 border-red-100/50 hover:border-red-200/60'
          : 'bg-blue-50/20 border-blue-100/40 hover:border-blue-200/60'
      )}
    >
      {/* Sorumlu avatarı */}
      <Avatar
        name={assignee?.fullName ?? '?'}
        photoURL={assignee?.photoURL}
        size="sm"
        className="flex-shrink-0"
      />
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <span className="text-[12px] font-medium text-executive-blue line-clamp-1 tracking-tight font-display">
          {task.title}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant={isBlocked ? 'danger' : 'info'} withPulse={isBlocked}>
            {isBlocked ? 'Blokaj' : 'Denetim'}
          </Badge>
          <span className="text-[9px] text-text-tertiary">{formatTimeAgo(task.updatedAt, task.status)}</span>
        </div>
      </div>
      {/* SLA sayaç rozeti */}
      {task.deadline > 0 && (
        <Badge
          variant={slaBadgeVariant()}
          withPulse={isOverdue || hoursLeft < 24}
          icon={<Clock className="w-2.5 h-2.5 flex-shrink-0" />}
          className="whitespace-nowrap flex-shrink-0"
        >
          {slaLabel}
        </Badge>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onView?.(); }}
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center border flex-shrink-0',
          'bg-makam-glass border-surface-border text-text-tertiary shadow-sm',
          'group-hover:bg-executive-blue group-hover:text-white group-hover:border-transparent',
          'transition-all duration-300'
        )}
      >
        <ArrowRight className="w-3 h-3 stroke-[2]" />
      </button>
    </motion.div>
  );
};

const riskTone = {
  low: 'bg-slate-50 text-slate-500 border-slate-100',
  medium: 'bg-amber-50 text-amber-700 border-amber-100',
  high: 'bg-red-50 text-red-600 border-red-100',
  critical: 'bg-red-600 text-white border-red-600',
};

const laneLabel: Record<InterventionItem['lane'], string> = {
  crisis: 'Kriz',
  blocked: 'Engel',
  approval: 'Onay',
  stalled: 'Atalet',
  deadline: 'Mühlet',
  workload: 'Yük',
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
      className="group w-full text-left grid grid-cols-[auto_1fr_auto] gap-3 p-3 rounded-xl border border-surface-border bg-surface-elevated/70 hover:bg-makam-glass hover:border-executive-blue/10 transition-all"
    >
      <div className="flex flex-col items-center gap-1">
        <div className={cn('w-11 h-11 rounded-xl border flex items-center justify-center font-display text-[16px] tabular-nums', riskTone[item.level])}>
          {item.score}
        </div>
        <span className="text-[7px] text-text-tertiary uppercase tracking-[0.2em]">Risk</span>
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
    ? 'text-red-600 bg-red-50 border-red-100'
    : profile.loadScore >= 45
      ? 'text-amber-700 bg-amber-50 border-amber-100'
      : 'text-emerald-700 bg-emerald-50 border-emerald-100';

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
        <div className="flex flex-wrap gap-2 text-[8px] text-text-tertiary uppercase tracking-[0.15em]">
          <span>{profile.activeCount} aktif</span>
          <span>{profile.completedCount} tamam</span>
          <span>{profile.overdueCount} gecikme</span>
          <span>{profile.blockedCount} engel</span>
          <span>SLA %{profile.onTimeCompletionRate}</span>
        </div>
      </div>
      <div className={cn('w-12 h-10 rounded-xl border flex flex-col items-center justify-center', loadTone)}>
        <span className="text-[13px] font-semibold tabular-nums leading-none">{profile.loadScore}</span>
        <span className="text-[7px] uppercase tracking-[0.16em]">Yük</span>
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
  // Canlı SLA sayacı — her dakika güncellenir
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const globalStats = useDataStore(state => state.stats);

  const deltas = useMemo(() => {
    // Takvim günü bazlı pencereler (rolling 24h yerine)
    const now = new Date(tick);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const yesterdayEnd = todayStart - 1;

    const todayInProgress = tasks.filter(t => t.status === 'IN_PROGRESS' && t.updatedAt >= todayStart).length;
    const yesterdayInProgress = tasks.filter(t => t.status === 'IN_PROGRESS' && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const inProgressDelta = todayInProgress - yesterdayInProgress;

    const todayReview = tasks.filter(t => t.status === 'AWAITING_APPROVAL' && t.updatedAt >= todayStart).length;
    const yesterdayReview = tasks.filter(t => t.status === 'AWAITING_APPROVAL' && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const reviewDelta = todayReview - yesterdayReview;

    const todayBlocked = tasks.filter(t => t.status === 'BLOCKED' && t.updatedAt >= todayStart).length;
    const yesterdayBlocked = tasks.filter(t => t.status === 'BLOCKED' && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const blockedDelta = todayBlocked - yesterdayBlocked;

    const todayCrisis = tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && tick > t.deadline && t.updatedAt >= todayStart).length;
    const yesterdayCrisis = tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && tick > t.deadline && t.updatedAt >= yesterdayStart && t.updatedAt <= yesterdayEnd).length;
    const crisisDelta = todayCrisis - yesterdayCrisis;

    return {
      inProgress: inProgressDelta,
      inReview:   reviewDelta,
      blocked:    blockedDelta,
      crisis:     crisisDelta
    };
  }, [tasks, tick]);

  const stats = useMemo(() => {
    const isCrisis   = (t: Task) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && tick > t.deadline;
    const crisisCount = tasks.filter(isCrisis).length;

    const isBlocked   = (t: Task) => t.status === 'BLOCKED';
    const isCompleted = (t: Task) => t.status === 'COMPLETED';
    const isWaiting   = (t: Task) => t.status === 'ASSIGNED' || t.status === 'PENDING_DELEGATION';
    const isInReview  = (t: Task) => t.status === 'AWAITING_APPROVAL';
    const isInProgress= (t: Task) => t.status === 'IN_PROGRESS';

    // globalStats, tüm organizasyona ait Firestore ön-hesap değeridir.
    // Odak filtresi aktifse (isFiltered), tasks[] zaten bir alt küme olduğundan
    // globalStats kullanmak yanıltıcı olur — her zaman lokal hesap yap.
    if (globalStats && !isFiltered) {
      return {
        total:      globalStats.totalTasks || tasks.length,
        waiting:    globalStats.status_ASSIGNED || 0,
        inProgress: globalStats.status_IN_PROGRESS || 0,
        blocked:    globalStats.status_BLOCKED || 0,
        inReview:   globalStats.status_AWAITING_APPROVAL || 0,
        completed:  globalStats.status_COMPLETED || 0,
        crisis:     crisisCount,
      };
    }

    return {
      total:      tasks.length,
      waiting:    tasks.filter(isWaiting).length,
      inProgress: tasks.filter(isInProgress).length,
      blocked:    tasks.filter(isBlocked).length,
      inReview:   tasks.filter(isInReview).length,
      completed:  tasks.filter(isCompleted).length,
      crisis:     crisisCount,
    };
  }, [tasks, globalStats, isFiltered, tick]);

  const executiveQueue = useMemo(
    () => getInterventionQueue(tasks, users, tick, 8),
    [tasks, users, tick]
  );

  const performanceProfiles = useMemo(
    () => getUserPerformanceProfiles(tasks, users, tick).filter(p => p.activeCount > 0 || p.completedCount > 0).slice(0, 6),
    [tasks, users, tick]
  );

  const executiveSignals = useMemo(() => {
    const approvalCount = executiveQueue.filter(item => item.lane === 'approval').length;
    const criticalCount = executiveQueue.filter(item => item.level === 'critical').length;
    const overloadedCount = performanceProfiles.filter(profile => profile.loadScore >= 75).length;
    const stalledCount = executiveQueue.filter(item => item.lane === 'stalled').length;

    return [
      { label: 'Acil Müdahale', value: criticalCount, tone: criticalCount > 0 ? 'red' : 'green' },
      { label: 'Onay Kararı', value: approvalCount, tone: approvalCount > 0 ? 'amber' : 'green' },
      { label: 'Yük Aşımı', value: overloadedCount, tone: overloadedCount > 0 ? 'red' : 'green' },
      { label: 'Atalet', value: stalledCount, tone: stalledCount > 0 ? 'amber' : 'green' },
    ];
  }, [executiveQueue, performanceProfiles]);

  const last7DaysData = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    const day = tasks.filter(t => t.updatedAt >= d.getTime() && t.updatedAt <= end.getTime());
    return {
      name: d.toLocaleDateString('tr-TR', { weekday: 'short' }),
      'Bekleyen':   day.filter(t => t.status === 'ASSIGNED' || t.status === 'PENDING_DELEGATION').length,
      'İşlemde':    day.filter(t => t.status === 'IN_PROGRESS').length,
      'Engellenen': day.filter(t => t.status === 'BLOCKED').length,
      'Denetimde':  day.filter(t => t.status === 'AWAITING_APPROVAL').length,
      'Tamamlandı': day.filter(t => t.status === 'COMPLETED').length,
    };
  }), [tasks]);

  const criticalTasks = useMemo(() => tasks.filter(t =>
    t.status === 'BLOCKED' ||
    (t.status !== 'COMPLETED' && t.status !== 'CANCELLED' &&
     (tick - t.updatedAt) > IDLE_THRESHOLD_MS &&
     (t.priority === 'High' || t.priority === 'Urgent'))
  ), [tasks, tick]);

  const reviewTasks = useMemo(() => tasks.filter(t => t.status === 'AWAITING_APPROVAL'), [tasks]);

  const getFilteredTasksForStat = () => {
    let list: Task[] = [];
    switch (selectedStatCategory) {
      case 'total':      list = tasks; break;
      case 'waiting':    list = tasks.filter(t => t.status === 'ASSIGNED' || t.status === 'PENDING_DELEGATION'); break;
      case 'inProgress': list = tasks.filter(t => t.status === 'IN_PROGRESS'); break;
      case 'blocked':    list = tasks.filter(t => t.status === 'BLOCKED'); break;
      case 'inReview':   list = tasks.filter(t => t.status === 'AWAITING_APPROVAL'); break;
      case 'crisis':     list = tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && Date.now() > t.deadline); break;
      case 'completed':  list = tasks.filter(t => t.status === 'COMPLETED'); break;
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

  const completionRatePercent = useMemo(() => {
    const total = tasks.length;
    if (total === 0) return 0;
    return Math.round((tasks.filter(t => t.status === 'COMPLETED').length / total) * 100);
  }, [tasks]);

  // SLA standardize edilmiş formul: zamanında tamamlanan / toplam tamamlanan
  // (tüm ekranlarda tutarlı tek tanım)
  const slaCompliancePercent = useMemo(() => {
    const completed = tasks.filter(t => t.status === 'COMPLETED');
    if (completed.length === 0) return 100;
    const onTime = completed.filter(t => (t.completedAt || t.updatedAt) <= t.deadline).length;
    return Math.round((onTime / completed.length) * 100);
  }, [tasks]);

  const healthScore = useMemo(() => {
    const total = tasks.length;
    if (total === 0) return 100;
    const completionRate = completionRatePercent / 100;
    const slaRate = slaCompliancePercent / 100;
    return Math.round(((completionRate * 0.6) + (slaRate * 0.4)) * 100);
  }, [completionRatePercent, slaCompliancePercent]);

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
          healthScore >= 80 ? "bg-emerald-500/[0.035]" :
          healthScore >= 50 ? "bg-amber-500/[0.04]" :
          "bg-red-500/[0.04]"
        )} />

        <div className="relative z-10 flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner flex-shrink-0",
            healthScore >= 80 ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
            healthScore >= 50 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
            "bg-red-500/10 text-red-500 border-red-500/20"
          )}>
            <Target className="w-6 h-6 stroke-[1.2]" />
          </div>
          <div>
            <h3 className="text-[13px] font-medium text-executive-blue tracking-tight font-display">Stratejik Sağlık Endeksi</h3>
            <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">
              Organizasyonel Performans & İcra Düzeyi
            </p>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-8 justify-between w-full md:w-auto">
          <div className="flex flex-col items-start md:items-end gap-1">
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.2em] font-medium">Sistem Durumu</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "w-2 h-2 rounded-full",
                healthScore >= 80 ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                healthScore >= 50 ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" :
                "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
              )} />
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-widest",
                healthScore >= 80 ? "text-emerald-600 dark:text-emerald-400" :
                healthScore >= 50 ? "text-amber-600 dark:text-amber-400" :
                "text-red-600 dark:text-red-400"
              )}>
                {healthScore >= 80 ? "STABİL / GÜVENLİ" :
                 healthScore >= 50 ? "GÖZETİM ALTINDA" :
                 "ACİL PROTOKOL"}
               </span>
            </div>
            {/* Sub-metrics transparency indicators */}
            <div className="flex gap-2.5 text-[8px] text-text-tertiary font-bold uppercase mt-1">
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
              <span className="text-[8px] text-text-tertiary uppercase tracking-[0.25em] mt-1">SAĞLIK SKORU</span>
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
              <h3 className="text-[13px] font-medium text-executive-blue tracking-tight font-display">Yönetici Müdahale Kuyruğu</h3>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.16em] mt-0.5">Risk, mühlet, atalet ve onay önceliği</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 w-full md:w-auto">
              {executiveSignals.map(signal => (
                <div
                  key={signal.label}
                  className={cn(
                    'min-w-0 rounded-xl border px-2 py-1.5 text-center',
                    signal.tone === 'red' ? 'bg-red-50 text-red-600 border-red-100' :
                    signal.tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                    'bg-emerald-50 text-emerald-700 border-emerald-100'
                  )}
                >
                  <div className="text-[14px] font-semibold tabular-nums leading-none">{signal.value}</div>
                  <div className="text-[7px] uppercase tracking-[0.12em] mt-1 truncate">{signal.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {executiveQueue.length > 0 ? (
              executiveQueue.slice(0, 5).map((item, index) => (
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
                <ShieldCheck className="w-7 h-7 text-emerald-500 stroke-[1.2]" />
                <span className="text-[9px] text-text-tertiary uppercase tracking-[0.16em]">Müdahale Gerektiren Başlık Yok</span>
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
              <h3 className="text-[13px] font-medium text-executive-blue tracking-tight font-display">Kadro Yük Matrisi</h3>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.16em] mt-0.5">Aktif yük ve SLA disiplini</p>
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
                <linearGradient id="chartPending" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E2E8F0" />
                  <stop offset="100%" stopColor="#CBD5E1" />
                </linearGradient>
                <linearGradient id="chartInProgress" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-executive-blue)" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="var(--color-executive-blue)" stopOpacity="0.35" />
                </linearGradient>
                <linearGradient id="chartBlocked" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E07A7A" />
                  <stop offset="100%" stopColor="#A8201A" />
                </linearGradient>
                <linearGradient id="chartAwaiting" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#DBC08A" />
                  <stop offset="100%" stopColor="#B38F46" />
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
              <Bar dataKey="Bekleyen"   stackId="a" fill="url(#chartPending)" radius={[0,0,0,0]} />
              <Bar dataKey="İşlemde"    stackId="a" fill="url(#chartInProgress)" radius={[0,0,0,0]} />
              <Bar dataKey="Engellenen" stackId="a" fill="url(#chartBlocked)" radius={[0,0,0,0]} />
              <Bar dataKey="Denetimde"  stackId="a" fill="url(#chartAwaiting)" radius={[0,0,0,0]} />
              <Bar dataKey="Tamamlandı" stackId="a" fill="url(#chartCompleted)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-executive-blue/[0.04]">
          {[
            { color: '#CBD5E1', border: '#E2E8F0', label: 'Bekleyen' },
            { color: 'var(--color-executive-blue)', label: 'İşlemde' },
            { color: '#A8201A', label: 'Engellenen' },
            { color: '#B38F46', label: 'Denetimde' },
            { color: '#1B7A51', label: 'Tamamlandı' },
          ].map(({ color, border, label }) => (
            <div key={label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color, border: border ? `1px solid ${border}` : undefined }} />
              <span className="text-[8px] text-text-tertiary uppercase tracking-[0.2em]">{label}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Bottom two panels ──────────────────────────────────────── */}
      {/* Mobile: stacked | Desktop: side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* Critical Interventions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.35 }}
          className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
        >
          <div
            className="flex items-center justify-between mb-3 cursor-pointer group"
            onClick={() => setActiveTab?.('tasks')}
          >
            <div>
              <h4 className="text-[12px] font-medium text-executive-blue font-display tracking-tight group-hover:text-red-600 transition-colors">
                Kritik Müdahaleler
              </h4>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">
                {criticalTasks.length} Aktif Risk
              </p>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-red-500 group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="flex flex-col gap-2">
            {criticalTasks.length > 0 ? (
              criticalTasks.slice(0, 4).map(task => (
                <MiniTaskRow
                  key={task.id}
                  task={task}
                  type="blocked"
                  users={users}
                  now={tick}
                  onView={() => onViewTask?.(task)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-xl border border-dashed border-executive-blue/[0.05] bg-[#F5F3EF]/50">
                <ShieldCheck className="w-6 h-6 text-emerald-400 stroke-[1.2]" />
                <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">Sistem Temiz</span>
              </div>
            )}
          </div>
        </motion.div>

        {/* Strategic Review */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.42 }}
          className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
        >
          <div
            className="flex items-center justify-between mb-3 cursor-pointer group"
            onClick={() => setActiveTab?.('tasks')}
          >
            <div>
              <h4 className="text-[12px] font-medium text-executive-blue font-display tracking-tight group-hover:text-[#C5A059] transition-colors">
                Stratejik Denetim
              </h4>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">
                {reviewTasks.length} Onay Bekliyor
              </p>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-[#C5A059] group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="flex flex-col gap-2">
            {reviewTasks.length > 0 ? (
              reviewTasks.slice(0, 4).map(task => (
                <MiniTaskRow
                  key={task.id}
                  task={task}
                  type="review"
                  users={users}
                  now={tick}
                  onView={() => onViewTask?.(task)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-xl border border-dashed border-executive-blue/[0.05] bg-[#F5F3EF]/50">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 stroke-[1.2]" />
                <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">Bekleyen Yok</span>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Stat Detail Modal ────────────────────────────────────────── */}
      <Modal
        isOpen={!!selectedStatCategory}
        onClose={() => setSelectedStatCategory(null)}
        title={selectedStatCategory ? statModalTitle[selectedStatCategory] ?? '' : ''}
        size="lg"
      >
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {getFilteredTasksForStat().length > 0 ? (
            getFilteredTasksForStat().map(task => (
              <div
                key={task.id}
                className="flex items-center gap-3 p-3 bg-surface-elevated border border-gray-100 rounded-xl group cursor-pointer hover:bg-[#F5F3EF] hover:border-executive-blue/10 transition-all duration-300 shadow-sm"
                onClick={() => { setSelectedStatCategory(null); onViewTask?.(task); }}
              >
                <div className={cn(
                  'w-8 h-8 rounded-xl flex items-center justify-center border flex-shrink-0',
                  task.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-500 border-emerald-100' :
                  task.status === 'BLOCKED'   ? 'bg-red-50 text-red-500 border-red-100' :
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
