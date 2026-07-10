import React from 'react';
import { AlertCircle, Clock, Target, XCircle, History, ShieldCheck, Zap, AlertTriangle as AlertTriangleIcon, CheckCircle2 } from 'lucide-react';
import { Task, User } from '../types';
import { cn } from '../lib/utils';
import { getRemainingTime } from '../lib/sla';
import { STATUS_LABELS, PRIORITY_LABELS, IDLE_THRESHOLD_MS } from '../constants';
import { Badge } from './ui/Badge';
import { motion } from 'motion/react';

interface TaskCardProps {
  task: Task;
  assignee?: User;
  subTaskCount?: number;
  onViewDetails?: () => void;
  onCancel?: () => void;
  canEdit?: boolean;
  index?: number;
}

export const TaskCard = ({
  task, assignee, subTaskCount,
  onViewDetails, onCancel, canEdit, index = 0
}: TaskCardProps) => {
  const isBlocked = task.status === 'BLOCKED';
  const isIdle = (Date.now() - task.updatedAt) > IDLE_THRESHOLD_MS && task.status !== 'COMPLETED';
  const isCrisis = task.status !== 'CANCELLED' && task.status !== 'COMPLETED' &&
    (task.deadline < Date.now() || (isIdle && (task.priority === 'High' || task.priority === 'Urgent' || isBlocked)));

  const sla = getRemainingTime(task.deadline, task.totalPausedTime, task.pausedAt);

  const formatSLA = (ms: number) => {
    const absMs = Math.abs(ms);
    const hours = Math.floor(absMs / 3600000);
    const mins = Math.floor((absMs % 3600000) / 60000);
    if (ms < 0) return `-${hours}s ${mins}dk`;
    return `${hours}h ${mins}m`;
  };

  const statusIcon = () => {
    if (task.status === 'COMPLETED') return <CheckCircle2 className="w-3 h-3" />;
    if (task.status === 'IN_PROGRESS') return <Zap className="w-3 h-3" />;
    if (task.status === 'AWAITING_APPROVAL') return <ShieldCheck className="w-3 h-3" />;
    return <Clock className="w-3 h-3" />;
  };

  const statusBadgeVariant = () => {
    if (task.status === 'COMPLETED') return 'success';
    if (task.status === 'IN_PROGRESS') return 'info';
    if (task.status === 'AWAITING_APPROVAL') return 'warning';
    return 'default';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30, delay: index * 0.04 }}
      whileHover={{ y: -2, scale: 1.005 }}
      whileTap={{ scale: 0.99 }}
      onClick={onViewDetails}
      className={cn(
        'group flex flex-col gap-2.5 p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border',
        'rounded-2xl transition-all duration-300 hover:bg-surface-elevated hover:border-surface-border cursor-pointer',
        'shadow-[0_1px_8px_rgba(22,21,19,0.02)] hover:shadow-[0_6px_24px_rgba(0,0,0,0.06)]',
        isBlocked && 'border-orange-200/60 bg-orange-50/30',
        isCrisis && 'border-red-200/70 bg-red-50/40 ring-1 ring-red-100/50'
      )}
    >
      {/* Top row: badges + cancel */}
      <div className="flex justify-between items-start gap-1.5">
        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {/* Status badge */}
          <Badge variant={statusBadgeVariant()} icon={statusIcon()}>
            {STATUS_LABELS[task.status] || task.status}
          </Badge>

          {isCrisis && (
            <Badge variant="danger" withPulse icon={<AlertCircle className="w-3 h-3" />}>
              Gecikti
            </Badge>
          )}

          {isBlocked && (
            <Badge variant="warning" withPulse icon={<AlertTriangleIcon className="w-3 h-3" />}>
              Engel
            </Badge>
          )}

          {task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && !isBlocked && !isCrisis && (
            <Badge
              variant={
                sla.status === 'breached'    ? 'danger' :
                sla.status === 'near-breach' ? 'warning' :
                sla.status === 'paused'      ? 'default' :
                'info'
              }
              withPulse={sla.status === 'breached' || sla.status === 'near-breach'}
              icon={sla.status === 'paused' ? <History className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            >
              {sla.status === 'paused' ? 'DURDURULDU' : formatSLA(sla.timeLeftMs)}
            </Badge>
          )}
        </div>

        {/* Cancel button - hover only */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {canEdit && task.status !== 'CANCELLED' && task.status !== 'COMPLETED' && (
            <button
              className="w-5 h-5 flex items-center justify-center rounded-md text-text-muted/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
              onClick={(e) => { e.stopPropagation(); onCancel?.(); }}
              title="Talimatı Lağvet"
            >
              <XCircle className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Title & description */}
      <div className="flex flex-col gap-0.5">
        <h4 className={cn(
          'text-[13px] font-medium text-executive-blue line-clamp-2 leading-snug tracking-tight',
          'group-hover:text-executive-blue transition-colors font-display'
        )}>
          {task.title}
        </h4>
        {task.description && (
          <p className="text-[11px] text-text-tertiary line-clamp-1 font-light leading-normal">
            {task.description}
          </p>
        )}
      </div>

      {/* Bottom row: assignee + subtask count */}
      <div className="flex items-center justify-between gap-2 pt-0.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {assignee ? (
            <div
              className="w-5 h-5 rounded-full bg-executive-blue/5 border border-executive-blue/10 flex items-center justify-center text-[8px] font-medium text-executive-blue flex-shrink-0"
              title={assignee.fullName}
            >
              {assignee.fullName.charAt(0)}
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full bg-surface-border/40 border border-surface-border flex items-center justify-center text-[8px] font-medium text-text-muted flex-shrink-0" title="Atanmamış">
              ?
            </div>
          )}
          <span className="text-[9px] text-text-tertiary font-medium truncate min-w-0">
            {assignee?.fullName?.split(' ')[0] || 'Atanmamış'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Priority chip */}
          <Badge
            variant={
              task.priority === 'Urgent' ? 'danger' :
              task.priority === 'High'   ? 'warning' :
              task.priority === 'Medium' ? 'info' :
              'default'
            }
            className="px-2 py-0.5 text-[8px]"
          >
            {PRIORITY_LABELS[task.priority]}
          </Badge>

          {(subTaskCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-[8px] font-medium text-text-tertiary bg-executive-blue/[0.03] px-1.5 py-0.5 rounded-md">
              <Target className="w-2.5 h-2.5" />
              {subTaskCount}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};
