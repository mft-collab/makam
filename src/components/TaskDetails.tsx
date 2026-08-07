import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Calendar, CheckCircle2, AlertTriangle, FileText,
  ChevronRight, Award, Zap, Activity, Info,
  Edit2, Trash2, ArrowRight, MessageSquare, History, ListChecks, Send, Plus,
  GitCommit, Loader2, Hourglass, Clock, Building2, Tag, Flag, ExternalLink
} from 'lucide-react';
import { Task, User as UserType, TaskBlocker, AuditLog, TaskStatus } from '../types';
import { STATUS_LABELS, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT } from '../constants';
import { format, formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { Badge } from './ui/Badge';
import { Avatar } from './ui/Avatar';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { Tooltip } from './ui/Tooltip';
import { db, collection, query, where, getDocs } from '../firebase';
import { getTimeLeft, getSLAColor, computeChecklistStats } from './taskDetails/helpers';
import { AUDIT_FIELD_LABELS } from '../lib/auditLabels';

export type { PrimaryAction } from './taskDetails/helpers';
export { getPrimaryAction } from './taskDetails/helpers';
export { TaskDetailsFooter } from './taskDetails/Footer';

export const TaskDetails = ({
  task, tasks, users, currentUser, blockers,
  onAddBlocker, onResolveBlocker,
  onAddSubTask, onAddComment, onViewTask, onEdit, onDelete,
  onClearCoordinator, onShowCertificate, onShowWarning,
  onUpdateTask, onDelegateTask
}: {
  task: Task;
  tasks: Task[];
  users: UserType[];
  currentUser: UserType | null;
  blockers: TaskBlocker[];
  onAddBlocker: (reason: string) => void;
  onResolveBlocker: (blockerId: string) => void;
  onAddSubTask: (parentId: string, title: string) => void;
  onAddComment: (text: string) => void;
  onViewTask: (task: Task) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClearCoordinator?: () => void;
  onShowCertificate?: (task: Task) => void;
  onShowWarning?: (task: Task) => void;
  onUpdateTask?: (data: Partial<Task>) => void;
  onDelegateTask?: (newAssigneeId: string) => void;
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'checklist' | 'blockers' | 'subtasks' | 'history' | 'comments'>('info');
  const [newComment, setNewComment] = useState('');
  const [blockerReason, setBlockerReason] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Asenkron/fire-and-forget prop çağrıları sırasında çift gönderimi önlemek için
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSubmittingBlocker, setIsSubmittingBlocker] = useState(false);
  const [isSubmittingChecklist, setIsSubmittingChecklist] = useState(false);

  const handleAddChecklistItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChecklistItem.trim() || !onUpdateTask || isSubmittingChecklist) return;
    const currentChecklist = task.checklist || [];
    const newItem = {
      id: crypto.randomUUID(),
      text: newChecklistItem.trim(),
      isCompleted: false
    };
    setIsSubmittingChecklist(true);
    try {
      await Promise.resolve(onUpdateTask({ checklist: [...currentChecklist, newItem] }));
      setNewChecklistItem('');
    } finally {
      setIsSubmittingChecklist(false);
    }
  };

  const handleToggleChecklistItem = (itemId: string) => {
    if (!onUpdateTask) return;
    const currentChecklist = task.checklist || [];
    const updatedChecklist = currentChecklist.map(item => 
      item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item
    );
    onUpdateTask({ checklist: updatedChecklist });
  };

  const handleDeleteChecklistItem = (itemId: string) => {
    if (!onUpdateTask) return;
    const currentChecklist = task.checklist || [];
    const updatedChecklist = currentChecklist.filter(item => item.id !== itemId);
    onUpdateTask({ checklist: updatedChecklist });
  };

  const checklistStats = useMemo(() => computeChecklistStats(task.checklist), [task.checklist]);

  // #4 - Gerçek zamanlı SLA sayacı
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const [localLogs, setLocalLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState(false);
  const [logsRetryNonce, setLogsRetryNonce] = useState(0);
  // Aynı task için sekmeye her geçişte yeniden sorgu atmamak için in-memory cache
  const logsCacheRef = useRef<Record<string, AuditLog[]>>({});

  useEffect(() => {
    if (activeTab !== 'history') return;

    const cached = logsCacheRef.current[task.id];
    if (cached) {
      setLocalLogs(cached);
      setLogsError(false);
      return;
    }

    let cancelled = false;
    const fetchTaskLogs = async () => {
      setLoadingLogs(true);
      setLogsError(false);
      try {
        const q = query(
          collection(db, 'audit_logs'),
          where('taskId', '==', task.id)
        );
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
        list.sort((a, b) => b.timestamp - a.timestamp);
        if (cancelled) return;
        logsCacheRef.current[task.id] = list;
        setLocalLogs(list);
      } catch (err) {
        console.error('Failed to fetch task audit logs:', err);
        if (!cancelled) setLogsError(true);
      } finally {
        if (!cancelled) setLoadingLogs(false);
      }
    };
    fetchTaskLogs();
    return () => { cancelled = true; };
  }, [activeTab, task.id, logsRetryNonce]);

  const assignee = users.find(u => u.uid === task.assigneeId || u.email === task.assigneeId);
  const creator  = users.find(u => u.uid === task.creatorId || u.email === task.creatorId);
  // Koordinatörü görevin coordinatorId alanına göre bul
  const coordinator = task.coordinatorId
    ? users.find(u => u.uid === task.coordinatorId || u.email === task.coordinatorId)
    : undefined;
  // İş kuralı ihlali: koordinatör Admin ise uyar
  const coordinatorIsAdmin = coordinator?.role === 'Admin';
  
  const isAdmin = currentUser?.role === 'Admin';
  const isManager = currentUser?.role === 'Manager';

  // İzin/mazeret devri: yalnızca görevin mevcut sorumlusu olan Müdür,
  // henüz başlamamış/devam eden bir görevi başka bir Müdür'e devredebilir.
  const canDelegate = isManager
    && currentUser?.uid === task.assigneeId
    && (task.status === 'ASSIGNED' || task.status === 'IN_PROGRESS');
  const delegateCandidates = useMemo(
    () => users.filter(u => u.role === 'Manager' && u.uid !== currentUser?.uid),
    [users, currentUser?.uid]
  );
  const [isDelegateModalOpen, setIsDelegateModalOpen] = useState(false);
  const [delegateTargetId, setDelegateTargetId] = useState('');
  const [isSubmittingDelegate, setIsSubmittingDelegate] = useState(false);

  const handleDelegate = async () => {
    if (!delegateTargetId || !onDelegateTask || isSubmittingDelegate) return;
    setIsSubmittingDelegate(true);
    try {
      await Promise.resolve(onDelegateTask(delegateTargetId));
      setIsDelegateModalOpen(false);
      setDelegateTargetId('');
    } finally {
      setIsSubmittingDelegate(false);
    }
  };

  const subtasks = useMemo(() => tasks.filter(t => t.parentId === task.id), [tasks, task.id]);
  
  // #4 - Canlı SLA hesaplama (totalPausedTime ve pausedAt dahil)
  const timeLeft = getTimeLeft(task, now);

  // #5 - Durum akış pipeline sırası
  const STATUS_PIPELINE: TaskStatus[] = useMemo(() => {
    const interruption = task.status === 'BLOCKED' || task.status === 'CRISIS' ? task.status : null;
    // Yetki devri bekleyen talimatlar pipeline'da "Atandı" yerine kendi adımıyla gösterilir
    const first: TaskStatus = task.status === 'PENDING_DELEGATION' ? 'PENDING_DELEGATION' : 'ASSIGNED';
    return interruption
      ? [first, 'IN_PROGRESS', interruption, 'AWAITING_APPROVAL', 'COMPLETED']
      : [first, 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED'];
  }, [task.status]);
  const currentPipelineIdx = STATUS_PIPELINE.indexOf(task.status);

  const handleAddComment = async () => {
    if (!newComment.trim() || isSubmittingComment) return;
    setIsSubmittingComment(true);
    try {
      await Promise.resolve(onAddComment(newComment));
      setNewComment('');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleAddBlocker = async () => {
    if (!blockerReason.trim() || isSubmittingBlocker) return;
    setIsSubmittingBlocker(true);
    try {
      await Promise.resolve(onAddBlocker(blockerReason));
      setBlockerReason('');
    } finally {
      setIsSubmittingBlocker(false);
    }
  };

  const statusBadgeVariant = () => {
    if (task.status === 'COMPLETED') return 'success';
    if (task.status === 'BLOCKED' || task.status === 'CRISIS') return 'danger';
    if (task.status === 'AWAITING_APPROVAL') return 'warning';
    // Yetki devri bekleyen talimat, "atanmış ve başlamaya hazır" olandan görsel olarak ayrışsın
    if (task.status === 'PENDING_DELEGATION') return 'warning';
    if (task.status === 'IN_PROGRESS') return 'info';
    return 'default';
  };

  return (
    <>
      <div className="flex flex-col gap-4 py-1 font-sans">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={statusBadgeVariant()}
              withPulse={task.status === 'BLOCKED' || task.status === 'CRISIS'}
              icon={task.status === 'PENDING_DELEGATION'
                ? <Hourglass className="w-3.5 h-3.5" />
                : <Activity className="w-3.5 h-3.5" />}
            >
              {STATUS_LABELS[task.status]}
            </Badge>
            {/* #2 - Öncelik göstergesi */}
            <Badge
              variant={PRIORITY_BADGE_VARIANT[task.priority]}
              icon={<Flag className="w-3 h-3" />}
            >
              {PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {(isAdmin || isManager) && (
              <div className="flex items-center bg-makam-glass backdrop-blur-2xl rounded-full p-1 border border-surface-border shadow-sm">
                <button onClick={onEdit} className="px-4 py-2 rounded-full text-[10px] font-medium text-text-muted hover:text-executive-blue transition-colors uppercase tracking-[0.2em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2">
                  <Edit2 className="w-3.5 h-3.5 inline mr-2" />
                  Düzenle
                </button>
                <div className="w-[1px] h-3 bg-makam-border/10 mx-1" />
                <button onClick={() => setIsDeleteConfirmOpen(true)} className="px-4 py-2 rounded-full text-[10px] font-medium text-text-muted hover:text-status-danger transition-colors uppercase tracking-[0.2em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2">
                  <Trash2 className="w-3.5 h-3.5 inline mr-2" />
                  Sil
                </button>
              </div>
            )}
          </div>
        </div>

        <h2 className="text-[18px] font-medium text-executive-blue tracking-tight leading-tight font-display border-l-2 border-executive-gold/40 pl-4 py-1">
          {task.title}
        </h2>
      </div>

      {/* #5 - Durum Akış Pipeline Şeridi */}
      <div className="px-1 py-3">
        <div className="flex items-center gap-0">
          {STATUS_PIPELINE.map((status, idx) => {
            const isCompleted = currentPipelineIdx > idx;
            const isActive = currentPipelineIdx === idx;
            const isInterruption = status === 'BLOCKED' || status === 'CRISIS';
            const isDelegation = status === 'PENDING_DELEGATION';
            const labels: Record<string, string> = {
              ASSIGNED: 'Atandı', PENDING_DELEGATION: 'Devir Bekliyor',
              IN_PROGRESS: 'İşlemde',
              BLOCKED: 'Engel', CRISIS: 'Kriz',
              AWAITING_APPROVAL: 'Onayda', COMPLETED: 'Tamam'
            };
            return (
              <React.Fragment key={status}>
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-500',
                    isCompleted ? 'bg-status-success border-status-success text-white' :
                    isActive && isInterruption ? 'bg-status-danger border-status-danger text-white animate-pulse shadow-lg shadow-status-danger/15' :
                    isActive && isDelegation ? 'bg-executive-gold border-executive-gold text-white shadow-lg shadow-executive-gold/20' :
                    isActive ? 'bg-executive-blue border-executive-blue text-white shadow-lg shadow-executive-blue/20' :
                    'bg-surface-elevated border-text-muted/25 text-text-tertiary'
                  )}>
                    {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" /> :
                     isActive && isInterruption ? <AlertTriangle className="w-3.5 h-3.5 stroke-[2]" /> :
                     isActive && isDelegation ? <Hourglass className="w-3.5 h-3.5 stroke-[2]" /> :
                     isActive ? <Zap className="w-3.5 h-3.5 stroke-[2]" /> :
                     <span className="text-[10px] font-bold">{idx + 1}</span>}
                  </div>
                  <span className={cn(
                    'text-[10px] font-medium uppercase tracking-[0.18em] whitespace-nowrap',
                    isCompleted ? 'text-status-success' :
                    isActive && isInterruption ? 'text-status-danger' :
                    isActive && isDelegation ? 'text-executive-gold' :
                    isActive ? 'text-executive-blue' : 'text-text-tertiary'
                  )}>{labels[status]}</span>
                </div>
                {idx < STATUS_PIPELINE.length - 1 && (
                  <div className={cn(
                    'flex-1 h-[2px] mx-1 mt-[-10px] rounded-full transition-all duration-500',
                    isCompleted ? 'bg-status-success' : 'bg-text-muted/15'
                  )} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <div
          role="tablist"
          aria-label="Talimat detay bölümleri"
          className="flex overflow-x-auto no-scrollbar border-b border-makam-border/5 scroll-smooth"
        >
          {([
            { id: 'info', label: 'Detay', icon: Info, count: 0 },
            // #9 - Tamamlanmamış alt işlem sayısı
            { id: 'checklist', label: 'Alt İşlemler', icon: ListChecks, count: checklistStats.total - checklistStats.completed },
            { id: 'subtasks', label: 'Alt Talimatlar', icon: GitCommit, count: subtasks.length },
            // #9 - Çözülmemiş engel sayısı
            { id: 'blockers', label: 'Engeller', icon: AlertTriangle, count: blockers.filter(b => !b.isResolved).length },
            // #10 - Denetim izi yalnızca Admin/Manager rollerine görünür
            ...(isAdmin || isManager ? [{ id: 'history', label: 'Denetim İzi', icon: History, count: 0 }] : []),
            { id: 'comments', label: 'Yorumlar', icon: MessageSquare, count: task.comments?.length ?? 0 },
          ]).map((tab) => (
            <button
              key={tab.id}
              id={`task-tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`task-tabpanel-${tab.id}`}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'px-6 py-4 text-[10px] font-medium uppercase tracking-[0.2em] transition-all border-b-2 whitespace-nowrap relative flex items-center gap-2',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-inset',
                activeTab === tab.id
                  ? 'border-executive-blue text-executive-blue'
                  : 'border-transparent text-text-muted hover:text-text-heading hover:bg-makam-glass'
              )}
            >
              <tab.icon className="w-3.5 h-3.5" aria-hidden="true" />
              {tab.label}
              {tab.count > 0 && <span className="tabular-nums">({tab.count})</span>}
            </button>
          ))}
        </div>
        {/* Taşan sekmeler için kenar fade ipucu */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface-elevated to-transparent"
        />
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {activeTab === 'info' && (
          <div role="tabpanel" id="task-tabpanel-info" aria-labelledby="task-tab-info" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em] flex items-center gap-2">
                  <FileText className="w-3 h-3 text-executive-blue" />
                  Stratejik Açıklama
                </h4>
                <div className="p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl">
                  <p className="text-executive-blue leading-relaxed font-light text-[13px] font-display">
                    {task.description || 'Bu talimat için detaylı bir açıklama girilmemiştir.'}
                  </p>
                </div>
                {/* #3 - Etiketler */}
                {task.tags && task.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 px-1">
                    <Tag className="w-3 h-3 text-text-muted shrink-0" aria-hidden="true" />
                    {task.tags.map(tag => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full bg-executive-blue/[0.05] border border-executive-blue/10 text-executive-blue text-[10px] font-medium tracking-wide"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-4">
                  <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Sorumlu Kadro</h4>
                  <div className="flex flex-col gap-3">
                    {[
                      { u: creator,     l: 'Oluşturan',   ring: 'ring-executive-gold/30' },
                      { u: assignee,    l: 'Sorumlu',     ring: 'ring-executive-blue/20' },
                      { u: coordinator, l: 'İrtibatlı',   ring: coordinatorIsAdmin ? 'ring-status-danger/40' : 'ring-status-success/40' }
                    ].filter(x => x.u).map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2.5 p-2.5 bg-makam-glass backdrop-blur-xl rounded-xl border border-surface-border shadow-sm">
                        {/* #10 - Avatar bileşeni */}
                        <Avatar
                          name={item.u?.fullName ?? ''}
                          photoURL={(item.u as any)?.photoURL}
                          size="sm"
                          ring
                          className={cn('flex-shrink-0', item.ring)}
                        />
                        <div className="flex flex-col gap-0.5 flex-1">
                          <span className="text-[12px] font-medium text-executive-blue tracking-tight">{item.u?.fullName}</span>
                          <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-[0.2em]">{item.l}</span>
                        </div>
                        {/* Koordinatör Admin ise uyarı + temizle */}
                        {item.l === 'İrtibatlı' && coordinatorIsAdmin && (isAdmin || isManager) && (
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="danger" className="text-[10px] px-1.5 py-0.5 font-bold">
                              Hatalı Atama
                            </Badge>
                            <button
                              onClick={onClearCoordinator}
                              className="text-[11px] px-2 py-1 -mr-2 rounded-md text-status-danger hover:text-status-danger uppercase tracking-widest font-medium underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                            >
                              Temizle
                            </button>
                          </div>
                        )}
                        {/* İzin/mazeret devri: sorumlu Müdür başka bir Müdür'e devredebilir */}
                        {item.l === 'Sorumlu' && canDelegate && onDelegateTask && (
                          <button
                            onClick={() => setIsDelegateModalOpen(true)}
                            className="text-[11px] px-2 py-1 -mr-2 rounded-md text-executive-blue hover:text-executive-gold uppercase tracking-widest font-medium underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                          >
                            Devret
                          </button>
                        )}
                      </div>
                    ))}
                    {/* #3 - Sorumlu birim (departman) */}
                    {task.departmentId && (
                      <div className="flex items-center gap-2.5 p-2.5 bg-makam-glass backdrop-blur-xl rounded-xl border border-surface-border shadow-sm">
                        <div className="w-8 h-8 rounded-full bg-executive-blue/[0.05] border border-executive-blue/10 flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-4 h-4 text-executive-blue/70" aria-hidden="true" />
                        </div>
                        <div className="flex flex-col gap-0.5 flex-1">
                          <span className="text-[12px] font-medium text-executive-blue tracking-tight">{task.departmentId}</span>
                          <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-[0.2em]">Sorumlu Birim</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Zaman Yönetimi</h4>
                    <Tooltip content="Mühlet yalnızca mesai saatleri (09:00–18:00) içinde işler; hafta sonu/resmî tatiller ve Engellendi/Onay Sürecinde geçen süre sayılmaz.">
                      <Info className="w-3 h-3 text-text-tertiary cursor-help" aria-label="Mühlet hesaplama kuralı" />
                    </Tooltip>
                  </div>
                  <div className="p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-executive-gold stroke-[1.3] flex-shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-[0.2em]">Bitiş Tarihi</span>
                      <p className="text-[13px] font-medium text-executive-blue">
                        {format(task.deadline, 'd MMMM yyyy', { locale: tr })}
                      </p>
                      {/* #4 - Canlı SLA geri sayım */}
                      {timeLeft && (
                        <span className={cn(
                          'text-[9px] font-medium tabular-nums mt-0.5',
                          getSLAColor(timeLeft.status)
                        )}>
                          {timeLeft.label}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* #3 - Tahmini efor */}
                  {typeof task.estimatedHours === 'number' && task.estimatedHours > 0 && (
                    <div className="p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl flex items-center gap-3">
                      <Clock className="w-4 h-4 text-executive-gold stroke-[1.3] flex-shrink-0" aria-hidden="true" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-[0.2em]">Tahmini Efor</span>
                        <p className="text-[13px] font-medium text-executive-blue tabular-nums">
                          {task.estimatedHours} saat
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              {/* Durum-özel bilgi kutuları — birincil aksiyon butonu modal alt çubuğundadır */}
              {(task.status === 'PENDING_DELEGATION' ||
                task.status === 'BLOCKED' ||
                task.status === 'COMPLETED' ||
                task.status === 'CANCELLED' ||
                (task.status === 'AWAITING_APPROVAL' && !isAdmin)) && (
                <div className="flex flex-col gap-4">
                  <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Durum Bilgisi</h4>
                  <div className="flex flex-col gap-2.5">
                    {task.status === 'PENDING_DELEGATION' && (
                      <div className="flex flex-col items-center gap-3 py-4 px-3 bg-executive-gold/[0.06] border border-dashed border-executive-gold/25 rounded-2xl">
                        <Hourglass className="w-5 h-5 text-executive-gold" aria-hidden="true" />
                        <span className="text-[10px] text-executive-gold font-medium uppercase tracking-widest text-center">Yetki Devri Bekleniyor</span>
                        <p className="text-[11px] text-text-muted font-light text-center leading-relaxed">
                          Talimat devralınmayı bekliyor; süreç ancak devir kabul edildiğinde başlar.
                        </p>
                      </div>
                    )}

                    {task.status === 'AWAITING_APPROVAL' && !isAdmin && (
                      <div className="flex flex-col items-center gap-3 py-4 px-3 bg-executive-gold/[0.06] border border-dashed border-executive-gold/25 rounded-2xl">
                        <Hourglass className="w-5 h-5 text-executive-gold" aria-hidden="true" />
                        <span className="text-[10px] text-executive-gold font-medium uppercase tracking-widest text-center">Makam Onayı Bekleniyor</span>
                        <p className="text-[11px] text-text-muted font-light text-center leading-relaxed">
                          Talimat onaya sunuldu; nihai kapanış yönetici onayıyla gerçekleşir.
                        </p>
                      </div>
                    )}

                    {task.status === 'BLOCKED' && (
                      <div className="flex flex-col items-center gap-3 py-4 px-2 bg-status-danger/5 border border-dashed border-status-danger/20 rounded-2xl">
                        <AlertTriangle className="w-5 h-5 text-status-danger animate-pulse" />
                        <span className="text-[10px] text-status-danger font-medium uppercase tracking-widest text-center">İşlem Engellendi</span>
                        <button
                          onClick={() => setActiveTab('blockers')}
                          className="text-[10px] px-2 py-1 rounded-md text-executive-blue font-bold uppercase tracking-widest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                        >
                          ENGELİ ÇÖZ
                        </button>
                      </div>
                    )}

                    {(task.status === 'COMPLETED' || task.status === 'CANCELLED') && (
                      <div className="flex flex-col items-center gap-3 py-4 px-2 bg-surface-border/30 border border-dashed border-surface-border/50 rounded-2xl">
                        <CheckCircle2 className="w-5 h-5 text-status-success" />
                        <span className="text-[10px] text-text-muted font-medium uppercase tracking-widest">Operasyon Sonlandı</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* #7 - Sonuç Belgeleri: Liyakat/İkaz belgeleri ve icra kanıtı */}
              {((task.status === 'COMPLETED' && task.completedAt) || task.evidence) && (
                <div className="flex flex-col gap-4">
                  <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Sonuç Belgeleri</h4>
                  <div className="p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl flex flex-col gap-2">
                    {task.status === 'COMPLETED' && task.completedAt && task.completedAt <= task.deadline && (
                      <Tooltip content="Mühleti içinde tamamlanan talimatlar için otomatik olarak hazırlanır." side="bottom" className="w-full">
                        <button
                          onClick={() => onShowCertificate?.(task)}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[11px] font-medium text-executive-gold uppercase tracking-widest hover:bg-executive-gold/10 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                        >
                          <Award className="w-4 h-4 shrink-0" aria-hidden="true" />
                          Liyakat Belgesi
                        </button>
                      </Tooltip>
                    )}
                    {task.status === 'COMPLETED' && task.completedAt && task.completedAt > task.deadline && (
                      <Tooltip content="Mühleti aşıldıktan sonra tamamlanan talimatlar için otomatik olarak hazırlanır." side="bottom" className="w-full">
                        <button
                          onClick={() => onShowWarning?.(task)}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[11px] font-medium text-status-danger uppercase tracking-widest hover:bg-status-danger/10 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                        >
                          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                          İkaz Belgesi
                        </button>
                      </Tooltip>
                    )}
                    {task.evidence && (
                      /^https?:\/\//i.test(task.evidence) ? (
                        <a
                          href={task.evidence}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[11px] font-medium text-executive-blue uppercase tracking-widest hover:bg-executive-blue/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                        >
                          <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                          İcra Kanıtı{task.evidenceType ? ` (${task.evidenceType === 'Image' ? 'Görsel' : task.evidenceType === 'Link' ? 'Bağlantı' : 'PDF'})` : ''}
                        </a>
                      ) : (
                        <div className="flex items-start gap-2.5 px-3 py-2.5">
                          <FileText className="w-4 h-4 shrink-0 text-executive-blue mt-0.5" aria-hidden="true" />
                          <span className="text-[11px] text-text-body break-all">{task.evidence}</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'subtasks' && (
          <div role="tabpanel" id="task-tabpanel-subtasks" aria-labelledby="task-tab-subtasks" className="flex flex-col gap-6">
            {/* #8 - Alt Talimat / Alt İşlem ayrımı ipucu */}
            <p className="text-[11px] text-text-muted font-light leading-relaxed">
              Alt talimatlar, ayrı bir sorumluya atanabilen; kendi durumu ve süresi olan bağımsız talimatlardır.
            </p>
            <div className="flex items-center justify-between">
              <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Operasyonel Alt Birimler</h4>
              <Button
                variant="gold"
                size="sm"
                onClick={() => onAddSubTask(task.id, '')}
                className="gap-2 tracking-widest"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Yeni Alt Talimat
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subtasks.length === 0 ? (
                <EmptyState className="md:col-span-2" message="Alt talimat bulunamadı" />
              ) : (
                subtasks.map(sub => (
                  <div 
                    key={sub.id}
                    onClick={() => onViewTask(sub)}
                    className="flex items-center justify-between p-3 bg-makam-glass border border-surface-border rounded-xl group cursor-pointer hover:bg-makam-card hover:shadow-sm transition-all"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-[13px] font-medium text-text-heading group-hover:text-executive-blue transition-colors">{sub.title}</span>
                      <span className="text-[9px] text-text-muted uppercase tracking-widest">{STATUS_LABELS[sub.status]}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-muted/20 group-hover:text-executive-blue group-hover:translate-x-1 transition-all" />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'blockers' && (
          <div role="tabpanel" id="task-tabpanel-blockers" aria-labelledby="task-tab-blockers" className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Aktif Engeller</h4>
              <div className="flex flex-col gap-3">
                {blockers.length === 0 ? (
                  <EmptyState message="Engel kaydı bulunamadı" />
                ) : (
                  blockers.map(blocker => (
                    <div key={blocker.id} className={cn(
                      "flex items-center justify-between p-3 rounded-xl border transition-all",
                      blocker.isResolved ? "opacity-50 grayscale bg-makam-glass border-surface-border" : "bg-status-danger/5 border-status-danger/15"
                    )}>
                      <div className="flex items-center gap-4">
                        <AlertTriangle className={cn("w-5 h-5", blocker.isResolved ? "text-text-muted" : "text-status-danger")} />
                        <div className="flex flex-col">
                          <span className="text-[14px] font-medium text-text-heading">{blocker.reason}</span>
                          <span className="text-[9px] text-text-muted uppercase tracking-widest">
                            {format(blocker.createdAt, 'd MMM HH:mm', { locale: tr })}
                          </span>
                        </div>
                      </div>
                      {!blocker.isResolved && (isAdmin || isManager) && (
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => onResolveBlocker(blocker.id)}
                          className="tracking-widest"
                        >
                          ÇÖZÜLDÜ
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-makam-border/5">
              <div className="flex gap-2">
                <label htmlFor="blocker-reason-input" className="sr-only">Engel açıklaması</label>
                <input
                  id="blocker-reason-input"
                  value={blockerReason}
                  onChange={(e) => setBlockerReason(e.target.value)}
                  placeholder="Engeli tanımlayın..."
                  disabled={isSubmittingBlocker}
                  className="flex-1 bg-makam-glass border border-makam-border/10 rounded-full px-5 py-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/10 disabled:opacity-60"
                />
                <button
                  onClick={handleAddBlocker}
                  disabled={!blockerReason.trim() || isSubmittingBlocker}
                  className="px-6 py-3 bg-status-danger text-white rounded-full text-[10px] uppercase tracking-widest shadow-lg shadow-status-danger/10 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2"
                >
                  {isSubmittingBlocker ? 'EKLENİYOR…' : 'ENGEL EKLE'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div role="tabpanel" id="task-tabpanel-history" aria-labelledby="task-tab-history" className="flex flex-col gap-4">
            <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Operasyonel Denetim İzleri</h4>
            <div className="flex flex-col gap-3">
              {loadingLogs ? (
                <div className="py-16 flex justify-center items-center">
                  <Loader2 className="w-6 h-6 animate-spin text-executive-blue" />
                </div>
              ) : logsError ? (
                <div className="py-12 px-4 flex flex-col items-center justify-center gap-3 bg-status-danger/5 border border-dashed border-status-danger/20 rounded-2xl text-center">
                  <AlertTriangle className="w-5 h-5 text-status-danger" aria-hidden="true" />
                  <span className="text-[10px] text-status-danger font-medium uppercase tracking-[0.18em]">
                    Denetim izleri yüklenemedi
                  </span>
                  <button
                    onClick={() => setLogsRetryNonce(n => n + 1)}
                    className="text-[11px] px-3 py-1.5 rounded-full text-executive-blue font-bold uppercase tracking-widest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                  >
                    Tekrar Dene
                  </button>
                </div>
              ) : localLogs.length === 0 ? (
                <EmptyState message="Denetim izi kaydı bulunamadı" />
              ) : (
                localLogs.map(log => {
                  const actor = users.find(u => u.uid === log.changedBy || u.email === log.changedBy);
                  const isSystemActor = log.changedBy?.startsWith('system:');
                  const hasChanges = log.changes && Object.keys(log.changes).length > 0;
                  return (
                    <div key={log.id} className="flex gap-3 p-3 bg-makam-glass border border-surface-border rounded-xl">
                      <div className="flex-shrink-0 pt-0.5">
                        <Avatar
                          name={actor?.fullName ?? (isSystemActor ? 'Sistem' : log.changedBy) ?? 'Sistem'}
                          photoURL={actor?.photoURL}
                          size="sm"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-text-heading">
                            {actor?.fullName || (isSystemActor ? 'Sistem' : log.changedBy) || 'Sistem'}
                          </span>
                          <span className="text-[9px] text-text-muted tabular-nums">
                            {format(log.timestamp, 'd MMM HH:mm', { locale: tr })}
                          </span>
                        </div>
                        {/* #7 - Field-level diff */}
                        {hasChanges ? (
                          <div className="flex flex-col gap-1">
                            {Object.entries(log.changes!).map(([field, change]) => {
                              const oldVal = String(change.old ?? '-');
                              const newVal = String(change.new ?? '-');
                              const label = AUDIT_FIELD_LABELS[field] ?? field;
                              // Durum alanı için STATUS_LABELS, silindi alanı için Evet/Hayır kullan
                              const fmtVal = (v: string) =>
                                field === 'status' ? (STATUS_LABELS[v as TaskStatus] ?? v) :
                                field === 'deleted' ? (v === 'true' ? 'Evet' : 'Hayır') : v;
                              return (
                                <div key={field} className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-[0.2em] bg-surface-glass px-1.5 py-0.5 rounded border border-surface-border">
                                    {label}
                                  </span>
                                  <span className="text-[9px] text-text-tertiary line-through">{fmtVal(oldVal)}</span>
                                  <ArrowRight className="w-2.5 h-2.5 text-text-tertiary flex-shrink-0" />
                                  <span className="text-[9px] font-medium text-executive-blue">{fmtVal(newVal)}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <Badge variant={
                            log.newValue === 'COMPLETED' ? 'success' :
                            log.newValue === 'BLOCKED' ? 'danger' :
                            log.newValue === 'IN_PROGRESS' ? 'info' :
                            log.newValue === 'AWAITING_APPROVAL' ? 'warning' :
                            'default'
                          }>
                            {STATUS_LABELS[log.newValue as TaskStatus] ?? String(log.newValue)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'checklist' && (
          <div role="tabpanel" id="task-tabpanel-checklist" aria-labelledby="task-tab-checklist" className="flex flex-col gap-5">
            {/* #8 - Alt Talimat / Alt İşlem ayrımı ipucu */}
            <p className="text-[11px] text-text-muted font-light leading-relaxed">
              Alt işlemler bu talimata bağlı kendi kontrol listenizdir — başkasına devredilmez, ayrı bir talimat oluşturmaz.
            </p>
            {/* Progress bar info */}
            <div className="flex flex-col gap-2.5 p-4 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl">
              <div className="flex justify-between items-center text-[10px] uppercase tracking-wider font-bold">
                <span className="text-text-muted">Alt İşlemler İlerlemesi</span>
                <span className="text-executive-blue">
                  {checklistStats.percent}% ({checklistStats.completed} / {checklistStats.total})
                </span>
              </div>
              <div className="w-full h-2 bg-executive-blue/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-status-success transition-all duration-300 rounded-full" 
                  style={{ width: `${checklistStats.percent}%` }} 
                />
              </div>
            </div>

            {/* Checklist items list */}
            <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto no-scrollbar">
              {(!task.checklist || task.checklist.length === 0) ? (
                <EmptyState icon={<ListChecks className="w-8 h-8" />} message="Henüz bir alt işlem eklenmemiş" />
              ) : (
                task.checklist.map((item) => (
                  <div 
                    key={item.id} 
                    className="flex items-center justify-between p-3.5 bg-makam-glass border border-surface-border rounded-xl group/item hover:bg-surface-elevated transition-all"
                  >
                    <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                      <input 
                        type="checkbox"
                        checked={item.isCompleted}
                        onChange={() => handleToggleChecklistItem(item.id)}
                        className="w-4 h-4 rounded accent-status-success cursor-pointer"
                      />
                      <span className={cn(
                        "text-[12px] font-medium leading-snug tracking-tight truncate",
                        item.isCompleted ? "line-through text-text-muted opacity-60" : "text-text-heading"
                      )}>
                        {item.text}
                      </span>
                    </label>

                    {onUpdateTask && (
                      <button
                        onClick={() => handleDeleteChecklistItem(item.id)}
                        className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 rounded-md opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                        title="Alt İşlemi Sil"
                        aria-label="Alt işlemi sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Checklist Add Form */}
            {onUpdateTask && (
              <form onSubmit={handleAddChecklistItem} className="flex gap-2 pt-4 border-t border-makam-border/5">
                <label htmlFor="checklist-item-input" className="sr-only">Yeni alt işlem</label>
                <input
                  id="checklist-item-input"
                  type="text"
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder="Yeni bir alt işlem yazın..."
                  disabled={isSubmittingChecklist}
                  className="flex-1 bg-makam-glass border border-makam-border/10 rounded-xl px-4 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue/15 disabled:opacity-60"
                  required
                />
                <button
                  type="submit"
                  disabled={!newChecklistItem.trim() || isSubmittingChecklist}
                  className="px-4 py-2 bg-executive-blue text-white rounded-xl flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider hover:bg-executive-blue/90 disabled:opacity-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Ekle
                </button>
              </form>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div role="tabpanel" id="task-tabpanel-comments" aria-labelledby="task-tab-comments" className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Yorumlar & Koordinasyon Notları</h4>
              <div className="flex flex-col gap-4 max-h-[400px] overflow-y-auto no-scrollbar pr-2">
                {(!task.comments || task.comments.length === 0) ? (
                  <EmptyState message="Henüz yorum girilmemiş" />
                ) : (
                  task.comments.map((comment, idx) => {
                    const commenter = users.find(u => u.uid === comment.userId || u.email === comment.userId);
                    return (
                      <div key={idx} className="flex flex-col gap-2 p-3 bg-makam-glass border border-surface-border rounded-xl">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-executive-blue/5 flex items-center justify-center text-[10px] text-executive-blue border border-executive-blue/10">
                              {(commenter?.fullName || comment.userId || 'Kullanıcı').charAt(0).toUpperCase()}
                            </div>
                            <span className="text-[12px] font-medium text-text-heading">{commenter?.fullName || comment.userId}</span>
                          </div>
                          <span className="text-[9px] text-text-muted font-light">{formatDistanceToNow(comment.timestamp, { addSuffix: true, locale: tr })}</span>
                        </div>
                        <p className="text-[13px] text-text-body leading-relaxed pl-8">{comment.text}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-makam-border/5">
              <div className="relative">
                <label htmlFor="comment-input" className="sr-only">Koordinasyon notu</label>
                <textarea
                  id="comment-input"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  placeholder="Bir koordinasyon notu ekleyin..."
                  disabled={isSubmittingComment}
                  className="w-full bg-makam-glass border border-makam-border/10 rounded-2xl p-4 pr-16 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue/10 min-h-[100px] resize-none disabled:opacity-60"
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || isSubmittingComment}
                  aria-label="Yorumu gönder"
                  className="absolute bottom-4 right-4 w-10 h-10 bg-executive-gold text-white rounded-full flex items-center justify-center shadow-lg shadow-executive-gold/25 hover:scale-105 hover:bg-executive-gold-hover active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
                >
                  {isSubmittingComment
                    ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    : <Send className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-text-tertiary tracking-wide">Göndermek için Ctrl+Enter (Mac: Cmd+Enter)</p>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* ── Silme Onayı ────────────────────────────────────────────── */}
    <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)} title="Talimatı Sil">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-text-muted font-light leading-relaxed">
          <strong className="text-status-danger font-medium">{task.title}</strong> talimatını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
        </p>
        {subtasks.length > 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
            <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-status-danger font-semibold uppercase tracking-[0.1em] leading-relaxed">
              Bu talimatın {subtasks.length} alt talimatı var. Bu işlem hepsini kademeli olarak silecektir.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
          <Button variant="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>İptal</Button>
          <Button variant="danger" onClick={() => { setIsDeleteConfirmOpen(false); onDelete(); }}>Kalıcı Olarak Sil</Button>
        </div>
      </div>
    </Modal>

    <Modal isOpen={isDelegateModalOpen} onClose={() => setIsDelegateModalOpen(false)} title="Talimatı Devret">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-text-muted font-light leading-relaxed">
          <strong className="text-text-heading font-medium">{task.title}</strong> talimatını izin/mazeret durumunuz için başka bir müdüre devredin. Devredilen müdür kabul edip icraya alana kadar talimat "Yetki Devri Bekleniyor" durumunda kalır ve mühlet sayacı duraklar.
        </p>
        <select
          value={delegateTargetId}
          onChange={(e) => setDelegateTargetId(e.target.value)}
          aria-label="Devredilecek müdür"
          className="w-full bg-surface-elevated border border-makam-border/10 rounded-xl px-4 py-3 outline-none text-[13px] font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5"
        >
          <option value="">Müdür Seçiniz</option>
          {delegateCandidates.map(m => (
            <option key={m.uid} value={m.uid}>{m.fullName}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
          <Button variant="secondary" onClick={() => setIsDelegateModalOpen(false)}>İptal</Button>
          <Button
            variant="gold"
            disabled={!delegateTargetId}
            isLoading={isSubmittingDelegate}
            onClick={handleDelegate}
          >
            Devret
          </Button>
        </div>
      </div>
    </Modal>
    </>
  );
};


