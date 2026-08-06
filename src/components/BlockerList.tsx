import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Edit2, Trash2 } from 'lucide-react';
import { Task, TaskBlocker, User } from '../types';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';
import { cn, formatTimeAgo } from '../lib/utils';
import { motion } from 'motion/react';
import { PRIORITY_BADGE_VARIANT } from '../constants';

interface BlockerListProps {
  tasks: Task[];
  blockers: TaskBlocker[];
  users: User[];
  isAdmin: boolean;
  isSystemAdmin?: boolean;
  onResolve: (blockerId: string) => void;
  onEditBlocker: (blockerId: string, reason: string) => void;
  onDeleteBlocker: (blockerId: string) => void;
  onViewTask: (task: Task) => void;
}

export const BlockerList = ({ tasks, blockers, users, isAdmin, isSystemAdmin = false, onResolve, onEditBlocker, onDeleteBlocker, onViewTask }: BlockerListProps) => {
  const getBlockerPriorityWeight = (blocker: TaskBlocker) => {
    const task = tasks.find(t => t.id === blocker.taskId);
    if (!task) return -1;
    const priorityWeights: Record<string, number> = { Urgent: 3, High: 2, Medium: 1, Low: 0 };
    return priorityWeights[task.priority] ?? 0;
  };

  const activeBlockers = [...blockers.filter(b => !b.isResolved)].sort((a, b) => {
    const weightA = getBlockerPriorityWeight(a);
    const weightB = getBlockerPriorityWeight(b);
    if (weightB !== weightA) return weightB - weightA;
    return b.createdAt - a.createdAt;
  });

  const resolvedBlockers = blockers.filter(b => b.isResolved);

  const [editingBlocker, setEditingBlocker]   = useState<TaskBlocker | null>(null);
  const [editReason, setEditReason]           = useState('');
  const [deletingBlockerId, setDeletingBlockerId] = useState<string | null>(null);

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBlocker && editReason.trim()) {
      onEditBlocker(editingBlocker.id, editReason.trim());
      setEditingBlocker(null);
    }
  };

  // ── Single Blocker Card ──────────────────────────────────────────────────
  const BlockerCard = ({ blocker, index }: { blocker: TaskBlocker; index: number }) => {
    const task     = tasks.find(t => t.id === blocker.taskId);
    const assignee = users.find(u => u.uid === task?.assigneeId || u.email === task?.assigneeId);
    const isUrgentOrHigh = task?.priority === 'Urgent' || task?.priority === 'High';

    const getSlaLabel = (deadline: number) => {
      const msLeft = deadline - Date.now();
      const hoursLeft = Math.floor(Math.abs(msLeft) / (1000 * 60 * 60));
      const daysLeft  = Math.floor(hoursLeft / 24);
      const isOverdue = msLeft < 0;
      return isOverdue
        ? `${daysLeft > 0 ? `${daysLeft}g ` : ''}${hoursLeft % 24}s geçti`
        : daysLeft > 0
          ? `${daysLeft}g ${hoursLeft % 24}s kaldı`
          : `${hoursLeft}s kaldı`;
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.05 }}
        onClick={() => task && onViewTask(task)}
        className={cn(
          'flex flex-col gap-3 p-3.5 rounded-2xl border cursor-pointer group transition-all duration-300',
          !blocker.isResolved
            ? cn(
                'bg-status-danger/[0.04] border-status-danger/20 hover:bg-status-danger/10 hover:shadow-sm',
                isUrgentOrHigh ? 'animate-makam-flash border-status-danger/50 hover:border-status-danger/60' : 'border-status-danger/15 hover:border-status-danger/25'
              )
            : 'bg-makam-glass border-surface-border opacity-60 grayscale hover:grayscale-0 hover:opacity-100 hover:bg-makam-glass'
        )}
      >
        {/* Top row: icon + reason + date */}
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-8 h-8 flex-shrink-0 rounded-xl flex items-center justify-center border transition-all group-hover:scale-105',
            blocker.isResolved
              ? 'bg-status-success/10 text-status-success border-status-success/20'
              : 'bg-surface-elevated text-status-danger border-status-danger/25'
          )}>
            {blocker.isResolved
              ? <CheckCircle2 className="w-4 h-4 stroke-[1.3]" />
              : <AlertTriangle className="w-4 h-4 stroke-[1.3]" />}
          </div>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <p className={cn(
              'text-[12px] font-medium line-clamp-2 leading-snug tracking-tight font-serif',
              blocker.isResolved ? 'text-text-muted' : 'text-executive-blue group-hover:text-status-danger'
            )}>
              {blocker.reason}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-[9px] text-text-tertiary font-medium uppercase tracking-[0.2em] truncate">
                {task?.title || 'Bilinmeyen Talimat'}
              </span>
              {task && (
                <>
                  <span className="text-[9px] text-text-tertiary/40">•</span>
                  <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]}>
                    {task.priority === 'Urgent' ? 'Acil' :
                     task.priority === 'High' ? 'Yüksek' :
                     task.priority === 'Medium' ? 'Orta' : 'Düşük'}
                  </Badge>
                  {task.deadline > 0 && (
                    <Badge variant={task.deadline < Date.now() ? 'danger' : 'default'} icon={<Clock className="w-2.5 h-2.5" />}>
                      {getSlaLabel(task.deadline)}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <span className="text-[8px] text-text-tertiary font-medium uppercase tracking-[0.15em]">
              {new Date(blocker.createdAt).toLocaleDateString('tr-TR')}
            </span>
            <span className="text-[8px] text-text-tertiary">{formatTimeAgo(blocker.createdAt)}</span>
          </div>
        </div>

        {/* Bottom row: assignee + actions */}
        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-executive-blue/[0.04]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-executive-blue/[0.04] border border-executive-blue/[0.08] flex items-center justify-center text-[10px] font-light text-executive-blue">
              {assignee?.fullName?.charAt(0) || '?'}
            </div>
            <span className="text-[10px] text-text-muted font-medium tracking-tight">
              {assignee?.fullName || 'Atanmamış'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <div className="flex items-center bg-makam-glass rounded-lg p-0.5 border border-executive-blue/[0.05] gap-0.5">
                <button
                  className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-executive-blue hover:bg-surface-elevated rounded-md transition-all"
                  onClick={(e) => { e.stopPropagation(); setEditingBlocker(blocker); setEditReason(blocker.reason); }}
                  title="Düzenle"
                >
                  <Edit2 className="w-3 h-3 stroke-[1.5]" />
                </button>
                {isSystemAdmin && (
                  <button
                    className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 rounded-md transition-all"
                    onClick={(e) => { e.stopPropagation(); setDeletingBlockerId(blocker.id); }}
                    title="Sil"
                  >
                    <Trash2 className="w-3 h-3 stroke-[1.5]" />
                  </button>
                )}
              </div>
            )}
            {!blocker.isResolved && isAdmin && (
              <button
                className="px-3 py-1.5 text-[8px] bg-status-success hover:opacity-90 text-white font-medium uppercase tracking-[0.2em] rounded-lg shadow-sm transition-all active:scale-95"
                onClick={(e) => { e.stopPropagation(); onResolve(blocker.id); }}
              >
                Çözüldü
              </button>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 pb-4 border-b border-executive-blue/[0.04]">
        <div className="w-8 h-8 rounded-xl bg-status-danger flex items-center justify-center shadow-lg">
          <AlertTriangle className="w-4 h-4 text-white stroke-[1.5]" />
        </div>
        <div>
          <span className="text-[10px] font-medium text-status-danger uppercase tracking-[0.4em] block leading-none">
            OPERASYONEL KRİZ YÖNETİMİ
          </span>
          <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">
            {activeBlockers.length} Aktif Engel
          </span>
        </div>
      </div>

      {/* ── Two-column blocker panels ────────────────────────────── */}
      {/* Mobile: stacked | Desktop: 2 col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Active blockers */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-status-danger stroke-[1.5]" />
            <h3 className="text-[9px] font-medium text-status-danger uppercase tracking-[0.35em]">
              Aktif Kriz Engelleri
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-status-danger/10 text-status-danger border border-status-danger/20 text-[8px] font-bold">
              {activeBlockers.length}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {activeBlockers.length > 0 ? (
              activeBlockers.map((b, i) => <BlockerCard key={b.id} blocker={b} index={i} />)
            ) : (
              <div className="py-12 flex flex-col items-center justify-center bg-makam-glass border border-dashed border-executive-blue/[0.05] rounded-2xl gap-3">
                <CheckCircle2 className="w-8 h-8 text-status-success/50 stroke-[1]" />
                <span className="text-[9px] text-text-tertiary uppercase tracking-[0.35em]">Aktif engel bulunmuyor</span>
              </div>
            )}
          </div>
        </div>

        {/* Resolved blockers */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-text-tertiary stroke-[1.5]" />
            <h3 className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em]">
              Çözüme Ulaşanlar
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-surface-base text-text-tertiary border border-surface-border text-[8px] font-bold">
              {resolvedBlockers.length}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {resolvedBlockers.length > 0 ? (
              resolvedBlockers.map((b, i) => <BlockerCard key={b.id} blocker={b} index={i} />)
            ) : (
              <div className="py-12 flex flex-col items-center justify-center bg-makam-glass border border-dashed border-executive-blue/[0.05] rounded-2xl gap-3">
                <Clock className="w-8 h-8 text-surface-border/50 stroke-[1]" />
                <span className="text-[9px] text-text-tertiary uppercase tracking-[0.35em]">Arşivlenmiş kayıt yok</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit Modal ─────────────────────────────────────────────── */}
      <Modal isOpen={!!editingBlocker} onClose={() => setEditingBlocker(null)} title="Engeli Düzenle">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
          <Input label="Engel Sebebi" value={editReason} onChange={(e) => setEditReason(e.target.value)} required />
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" type="button" onClick={() => setEditingBlocker(null)}>İptal</Button>
            <Button type="submit">Kaydet</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Modal ───────────────────────────────────────────── */}
      <Modal isOpen={!!deletingBlockerId} onClose={() => setDeletingBlockerId(null)} title="Engeli Sil">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted font-light">Bu engeli silmek istediğinize emin misiniz?</p>
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={() => setDeletingBlockerId(null)}>İptal</Button>
            <Button variant="danger" onClick={() => {
              if (deletingBlockerId) {
                onDeleteBlocker(deletingBlockerId);
                setDeletingBlockerId(null);
              }
            }}>Sil</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
