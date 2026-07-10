import React, { useState, useMemo, useEffect } from 'react';
import { 
  Calendar, Clock, CheckCircle2, AlertTriangle, User, FileText, 
  ChevronRight, Award, Zap, Activity, Info, ShieldCheck,
  Edit2, Trash2, ArrowRight, MessageSquare, History, ListChecks, Send, Plus,
  GitCommit, Loader2
} from 'lucide-react';
import { Task, User as UserType, TaskBlocker, AuditLog, TaskStatus } from '../types';
import { STATUS_LABELS, ROLE_LABELS, PRIORITY_LABELS } from '../constants';
import { format, formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { Badge } from './ui/Badge';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { db, collection, query, where, getDocs } from '../firebase';

export const TaskDetails = ({ 
  task, tasks, users, currentUser, blockers, 
  onStatusChange, onAddBlocker, onResolveBlocker, 
  onAddSubTask, onAddComment, onViewTask, onEdit, onDelete, onClose,
  onClearCoordinator, onShowCertificate, onShowWarning,
  onUpdateTask
}: { 
  task: Task;
  tasks: Task[];
  users: UserType[];
  currentUser: UserType | null;
  blockers: TaskBlocker[];
  onStatusChange: (status: TaskStatus, evidence?: string, type?: string) => void;
  onAddBlocker: (reason: string) => void;
  onResolveBlocker: (blockerId: string) => void;
  onAddSubTask: (parentId: string, title: string) => void;
  onAddComment: (text: string) => void;
  onViewTask: (task: Task) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onClearCoordinator?: () => void;
  onShowCertificate?: (task: Task) => void;
  onShowWarning?: (task: Task) => void;
  onUpdateTask?: (data: Partial<Task>) => void;
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'checklist' | 'blockers' | 'subtasks' | 'history' | 'comments'>('info');
  const [newComment, setNewComment] = useState('');
  const [blockerReason, setBlockerReason] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');

  const handleAddChecklistItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChecklistItem.trim() || !onUpdateTask) return;
    const currentChecklist = task.checklist || [];
    const newItem = {
      id: Math.random().toString(36).substring(2, 9),
      text: newChecklistItem.trim(),
      isCompleted: false
    };
    onUpdateTask({ checklist: [...currentChecklist, newItem] });
    setNewChecklistItem('');
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

  const checklistStats = useMemo(() => {
    const list = task.checklist || [];
    if (list.length === 0) return { total: 0, completed: 0, percent: 0 };
    const completed = list.filter(item => item.isCompleted).length;
    return {
      total: list.length,
      completed,
      percent: Math.round((completed / list.length) * 100)
    };
  }, [task.checklist]);

  // #4 - Gerçek zamanlı SLA sayacı
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const [localLogs, setLocalLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (activeTab === 'history') {
      const fetchTaskLogs = async () => {
        setLoadingLogs(true);
        try {
          const q = query(
            collection(db, 'audit_logs'),
            where('taskId', '==', task.id)
          );
          const snapshot = await getDocs(q);
          const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
          list.sort((a, b) => b.timestamp - a.timestamp);
          setLocalLogs(list);
        } catch (err) {
          console.error('Failed to fetch task audit logs:', err);
        } finally {
          setLoadingLogs(false);
        }
      };
      fetchTaskLogs();
    }
  }, [activeTab, task.id]);

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

  const subtasks = useMemo(() => tasks.filter(t => t.parentId === task.id), [tasks, task.id]);
  
  // #4 - Canlı SLA hesaplama (totalPausedTime ve pausedAt dahil)
  const getTimeLeft = () => {
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return null;
    
    // Efektif deadline: orijinal deadline + toplam duraklatma süresi
    const totalPaused = task.totalPausedTime || 0;
    const effectiveDeadline = task.deadline + totalPaused;
    
    // Eğer görev şu an duraklatılmış ise (BLOCKED/AWAITING_APPROVAL)
    // kalan süreyi pause anından hesapla
    const pausedAt = task.pausedAt ?? null;
    const referenceTime = pausedAt ? pausedAt : now;
    
    const timeLeftMs = effectiveDeadline - referenceTime;
    const absMs = Math.abs(timeLeftMs);
    const absDays = Math.floor(absMs / 86400000);
    const absHours = Math.floor((absMs % 86400000) / 3600000);
    const absMins = Math.floor((absMs % 3600000) / 60000);
    
    let label: string;
    if (timeLeftMs < 0) {
      label = absDays > 0 ? `${absDays}g ${absHours}s geçti` : absHours > 0 ? `${absHours}s ${absMins}dk geçti` : `${absMins}dk geçti`;
    } else if (absDays > 0) {
      label = `${absDays}g ${absHours}s kaldı`;
    } else if (absHours > 0) {
      label = `${absHours}s ${absMins}dk kaldı`;
    } else {
      label = `${absMins}dk kaldı`;
    }
    
    const isPaused = Boolean(pausedAt);
    return {
      timeLeftMs,
      label: isPaused ? `${label} (Duraklatıldı)` : label,
      status: isPaused ? 'paused' : timeLeftMs < 0 ? 'expired' : timeLeftMs < 86400000 ? 'warning' : 'safe'
    };
  };

  const timeLeft = getTimeLeft();

  const getSLAColor = (status: string) => {
    switch (status) {
      case 'expired': return 'text-red-600';
      case 'warning': return 'text-amber-600';
      case 'paused':  return 'text-text-muted';
      default: return 'text-emerald-600';
    }
  };

  // #5 - Durum akış pipeline sırası
  const STATUS_PIPELINE: TaskStatus[] = useMemo(() => {
    const interruption = task.status === 'BLOCKED' || task.status === 'CRISIS' ? task.status : null;
    return interruption
      ? ['ASSIGNED', 'IN_PROGRESS', interruption, 'AWAITING_APPROVAL', 'COMPLETED']
      : ['ASSIGNED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED'];
  }, [task.status]);
  const currentPipelineIdx = STATUS_PIPELINE.indexOf(task.status);

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    onAddComment(newComment);
    setNewComment('');
  };

  const handleAddBlocker = () => {
    if (!blockerReason.trim()) return;
    onAddBlocker(blockerReason);
    setBlockerReason('');
  };

  const statusBadgeVariant = () => {
    if (task.status === 'COMPLETED') return 'success';
    if (task.status === 'BLOCKED' || task.status === 'CRISIS') return 'danger';
    if (task.status === 'AWAITING_APPROVAL') return 'warning';
    if (task.status === 'IN_PROGRESS') return 'info';
    return 'default';
  };

  return (
    <>
      <div className="flex flex-col gap-4 py-1 font-sans">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
          <Badge
            variant={statusBadgeVariant()}
            withPulse={task.status === 'BLOCKED' || task.status === 'CRISIS'}
            icon={<Activity className="w-3.5 h-3.5" />}
          >
            {STATUS_LABELS[task.status]}
          </Badge>

          <div className="ml-auto flex items-center gap-3">
            {task.status === 'COMPLETED' && task.completedAt && task.completedAt <= task.deadline && (
              <button onClick={() => onShowCertificate?.(task)} className="makam-button bg-makam-glass text-amber-600 border border-amber-100 px-4 py-2 text-[10px] uppercase tracking-widest hover:bg-amber-50 transition-all">
                <Award className="w-4 h-4 mr-2" />
                Liyakat Belgesi
              </button>
            )}
            {task.status === 'COMPLETED' && task.completedAt && task.completedAt > task.deadline && (
              <button onClick={() => onShowWarning?.(task)} className="makam-button bg-red-500/10 text-red-600 border border-red-500/20 px-4 py-2 text-[10px] uppercase tracking-widest hover:bg-red-500/100 hover:text-white transition-all">
                <AlertTriangle className="w-4 h-4 mr-2" />
                İkaz Belgesi
              </button>
            )}
            {(isAdmin || isManager) && (
              <div className="flex items-center bg-makam-glass backdrop-blur-2xl rounded-full p-1 border border-surface-border shadow-sm">
                <button onClick={onEdit} className="px-4 py-2 text-[10px] font-medium text-text-muted hover:text-executive-blue transition-colors uppercase tracking-[0.2em]">
                  <Edit2 className="w-3.5 h-3.5 inline mr-2" />
                  Düzenle
                </button>
                <div className="w-[1px] h-3 bg-makam-border/10 mx-1" />
                <button onClick={onDelete} className="px-4 py-2 text-[10px] font-medium text-text-muted hover:text-red-600 transition-colors uppercase tracking-[0.2em]">
                  <Trash2 className="w-3.5 h-3.5 inline mr-2" />
                  Sil
                </button>
              </div>
            )}
          </div>
        </div>

        <h2 className="text-[18px] font-medium text-executive-blue tracking-tight leading-tight font-display border-l-2 border-[#C5A059]/40 pl-4 py-1">
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
            const labels: Record<string, string> = {
              ASSIGNED: 'Atandı', IN_PROGRESS: 'İşlemde',
              BLOCKED: 'Engel', CRISIS: 'Kriz',
              AWAITING_APPROVAL: 'Onayda', COMPLETED: 'Tamam'
            };
            return (
              <React.Fragment key={status}>
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-500',
                    isCompleted ? 'bg-emerald-500 border-emerald-500 text-white' :
                    isActive && isInterruption ? 'bg-red-500 border-red-500 text-white animate-pulse shadow-lg shadow-red-500/15' :
                    isActive ? 'bg-executive-blue border-executive-blue text-white shadow-lg shadow-executive-blue/20' :
                    'bg-surface-elevated border-slate-200 text-text-tertiary'
                  )}>
                    {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" /> :
                     isActive && isInterruption ? <AlertTriangle className="w-3.5 h-3.5 stroke-[2]" /> :
                     isActive ? <Zap className="w-3.5 h-3.5 stroke-[2]" /> :
                     <span className="text-[8px] font-bold">{idx + 1}</span>}
                  </div>
                  <span className={cn(
                    'text-[7px] font-medium uppercase tracking-[0.2em] whitespace-nowrap',
                    isCompleted ? 'text-emerald-600' :
                    isActive && isInterruption ? 'text-red-600' :
                    isActive ? 'text-executive-blue' : 'text-text-tertiary'
                  )}>{labels[status]}</span>
                </div>
                {idx < STATUS_PIPELINE.length - 1 && (
                  <div className={cn(
                    'flex-1 h-[2px] mx-1 mt-[-10px] rounded-full transition-all duration-500',
                    isCompleted ? 'bg-emerald-400' : 'bg-slate-100'
                  )} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="flex overflow-x-auto no-scrollbar border-b border-makam-border/5 scroll-smooth">
        {[
          { id: 'info', label: 'Detay', icon: Info },
          { id: 'checklist', label: 'Alt İşlemler (Checklist)', icon: ListChecks },
          { id: 'subtasks', label: 'Alt Talimatlar', icon: GitCommit },
          { id: 'blockers', label: 'Engeller', icon: AlertTriangle },
          { id: 'history', label: 'İzleme', icon: History },
          { id: 'comments', label: 'Yorumlar', icon: MessageSquare },
        ].map((tab) => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              'px-6 py-4 text-[10px] font-medium uppercase tracking-[0.3em] transition-all border-b-2 whitespace-nowrap relative flex items-center gap-2', 
              activeTab === tab.id 
                ? 'border-executive-blue text-executive-blue' 
                : 'border-transparent text-text-muted hover:text-text-heading hover:bg-makam-glass'
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {activeTab === 'info' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-4">
                  <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Sorumlu Kadro</h4>
                  <div className="flex flex-col gap-3">
                    {[
                      { u: creator,     l: 'Oluşturan',   ring: 'ring-[#C5A059]/30' },
                      { u: assignee,    l: 'Sorumlu',     ring: 'ring-executive-blue/20' },
                      { u: coordinator, l: 'İrtibatlı',   ring: coordinatorIsAdmin ? 'ring-red-300' : 'ring-emerald-300' }
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
                          <span className="text-[8px] text-text-tertiary font-medium uppercase tracking-[0.25em]">{item.l}</span>
                        </div>
                        {/* Koordinatör Admin ise uyarı + temizle */}
                        {item.l === 'İrtibatlı' && coordinatorIsAdmin && (isAdmin || isManager) && (
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="danger" className="text-[7.5px] px-1.5 py-0.5 font-bold">
                              Hatalı Atama
                            </Badge>
                            <button
                              onClick={onClearCoordinator}
                              className="text-[7px] text-red-500 hover:text-red-700 uppercase tracking-widest font-medium underline transition-colors"
                            >
                              Temizle
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Zaman Yönetimi</h4>
                  <div className="p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-[#C5A059] stroke-[1.3] flex-shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[8px] font-medium text-text-tertiary uppercase tracking-[0.25em]">Bitiş Tarihi</span>
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
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Hızlı Aksiyonlar</h4>
              <div className="p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl flex flex-col gap-2.5">
                {(task.status === 'ASSIGNED' || task.status === 'PENDING_DELEGATION') && (
                  <button 
                    onClick={() => onStatusChange('IN_PROGRESS')}
                    className="makam-button bg-executive-gold text-white w-full h-12 text-[10px] tracking-widest shadow-lg shadow-executive-gold/20 hover:bg-[#B38F46]"
                  >
                    SÜRECİ BAŞLAT
                  </button>
                )}

                {(task.status === 'IN_PROGRESS' || task.status === 'CRISIS') && (
                  <button 
                    onClick={() => onStatusChange(isAdmin ? 'COMPLETED' : 'AWAITING_APPROVAL')}
                    className="makam-button bg-emerald-600 text-white w-full h-12 text-[10px] tracking-widest shadow-lg shadow-emerald-600/10"
                  >
                    {isAdmin ? 'KESİN TAMAMLA' : 'TAMAMLA VE ONAYA SUN'}
                  </button>
                )}

                {task.status === 'AWAITING_APPROVAL' && isAdmin && (
                  <button 
                    onClick={() => onStatusChange('COMPLETED')}
                    className="makam-button bg-executive-gold text-white w-full h-12 text-[10px] tracking-widest shadow-lg shadow-executive-gold/10"
                  >
                    TALİMATI ONAYLA VE KAPAT
                  </button>
                )}

                {task.status === 'BLOCKED' && (
                  <div className="flex flex-col items-center gap-3 py-4 px-2 bg-red-50/30 border border-dashed border-red-200/50 rounded-2xl">
                    <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />
                    <span className="text-[10px] text-red-600 font-medium uppercase tracking-widest text-center">İşlem Engellendi</span>
                    <button 
                      onClick={() => setActiveTab('blockers')}
                      className="text-[9px] text-executive-blue font-bold uppercase tracking-widest hover:underline"
                    >
                      ENGELİ ÇÖZ
                    </button>
                  </div>
                )}

                {(task.status === 'COMPLETED' || task.status === 'CANCELLED') && (
                  <div className="flex flex-col items-center gap-3 py-4 px-2 bg-surface-border/20/50 border border-dashed border-surface-border/50 rounded-2xl">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-[10px] text-text-muted font-medium uppercase tracking-widest">Operasyon Sonlandı</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subtasks' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Operasyonel Alt Birimler</h4>
              <button 
                onClick={() => onAddSubTask(task.id, '')}
                className="flex items-center gap-2 px-4 py-2 bg-executive-gold text-white rounded-full text-[10px] uppercase tracking-widest shadow-lg shadow-executive-gold/20 hover:scale-105 hover:bg-[#B38F46] transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Yeni Alt Talimat
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subtasks.length === 0 ? (
                <div className="md:col-span-2 py-12 flex flex-col items-center justify-center text-text-tertiary uppercase tracking-[0.18em] text-[9px] border border-dashed border-executive-blue/[0.05] rounded-2xl">
                  Alt talimat bulunamadı
                </div>
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
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Aktif Engeller & Riskler</h4>
              <div className="flex flex-col gap-3">
                {blockers.length === 0 ? (
                  <div className="py-20 flex flex-col items-center justify-center text-text-muted/30 uppercase tracking-[0.18em] text-[10px] border border-dashed border-makam-border/10 rounded-2xl">
                    Engel kaydı bulunamadı
                  </div>
                ) : (
                  blockers.map(blocker => (
                    <div key={blocker.id} className={cn(
                      "flex items-center justify-between p-3 rounded-xl border transition-all",
                      blocker.isResolved ? "opacity-50 grayscale bg-makam-glass border-surface-border" : "bg-red-50/20 border-red-100/60"
                    )}>
                      <div className="flex items-center gap-4">
                        <AlertTriangle className={cn("w-5 h-5", blocker.isResolved ? "text-text-muted" : "text-red-500")} />
                        <div className="flex flex-col">
                          <span className="text-[14px] font-medium text-text-heading">{blocker.reason}</span>
                          <span className="text-[9px] text-text-muted uppercase tracking-widest">
                            {format(blocker.createdAt, 'd MMM HH:mm', { locale: tr })}
                          </span>
                        </div>
                      </div>
                      {!blocker.isResolved && (isAdmin || isManager) && (
                        <button 
                          onClick={() => onResolveBlocker(blocker.id)}
                          className="px-4 py-2 bg-emerald-600 text-white rounded-full text-[9px] uppercase tracking-widest"
                        >
                          ÇÖZÜLDÜ
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-makam-border/5">
              <div className="flex gap-2">
                <input 
                  value={blockerReason}
                  onChange={(e) => setBlockerReason(e.target.value)}
                  placeholder="Engeli tanımlayın..."
                  className="flex-1 bg-makam-glass border border-makam-border/10 rounded-full px-5 py-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-red-500/10"
                />
                <button 
                  onClick={handleAddBlocker}
                  disabled={!blockerReason.trim()}
                  className="px-6 py-3 bg-red-600 text-white rounded-full text-[10px] uppercase tracking-widest shadow-lg shadow-red-600/10 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                >
                  ENGEL EKLE
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="flex flex-col gap-4">
            <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Operasyonel Denetim İzleri</h4>
            <div className="flex flex-col gap-3">
              {loadingLogs ? (
                <div className="py-16 flex justify-center items-center">
                  <Loader2 className="w-6 h-6 animate-spin text-executive-blue" />
                </div>
              ) : localLogs.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-text-muted/30 uppercase tracking-[0.18em] text-[10px] border border-dashed border-makam-border/10 rounded-2xl">
                  İzleme kaydı bulunamadı
                </div>
              ) : (
                localLogs.map(log => {
                  const actor = users.find(u => u.uid === log.changedBy || u.email === log.changedBy);
                  // #7 - Audit diff görselleştirmesi
                  const FIELD_LABELS: Record<string, string> = {
                    status: 'Durum', title: 'Başlık', description: 'Açıklama',
                    assigneeId: 'Sorumlu', coordinatorId: 'İrtibatlı',
                    priority: 'Öncelik', deadline: 'Son Tarih', evidence: 'Kanıt'
                  };
                  const hasChanges = log.changes && Object.keys(log.changes).length > 0;
                  return (
                    <div key={log.id} className="flex gap-3 p-3 bg-makam-glass border border-surface-border rounded-xl">
                      <div className="flex-shrink-0 pt-0.5">
                        <Avatar
                          name={actor?.fullName ?? log.changedBy ?? 'Sistem'}
                          photoURL={(actor as any)?.photoURL}
                          size="sm"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-text-heading">
                            {actor?.fullName || log.changedBy || 'Sistem'}
                          </span>
                          <span className="text-[9px] text-text-muted tabular-nums">
                            {format(log.timestamp, 'd MMM HH:mm', { locale: tr })}
                          </span>
                        </div>
                        {/* #7 - Field-level diff */}
                        {hasChanges ? (
                          <div className="flex flex-col gap-1">
                            {Object.entries(log.changes!).map(([field, change]) => {
                              const oldVal = String((change as any).old ?? '-');
                              const newVal = String((change as any).new ?? '-');
                              const label = FIELD_LABELS[field] ?? field;
                              // Durum alanı için STATUS_LABELS kullan
                              const fmtVal = (v: string) =>
                                field === 'status' ? (STATUS_LABELS[v as TaskStatus] ?? v) : v;
                              return (
                                <div key={field} className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[8px] font-medium text-text-tertiary uppercase tracking-[0.2em] bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
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
          <div className="flex flex-col gap-5">
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
                  className="h-full bg-emerald-500 transition-all duration-300 rounded-full" 
                  style={{ width: `${checklistStats.percent}%` }} 
                />
              </div>
            </div>

            {/* Checklist items list */}
            <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto no-scrollbar">
              {(!task.checklist || task.checklist.length === 0) ? (
                <div className="py-16 flex flex-col items-center justify-center text-text-muted/30 uppercase tracking-[0.3em] text-[10px] border border-dashed border-makam-border/10 rounded-2xl gap-3">
                  <ListChecks className="w-8 h-8 opacity-20" />
                  Henüz bir alt işlem eklenmemiş
                </div>
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
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
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
                        className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-red-600 hover:bg-red-500/10 rounded-md opacity-0 group-hover/item:opacity-100 transition-all"
                        title="Alt İşlemi Sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Checklist Add Form */}
            {onUpdateTask && (
              <form onSubmit={handleAddChecklistItem} className="flex gap-2 pt-4 border-t border-makam-border/5">
                <input 
                  type="text"
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder="Yeni bir alt işlem yazın..."
                  className="flex-1 bg-makam-glass border border-makam-border/10 rounded-xl px-4 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-executive-blue/15"
                  required
                />
                <button 
                  type="submit"
                  disabled={!newChecklistItem.trim()}
                  className="px-4 py-2 bg-executive-blue text-white rounded-xl flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider hover:bg-executive-blue/90 disabled:opacity-50 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Ekle
                </button>
              </form>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h4 className="text-[9px] font-medium text-text-muted uppercase tracking-[0.18em]">Yorumlar & Koordinasyon Notları</h4>
              <div className="flex flex-col gap-4 max-h-[400px] overflow-y-auto no-scrollbar pr-2">
                {(!task.comments || task.comments.length === 0) ? (
                  <div className="py-20 flex flex-col items-center justify-center text-text-muted/30 uppercase tracking-[0.18em] text-[10px] border border-dashed border-makam-border/10 rounded-2xl">
                    Henüz yorum girilmemiş
                  </div>
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
                <textarea 
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Bir koordinasyon notu ekleyin..."
                  className="w-full bg-makam-glass border border-makam-border/10 rounded-2xl p-4 pr-16 text-[13px] focus:outline-none focus:ring-2 focus:ring-executive-blue/10 min-h-[100px] resize-none"
                />
                <button 
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                  className="absolute bottom-4 right-4 w-10 h-10 bg-executive-gold text-white rounded-full flex items-center justify-center shadow-lg shadow-executive-gold/25 hover:scale-105 hover:bg-[#B38F46] active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
};


