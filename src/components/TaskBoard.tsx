import React, { useState, useMemo } from 'react';
import { Plus, Search, Layers, Clock, ArrowRight, CheckCircle2, AlertTriangle, AlertCircle, ShieldCheck, Zap, Info, Filter, X } from 'lucide-react';
import { Task, User, TaskStatus } from '../types';
import { cn } from '../lib/utils';
import { STATUS_LABELS, PRIORITY_LABELS } from '../constants';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { motion } from 'motion/react';
import { Avatar } from './ui/Avatar';
import { TaskCardSkeleton } from './ui/Skeleton';
import { Badge } from './ui/Badge';
import { useDataStore } from '../store/dataStore';

interface TaskBoardProps {
  tasks: Task[];
  users: User[];
  currentUser: User | null;
  onAddTask: () => void;
  onViewTask: (task: Task) => void;
  onUpdateTaskStatus?: (taskId: string, newStatus: TaskStatus) => void;
  /** Firestore'dan ilk veri yüklenene kadar true */
  isLoading?: boolean;
}

export const TaskBoard = ({
  tasks, users, currentUser,
  onAddTask, onViewTask, onUpdateTaskStatus,
  isLoading = false,
}: TaskBoardProps) => {
  const [search, setSearch] = useState('');
  const [showSubtasks, setShowSubtasks] = useState(true);
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('All');
  // #12 — Durum filtresi
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const { loadMoreTasks, taskLimit } = useDataStore();

  const filteredTasks = useMemo(() => tasks.filter(task => {
    // #12 — Genişletilmiş arama: başlık, açıklama, sorumlu adı, durum
    const assignee = users.find(u => u.uid === task.assigneeId || u.email === task.assigneeId);
    const statusLabel = STATUS_LABELS[task.status]?.toLowerCase() ?? '';
    const searchLower = search.toLowerCase();
    const matchesSearch = !search.trim() || [
      task.title,
      task.description,
      assignee?.fullName ?? '',
      assignee?.departmentId ?? '',
      statusLabel,
    ].some(field => field.toLowerCase().includes(searchLower));

    const isTopLevel = !task.parentId;
    const isAssignedToMe = task.assigneeId === currentUser?.uid || task.assigneeId === currentUser?.email;
    const isVisible = showSubtasks || isTopLevel || isAssignedToMe;
    const matchesPriority = priorityFilter === 'All' || task.priority === priorityFilter;
    const matchesAssignee = assigneeFilter === 'All' || task.assigneeId === assigneeFilter || (users.find(u => u.uid === assigneeFilter)?.email === task.assigneeId);
    const matchesStatus   = statusFilter   === 'All' || task.status === statusFilter;

    // NOT: Rol bazlı ek bir kısıtlama burada uygulanmıyor — `tasks` prop'u zaten
    // Firestore kurallarınca departman bazlı filtrelenmiş geliyor (Manager kendi
    // departmanının tamamını görebilir, Dashboard ile aynı kapsam). Manager'ı
    // yalnızca "bana atanan/benim oluşturduğum" ile sınırlamak departman gözetimi
    // rolünü işlevsiz kılardı.
    return matchesSearch && isVisible && matchesPriority && matchesAssignee && matchesStatus;
  }), [tasks, search, currentUser, showSubtasks, priorityFilter, assigneeFilter, statusFilter, users]);

  const hasActiveFilter = priorityFilter !== 'All' || assigneeFilter !== 'All' || statusFilter !== 'All' || search !== '';

  return (
    <div className="flex flex-col gap-4 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-executive-blue/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-executive-blue flex items-center justify-center shadow-lg">
            <Layers className="w-4 h-4 text-white stroke-[1.5]" />
          </div>
          <div>
            <span className="text-[10px] font-semibold text-executive-blue uppercase tracking-[0.22em] block leading-none">
              OPERASYONEL DENETİM
            </span>
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.18em]">
              {filteredTasks.length} Talimat
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtask toggle — compact pill */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-full px-3 h-9 shadow-sm">
            <Layers className={cn('w-3.5 h-3.5 stroke-[1.5] transition-colors', showSubtasks ? 'text-executive-blue' : 'text-text-tertiary')} />
            <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.25em] hidden sm:block">Alt Talimatlar</span>
            <button
              onClick={() => setShowSubtasks(!showSubtasks)}
              className={cn(
                'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300',
                showSubtasks ? 'bg-executive-blue' : 'bg-slate-200'
              )}
            >
              <span className={cn(
                'pointer-events-none inline-block h-3 w-3 rounded-full bg-surface-elevated shadow-sm ring-0 transition duration-300',
                showSubtasks ? 'translate-x-3' : 'translate-x-0'
              )} />
            </button>
          </div>

          {/* Add task button */}
          <button
            onClick={onAddTask}
            className="flex items-center gap-1.5 px-4 h-9 rounded-full bg-executive-gold text-white text-[9px] font-semibold uppercase tracking-[0.16em] shadow-lg shadow-executive-gold/15 hover:shadow-xl hover:bg-executive-gold-hover hover:scale-[1.01] active:scale-[0.98] transition-all duration-300"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2]" />
            <span className="hidden sm:block">Yeni Operasyon</span>
            <span className="sm:hidden">Yeni</span>
          </button>
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border p-2.5 rounded-2xl shadow-sm">
        {/* Search */}
        <div className="relative flex-[1_1_100%] sm:flex-1 sm:min-w-[200px] group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary group-focus-within:text-executive-blue transition-colors stroke-[1.5]" />
          <input
            placeholder="Ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 h-8 bg-makam-glass border border-executive-blue/[0.05] rounded-xl focus:ring-4 focus:ring-executive-blue/[0.04] focus:border-executive-blue/20 transition-all text-[12px] font-light text-executive-blue placeholder:text-text-tertiary outline-none"
          />
        </div>

        {/* Priority filter */}
        <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-1 sm:flex-none">
          <Filter className="w-3 h-3 text-text-tertiary stroke-[1.5]" />
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-transparent border-none text-[9px] font-medium text-text-muted uppercase tracking-[0.12em] sm:tracking-[0.25em] focus:ring-0 cursor-pointer outline-none min-w-0 w-full"
          >
            <option value="All">TÜM ÖNCELİKLER</option>
            {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* #12 — Durum filtresi */}
        <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-1 sm:flex-none">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-transparent border-none text-[9px] font-medium text-text-muted uppercase tracking-[0.12em] sm:tracking-[0.25em] focus:ring-0 cursor-pointer outline-none min-w-0 w-full"
          >
            <option value="All">TÜM DURUMLAR</option>
            {Object.entries(STATUS_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* Assignee filter */}
        <div className="flex items-center gap-2 bg-makam-glass px-2.5 sm:px-3 rounded-xl border border-executive-blue/[0.05] h-8 min-w-0 flex-1 sm:flex-none">
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="bg-transparent border-none text-[9px] font-medium text-text-muted uppercase tracking-[0.12em] sm:tracking-[0.25em] focus:ring-0 cursor-pointer outline-none min-w-0 w-full"
          >
            <option value="All">TÜM SORUMLULAR</option>
            {users.map(u => (
              <option key={u.uid} value={u.uid}>{u.fullName.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {hasActiveFilter && (
          <button
            onClick={() => { setPriorityFilter('All'); setAssigneeFilter('All'); setStatusFilter('All'); setSearch(''); }}
            className="text-[9px] font-medium text-red-400 hover:text-red-600 px-3 uppercase tracking-[0.12em] sm:tracking-[0.25em] transition-colors h-8 flex items-center justify-center gap-1 flex-1 sm:flex-none"
          >
            <X className="w-3 h-3" /> Sıfırla
          </button>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.1 }}
        className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl overflow-hidden shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
      >
        {/* Mobile card list for xs screens */}
        <div className="sm:hidden divide-y divide-[#161513]/[0.03]">
          {isLoading ? (
            <div className="flex flex-col gap-3 p-3">
              {[...Array(5)].map((_, i) => <TaskCardSkeleton key={i} />)}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="py-16 text-center text-[10px] text-text-tertiary uppercase tracking-[0.4em]">
              Kayıt bulunamadı
            </div>
          ) : (
            filteredTasks.map((task, i) => {
              const assignee = users.find(u => u.uid === task.assigneeId || u.email === task.assigneeId);
              const isCrisis = task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && Date.now() > task.deadline;
              return (
                // #9 — Swipe gesture: sola = Tamamlandı, sağa = Engellendi
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 30, delay: i * 0.03 }}
                  drag="x"
                  dragConstraints={{ left: -80, right: 80 }}
                  dragElastic={0.3}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -60 && onUpdateTaskStatus && task.status !== 'COMPLETED') {
                      onUpdateTaskStatus(task.id, 'COMPLETED');
                    } else if (info.offset.x > 60 && onUpdateTaskStatus && task.status !== 'BLOCKED') {
                      onUpdateTaskStatus(task.id, 'BLOCKED');
                    }
                  }}
                  onClick={() => onViewTask(task)}
                  className={cn(
                    'flex items-start gap-3 p-3.5 cursor-pointer hover:bg-makam-glass transition-all group relative overflow-hidden',
                    isCrisis && 'bg-red-50/30'
                  )}
                >
                  {/* Swipe hint bg */}
                  <div className="absolute inset-0 -z-10 flex">
                    <div className="flex-1 bg-emerald-50 opacity-0 group-active:opacity-100 transition-opacity" />
                    <div className="flex-1 bg-red-50 opacity-0 group-active:opacity-100 transition-opacity" />
                  </div>
                  {/* Status dot */}
                  <div className={cn(
                    'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
                    task.status === 'COMPLETED'       ? 'bg-emerald-500' :
                    task.status === 'BLOCKED'         ? 'bg-red-500' :
                    task.status === 'AWAITING_APPROVAL'? 'bg-executive-gold' :
                    task.status === 'IN_PROGRESS'     ? 'bg-executive-blue' :
                    'bg-slate-300'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-executive-blue line-clamp-1 tracking-tight font-serif group-hover:text-executive-blue">
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1 min-w-0">
                      <span className="text-[9px] text-text-tertiary truncate min-w-0">{assignee?.fullName || 'Atanmamış'}</span>
                      <span className={cn(
                        'text-[8px] font-medium uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md whitespace-nowrap flex-shrink-0',
                        isCrisis ? 'bg-red-50 text-red-500' : 'bg-[#F5F3EF] text-text-tertiary'
                      )}>
                        {isCrisis ? 'SLA İhlali' : format(task.deadline, 'd MMM', { locale: tr })}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-executive-blue mt-1 flex-shrink-0" />
                </motion.div>
              );
            })
          )}
        </div>

        {/* Desktop / tablet table */}
        <div className="hidden sm:block overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F5F3EF]/50 border-b border-executive-blue/[0.04]">
                {['Durum', 'Operasyon Tanımı', 'Sorumlu', 'Önem', 'Mühlet', ''].map(h => (
                  <th key={h} className={cn(
                    'px-4 py-3 text-[8px] font-semibold text-text-tertiary uppercase tracking-[0.18em]',
                    h === '' && 'text-right'
                  )}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#161513]/[0.03]">
              {isLoading ? (
                [...Array(7)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(6)].map((__, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <div className="h-3 bg-executive-blue/[0.04] rounded-lg" style={{ width: j === 1 ? '60%' : j === 5 ? '40px' : '80px' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-[10px] text-text-tertiary uppercase tracking-[0.22em]">
                    Kayıtlı veri bulunamadı.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task, i) => {
                  const assignee = users.find(u => u.uid === task.assigneeId || u.email === task.assigneeId);
                  const isCrisis = task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && Date.now() > task.deadline;
                  return (
                    <motion.tr
                      layoutId={`task-card-${task.id}`}
                      key={task.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.025 }}
                      className={cn(
                        'group cursor-pointer transition-all duration-300 hover:bg-makam-glass',
                        isCrisis && 'bg-red-50/20'
                      )}
                      onClick={() => onViewTask(task)}
                    >
                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            task.status === 'COMPLETED' ? 'success' :
                            task.status === 'BLOCKED' ? 'danger' :
                            task.status === 'AWAITING_APPROVAL' ? 'warning' :
                            task.status === 'IN_PROGRESS' ? 'primary' : 'info'
                          }
                          withPulse={task.status === 'BLOCKED'}
                          icon={
                            task.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.3]" /> :
                            task.status === 'BLOCKED' ? <AlertTriangle className="w-3.5 h-3.5 stroke-[1.3]" /> :
                            task.status === 'AWAITING_APPROVAL' ? <ShieldCheck className="w-3.5 h-3.5 stroke-[1.3]" /> :
                            task.status === 'IN_PROGRESS' ? <Zap className="w-3.5 h-3.5 stroke-[1.3]" /> :
                            <Info className="w-3.5 h-3.5 stroke-[1.3]" />
                          }
                        >
                          {STATUS_LABELS[task.status]}
                        </Badge>
                      </td>

                      {/* Title + description */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5 max-w-[320px]">
                          <span className="text-[13px] font-medium text-executive-blue group-hover:text-executive-blue tracking-tight font-serif line-clamp-1">
                            {task.title}
                          </span>
                          <span className="text-[10px] text-text-tertiary font-light line-clamp-1">{task.description}</span>
                        </div>
                      </td>

                      {/* Assignee */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* #10 — Avatar */}
                          <Avatar
                            name={assignee?.fullName ?? '?'}
                            photoURL={assignee?.photoURL}
                            size="xs"
                          />
                          <span className="text-[11px] font-normal text-executive-blue tracking-tight whitespace-nowrap">
                            {assignee?.fullName || 'Atanmamış'}
                          </span>
                        </div>
                      </td>

                      {/* Priority */}
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            task.priority === 'Urgent' ? 'danger' :
                            task.priority === 'High' ? 'warning' :
                            task.priority === 'Medium' ? 'primary' : 'default'
                          }
                          icon={
                            task.priority === 'Urgent' ? <AlertCircle className="w-2.5 h-2.5 stroke-[1.5]" /> :
                            task.priority === 'High' ? <AlertTriangle className="w-2.5 h-2.5 stroke-[1.5]" /> :
                            <Zap className="w-2.5 h-2.5 stroke-[1.5]" />
                          }
                        >
                          {PRIORITY_LABELS[task.priority]}
                        </Badge>
                      </td>

                      {/* Deadline */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <Clock className={cn('w-3 h-3 stroke-[1.2]', isCrisis ? 'text-red-500 animate-pulse' : 'text-text-tertiary')} />
                            <span className={cn('text-[11px] font-light tabular-nums tracking-tight', isCrisis ? 'text-red-600' : 'text-executive-blue')}>
                              {format(task.deadline, 'd MMM yyyy', { locale: tr })}
                            </span>
                          </div>
                          {isCrisis && <span className="text-[8px] font-medium text-red-500 uppercase tracking-[0.2em]">SLA İhlali</span>}
                        </div>
                      </td>

                      {/* Arrow */}
                      <td className="px-4 py-3 text-right">
                        <button className="w-7 h-7 rounded-full bg-makam-glass border border-executive-blue/[0.05] flex items-center justify-center text-text-tertiary group-hover:bg-executive-gold group-hover:text-white group-hover:border-transparent transition-all duration-300 shadow-sm ml-auto">
                          <ArrowRight className="w-3 h-3 stroke-[2]" />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Daha Fazla Yükle Butonu */}
      {tasks.length >= taskLimit && (
        <div className="flex justify-center mt-4">
          <button
            onClick={loadMoreTasks}
            className="px-6 py-2 bg-makam-glass backdrop-blur-xl border border-executive-blue/10 rounded-full text-[10px] font-medium text-executive-blue uppercase tracking-widest hover:bg-executive-blue hover:text-white transition-all shadow-sm"
          >
            Daha Fazla Görev Yükle
          </button>
        </div>
      )}
    </div>
  );
};
