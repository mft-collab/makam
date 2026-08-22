import React, { useState, useEffect, useMemo } from 'react';
import { UserPlus, Shield, Mail, Building, Trash2, Edit2, Target, CheckCircle2, AlertTriangle, Activity, ArrowRight, History, Loader2 } from 'lucide-react';
import { User, UserRole, Task, AuditLog, TaskStatus } from '../types';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Modal } from './ui/Modal';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { cn, formatTimeAgo } from '../lib/utils';
import { ROLE_LABELS, STATUS_LABELS } from '../constants';
import { motion } from 'motion/react';
import { auditLogService } from '../services/auditLogService';
import { useUIStore } from '../store/uiStore';
import { AUDIT_FIELD_LABELS, formatAuditValue } from '../lib/auditLabels';
import { roleConfig, OrgNodeCard } from './teamList/subcomponents';
import { Skeleton } from './ui/Skeleton';

interface TeamListProps {
  users: User[];
  tasks: Task[];
  currentUser: User | null;
  onUpdateUser: (userId: string, data: Partial<User>) => void;
  onDeleteUser: (userId: string) => void;
  onAddUser: (data: { email: string; fullName: string; role: UserRole; departmentId?: string }) => void;
  isLoading?: boolean;
}

const TeamListSkeleton = () => (
  <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto" aria-label="Kadro yükleniyor..." role="status">
    <div className="flex items-center justify-between pb-4 border-b border-executive-blue/[0.04]">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-8 w-40" rounded="full" />
    </div>
    <Skeleton className="h-4 w-full" rounded="full" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="makam-card p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11" rounded="full" />
            <div className="flex flex-col gap-2 flex-1">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-5 w-24" rounded="full" />
        </div>
      ))}
    </div>
  </div>
);

export const TeamList = ({ users, tasks, currentUser, onUpdateUser, onDeleteUser, onAddUser, isLoading = false }: TeamListProps) => {
  const addToast = useUIStore(state => state.addToast);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('Staff');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDept, setEditDept] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Staff');
  const [newDept, setNewDept] = useState('');
  const [addUserError, setAddUserError] = useState('');

  const [viewMode, setViewMode] = useState<'grid' | 'tree'>('grid');
  const [modalTab, setModalTab] = useState<'tasks' | 'logs'>('tasks');
  const [userLogs, setUserLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (!selectedUser) {
      setUserLogs([]);
      setModalTab('tasks');
      return;
    }
    const fetchUserLogs = async () => {
      setLoadingLogs(true);
      try {
        // Sunucu tarafında changedBy'a göre filtrelenir (uid VEYA email) —
        // önceki hâli son 80 GLOBAL kaydı çekip istemcide filtreliyordu, az
        // işlem yapan/pasif personelin geçmişi bu yüzden eksik görünebiliyordu.
        const logs = await auditLogService.queryUserLogs(selectedUser.uid, selectedUser.email);
        setUserLogs(logs);
      } catch (error) {
        console.error('Error fetching user logs:', error);
        addToast({ title: '⚠️ Denetim İzi Yüklenemedi', body: 'Personel geçmişi getirilirken bir hata oluştu.', type: 'danger' });
      } finally {
        setLoadingLogs(false);
      }
    };
    fetchUserLogs();
  }, [selectedUser]);

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditName(user.fullName);
    setEditEmail(user.email);
    setEditDept(user.departmentId || '');
    setIsEditModalOpen(true);
  };

  const handleSave = () => {
    if (editingUser) {
      // Firestore kuralları, kullanıcının kendi profilini düzenlerken yalnızca
      // fullName/photoURL/fcmTokens değiştirmesine izin verir — role/email/
      // departmentId yalnızca Admin tarafından değiştirilebilir.
      onUpdateUser(
        editingUser.uid,
        isAdmin
          ? {
              role: editRole,
              fullName: editName.trim(),
              email: editEmail.toLowerCase().trim(),
              departmentId: editDept.trim()
            }
          : { fullName: editName.trim() }
      );
      setIsEditModalOpen(false);
    }
  };

  const handleDeleteClick = (user: User) => {
    setUserToDelete(user);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (userToDelete) {
      onDeleteUser(userToDelete.uid);
      setIsDeleteModalOpen(false);
      setUserToDelete(null);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newName) return;
    const normalizedEmail = newEmail.toLowerCase().trim();
    if (users.some(u => u.email.toLowerCase().trim() === normalizedEmail)) {
      setAddUserError('Bu e-posta adresine sahip bir personel zaten kayıtlı.');
      return;
    }
    onAddUser({
      email: normalizedEmail,
      fullName: newName.trim(),
      role: newRole,
      departmentId: newDept.trim()
    });
    setIsAddModalOpen(false);
    setNewEmail('');
    setNewName('');
    setNewRole('Staff');
    setNewDept('');
    setAddUserError('');
  };

  const isAdmin = currentUser?.role === 'Admin';

  // Kullanıcı başına aktif görev sayısını tek geçişte hesaplayıp Map'te tutar —
  // aksi halde her personel için tasks dizisi ayrı ayrı filtrelenir (O(kullanıcı × görev)
  // yerine burada tek O(görev) geçiş + O(1) lookup).
  const activeTaskCountByUser = useMemo(() => {
    const map = new Map<string, number>();
    const bump = (key: string | undefined) => {
      if (!key) return;
      map.set(key, (map.get(key) ?? 0) + 1);
    };
    for (const t of tasks) {
      if (t.status === 'COMPLETED' || t.status === 'CANCELLED') continue;
      bump(t.assigneeId);
    }
    return map;
  }, [tasks]);

  const getActiveTaskCount = (u: { uid: string; email: string }) =>
    (activeTaskCountByUser.get(u.uid) ?? 0) + (u.email !== u.uid ? (activeTaskCountByUser.get(u.email) ?? 0) : 0);

  const staffUsers = useMemo(() => users.filter(u => u.role === 'Staff'), [users]);

  // Şema (tree) görünümünde her yönetici için ayrı ayrı users.filter()
  // çağırmak yerine (O(yönetici × personel)) departman başına tek geçişte
  // gruplanır (O(personel) + O(1) lookup).
  const staffByDepartment = useMemo(() => {
    const map = new Map<string, User[]>();
    for (const u of users) {
      if (u.role !== 'Staff') continue;
      const key = u.departmentId ?? '';
      const list = map.get(key);
      if (list) list.push(u); else map.set(key, [u]);
    }
    return map;
  }, [users]);

  const independentStaff = useMemo(() => users.filter(u =>
    u.role === 'Staff' && (!u.departmentId || !users.some(m => m.role === 'Manager' && m.departmentId === u.departmentId))
  ), [users]);

  const selectedUserAllTasks = useMemo(() => {
    if (!selectedUser) return [];
    return tasks.filter(t => t.assigneeId === selectedUser.uid || t.assigneeId === selectedUser.email);
  }, [tasks, selectedUser]);

  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  const { capacityPercent, availableStaffCount, overloadedStaffCount } = useMemo(() => {
    let total = 0, available = 0, overloaded = 0;
    for (const u of staffUsers) {
      const count = getActiveTaskCount(u);
      total += count;
      if (count <= 2) available++;
      if (count >= 5) overloaded++;
    }
    const max = Math.max(1, staffUsers.length * 4);
    return {
      capacityPercent: Math.min(100, Math.round((total / max) * 100)),
      availableStaffCount: available,
      overloadedStaffCount: overloaded,
    };
  }, [staffUsers, activeTaskCountByUser]);

  if (isLoading) return <TeamListSkeleton />;

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-executive-blue/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-executive-gold flex items-center justify-center shadow-lg">
            <Building className="w-4 h-4 text-white stroke-[1.5]" />
          </div>
          <div>
            <span className="text-[10px] font-medium text-executive-blue uppercase tracking-[0.4em] block leading-none">KURUMSAL ORGANİZASYON</span>
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">{users.length} Personel</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode switcher toggle */}
          <div className="flex bg-surface-glass p-0.5 rounded-full border border-executive-blue/[0.04] items-center gap-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[8.5px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer",
                viewMode === 'grid' ? "bg-executive-blue text-white shadow-sm" : "text-text-muted hover:text-text-heading"
              )}
            >
              Kadro Listesi
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[8.5px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer",
                viewMode === 'tree' ? "bg-executive-blue text-white shadow-sm" : "text-text-muted hover:text-text-heading"
              )}
            >
              Şema Görünümü
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 px-4 h-9 rounded-full bg-executive-gold text-white text-[9px] font-medium uppercase tracking-[0.3em] shadow-lg shadow-executive-gold/20 hover:shadow-xl hover:bg-executive-gold-hover hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
            >
              <UserPlus className="w-3.5 h-3.5 stroke-[2]" />
              <span className="hidden sm:block">Yeni Kadro</span>
            </button>
          )}
        </div>
      </div>

      {/* Team Capacity Header Band */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold">Kadro Kapasite Endeksi:</span>
          <div className="w-24 h-1.5 bg-executive-blue/5 rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-300",
                capacityPercent >= 85 ? "bg-status-danger" :
                capacityPercent >= 55 ? "bg-status-warning" :
                "bg-status-success"
              )}
              style={{ width: `${capacityPercent}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-text-heading">%{capacityPercent}</span>
        </div>
        <div className="flex gap-4 text-[10px] text-text-muted uppercase tracking-wider font-bold">
          <span>Müsait Kadro: <span className="text-status-success font-bold">{availableStaffCount}</span></span>
          <span>Aşırı Yüklü: <span className={overloadedStaffCount > 0 ? "text-status-danger font-bold animate-pulse" : "text-text-muted font-bold"}>{overloadedStaffCount}</span></span>
        </div>
      </div>

      {/* ── Personnel Cards Grid / Org Tree ─────────────────────── */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {users.map((user, i) => {
            const canEdit = isAdmin || user.uid === currentUser?.uid;
            const userTaskCount = getActiveTaskCount(user);
            const rc = roleConfig[user.role];

            return (
              <motion.div
                key={user.uid}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 28, delay: i * 0.04 }}
                whileHover={{ y: -2, scale: 1.005 }}
                onClick={() => setSelectedUser(user)}
                className="group flex flex-col gap-3 p-4 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl shadow-[0_1px_8px_rgba(22,21,19,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] hover:bg-surface-elevated hover:border-surface-border transition-all duration-300 cursor-pointer relative"
              >
                {/* Action buttons (hover) */}
                {canEdit && (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0 group-focus-within:translate-x-0">
                    <button
                      className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-executive-blue hover:bg-surface-elevated transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
                      onClick={(e) => { e.stopPropagation(); handleEdit(user); }}
                      title="Düzenle"
                      aria-label={`${user.fullName} kaydını düzenle`}
                    >
                      <Edit2 className="w-3 h-3 stroke-[1.5]" />
                    </button>
                    {isAdmin && user.uid !== currentUser?.uid && (
                      <button
                        className="w-7 h-7 flex items-center justify-center bg-makam-glass border border-executive-blue/[0.06] rounded-lg text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
                        onClick={(e) => { e.stopPropagation(); handleDeleteClick(user); }}
                        title="Sil"
                        aria-label={`${user.fullName} kaydını sil`}
                      >
                        <Trash2 className="w-3 h-3 stroke-[1.5]" />
                      </button>
                    )}
                  </div>
                )}

                {/* Top: avatar + name */}
                <div className="flex items-center gap-3">
                  <Avatar
                    name={user.fullName}
                    photoURL={user.photoURL}
                    size="lg"
                    className="group-hover:scale-105 group-hover:rotate-3 transition-all duration-300"
                  />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <h4 className="text-[13px] font-medium text-executive-blue truncate tracking-tight font-serif group-hover:text-executive-blue transition-colors">
                      {user.fullName}
                    </h4>
                    <div className="flex items-center gap-1.5 text-[9px] text-text-tertiary truncate">
                      <Mail className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                      <span className="truncate">{user.email}</span>
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-executive-blue/[0.04]" />

                {/* Bottom: role + dept + active tasks */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border',
                      rc.bg, rc.text, rc.border
                    )}>
                      <Shield className="w-2.5 h-2.5 stroke-[1.5]" />
                      {ROLE_LABELS[user.role]}
                    </span>
                    {user.departmentId && (
                      <span className="inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-surface-glass text-text-tertiary border border-surface-border">
                        <Building className="w-2.5 h-2.5" />
                        {user.departmentId}
                      </span>
                    )}
                  </div>
                  {userTaskCount > 0 && (
                    <span className={cn(
                      "inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border transition-all duration-300",
                      userTaskCount >= 5 ? "bg-status-danger/[0.08] text-status-danger border-status-danger/25 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.15)]" :
                      userTaskCount >= 3 ? "bg-status-warning/[0.08] text-status-warning border-status-warning/25" :
                      "bg-status-success/[0.08] text-status-success border-status-success/25"
                    )}>
                      <Activity className="w-2.5 h-2.5" />
                      {userTaskCount} {userTaskCount >= 5 ? 'Aşırı Yük' : userTaskCount >= 3 ? 'Dengeli' : 'Müsait'}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-12 py-8 overflow-x-auto w-full no-scrollbar select-none bg-makam-glass border border-surface-border rounded-3xl p-6">
          {/* Level 1: Admins */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-[8px] font-bold uppercase tracking-[0.3em] text-status-danger bg-status-danger/10 border border-status-danger/20 px-2.5 py-1 rounded-full">Yönetim Kurulu</span>
            <div className="flex flex-wrap justify-center gap-6 mt-2">
              {users.filter(u => u.role === 'Admin').map(u => (
                <OrgNodeCard key={u.uid} user={u} tasks={tasks} onSelect={setSelectedUser} />
              ))}
            </div>
          </div>

          {/* Connection Line */}
          <div className="w-[1px] h-8 bg-executive-blue/15" />

          {/* Level 2: Managers */}
          <div className="flex flex-col items-center gap-4 w-full">
            <span className="text-[8px] font-bold uppercase tracking-[0.3em] text-executive-blue bg-executive-blue/5 border border-executive-blue/10 px-2.5 py-1 rounded-full">Birim Yöneticileri</span>
            <div className="flex flex-wrap justify-center gap-8 mt-2 w-full">
              {users.filter(u => u.role === 'Manager').map(u => {
                const staffInDept = staffByDepartment.get(u.departmentId ?? '') ?? [];
                return (
                  <div key={u.uid} className="flex flex-col items-center gap-4 bg-executive-blue/[0.01] p-4 rounded-2xl border border-executive-blue/[0.03]">
                    <OrgNodeCard user={u} tasks={tasks} onSelect={setSelectedUser} />
                    {staffInDept.length > 0 && (
                      <>
                        <div className="w-[1px] h-4 bg-executive-blue/10" />
                        <div className="flex flex-wrap justify-center gap-2.5 max-w-[400px]">
                          {staffInDept.map(staff => (
                            <OrgNodeCard key={staff.uid} user={staff} tasks={tasks} onSelect={setSelectedUser} isMini />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Staff without matching department managers */}
          {independentStaff.length > 0 && (
            <>
              <div className="w-[1px] h-8 bg-executive-blue/15" />
              <div className="flex flex-col items-center gap-2">
                <span className="text-[8px] font-bold uppercase tracking-[0.3em] text-text-tertiary bg-surface-glass border border-surface-border px-2.5 py-1 rounded-full">Bağımsız Kadro</span>
                <div className="flex flex-wrap justify-center gap-3 mt-2">
                  {independentStaff.map(u => (
                    <OrgNodeCard key={u.uid} user={u} tasks={tasks} onSelect={setSelectedUser} isMini />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── User Detail Modal ─────────────────────────────────── */}
      <Modal isOpen={!!selectedUser} onClose={() => setSelectedUser(null)} title="Kadro Profili" size="lg">
        {selectedUser && (() => {
          const rc = roleConfig[selectedUser.role];
          const userAllTasks = selectedUserAllTasks;
          const completedTasks = userAllTasks.filter(t => t.status === 'COMPLETED');
          const completedWithSla = completedTasks.filter(t => {
            const totalPaused = t.totalPausedTime || 0;
            const effectiveDeadline = t.deadline + totalPaused;
            const isOverdue = t.completedAt ? t.completedAt > effectiveDeadline : false;
            return !isOverdue;
          });
          const slaSuccessRate = completedTasks.length > 0
            ? Math.round((completedWithSla.length / completedTasks.length) * 100)
            : 100;

          return (
            <div className="flex flex-col gap-5 font-sans">
              {/* Profile header */}
              <div className="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-surface-glass rounded-2xl border border-executive-blue/[0.04]">
                {/* #10 — Avatar (Modal) */}
                <Avatar
                  name={selectedUser.fullName}
                  photoURL={selectedUser.photoURL}
                  size="xl"
                  ring
                  className="rounded-2xl flex-shrink-0"
                />
                <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[18px] font-medium text-executive-blue font-serif tracking-tight truncate">
                      {selectedUser.fullName}
                    </h3>
                    {(isAdmin || selectedUser.uid === currentUser?.uid) && (
                      <button
                        onClick={() => { setSelectedUser(null); handleEdit(selectedUser); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-executive-blue/[0.06] rounded-xl text-[9px] font-medium text-text-muted hover:text-executive-blue hover:bg-surface-glass transition-all shadow-sm flex-shrink-0"
                      >
                        <Edit2 className="w-3 h-3" />
                        Düzenle
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                      <Mail className="w-2.5 h-2.5" />
                      {selectedUser.email}
                    </span>
                    <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                      <Building className="w-2.5 h-2.5" />
                      {selectedUser.departmentId || 'Genel Merkez'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-[8px] font-medium uppercase tracking-[0.25em] px-2 py-0.5 rounded-full border',
                      rc.bg, rc.text, rc.border
                    )}>
                      <Shield className="w-2.5 h-2.5" />
                      {ROLE_LABELS[selectedUser.role]}
                    </span>
                  </div>

                  {/* Operational Score Metrikleri */}
                  <div className="grid grid-cols-2 gap-3 mt-3.5">
                    <div className="p-2.5 bg-makam-glass border border-surface-border rounded-xl flex flex-col gap-0.5">
                      <span className="text-[8px] text-text-tertiary uppercase tracking-wider font-bold">Bitirilen Talimat</span>
                      <span className="text-[13px] font-bold text-executive-blue font-serif">{completedTasks.length} İş</span>
                    </div>
                    <div className="p-2.5 bg-makam-glass border border-surface-border rounded-xl flex flex-col gap-0.5">
                      <span className="text-[8px] text-text-tertiary uppercase tracking-wider font-bold">SLA Uyum Başarısı</span>
                      <span className={cn(
                        "text-[13px] font-bold font-serif",
                        slaSuccessRate >= 80 ? "text-status-success" :
                        slaSuccessRate >= 50 ? "text-status-warning" :
                        "text-status-danger"
                      )}>
                        %{slaSuccessRate}
                      </span>
                    </div>
                  </div>
                  {/* Tab Selector inside profile details */}
                  <div className="flex bg-surface-glass p-0.5 rounded-xl border border-executive-blue/[0.04] items-center gap-0.5 mt-2.5">
                    <button
                      onClick={() => setModalTab('tasks')}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-[9px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer text-center",
                        modalTab === 'tasks' ? "bg-executive-blue text-white shadow-sm" : "text-text-muted hover:text-text-heading"
                      )}
                    >
                      Sorumluluk Alanı
                    </button>
                    <button
                      onClick={() => setModalTab('logs')}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-[9px] uppercase tracking-wider font-bold transition-all duration-300 cursor-pointer text-center",
                        modalTab === 'logs' ? "bg-executive-blue text-white shadow-sm" : "text-text-muted hover:text-text-heading"
                      )}
                    >
                      Denetim İzi
                    </button>
                  </div>
                </div>
              </div>

              {/* Tasks / Logs Tab views */}
              {modalTab === 'tasks' ? (
                <div>
                  <div className="flex items-center gap-2 mb-3 mt-1">
                    <Target className="w-3.5 h-3.5 text-executive-gold" />
                    <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em]">
                      Sorumluluk Alanı — {userAllTasks.length} Talimat
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                    {userAllTasks.length > 0 ? (
                      userAllTasks.map((task, i) => (
                        <motion.div
                          key={task.id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="flex items-center gap-3 p-3 bg-makam-glass border border-surface-border rounded-xl group cursor-pointer hover:bg-surface-elevated hover:shadow-sm transition-all"
                        >
                          <div className={cn(
                            'w-7 h-7 rounded-xl flex items-center justify-center border flex-shrink-0',
                            task.status === 'COMPLETED' ? 'bg-status-success/10 text-status-success border-status-success/20' :
                            task.status === 'BLOCKED'   ? 'bg-status-danger/10 text-status-danger border-status-danger/20' :
                            task.status === 'IN_PROGRESS'? 'bg-executive-blue/5 text-executive-blue border-executive-blue/10' :
                            'bg-surface-glass text-text-tertiary border-surface-border'
                          )}>
                            {task.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.3]" /> :
                             task.status === 'BLOCKED'   ? <AlertTriangle className="w-3.5 h-3.5 stroke-[1.3]" /> :
                             <Activity className="w-3.5 h-3.5 stroke-[1.3]" />}
                          </div>
                          <div className="flex flex-col gap-1.5 flex-1 min-w-0 items-start">
                            <span className="text-[12px] font-medium text-executive-blue line-clamp-1 font-serif tracking-tight">
                              {task.title}
                            </span>
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
                          <span className="text-[9px] text-text-tertiary flex-shrink-0">{formatTimeAgo(task.updatedAt, task.status)}</span>
                        </motion.div>
                      ))
                    ) : (
                      <div className="py-12 flex flex-col items-center justify-center rounded-xl border border-dashed border-executive-blue/[0.05] bg-surface-glass">
                        <CheckCircle2 className="w-8 h-8 text-surface-border/50 stroke-[1] mb-2" />
                        <span className="text-[9px] text-text-tertiary uppercase tracking-[0.35em]">Kayıtlı Talimat Yok</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-3 mt-1">
                    <History className="w-3.5 h-3.5 text-executive-gold" />
                    <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em]">
                      Denetim İzi — {userLogs.length} Kayıt
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                    {loadingLogs ? (
                      <div className="py-12 flex justify-center items-center">
                        <Loader2 className="w-5 h-5 animate-spin text-executive-blue" />
                      </div>
                    ) : userLogs.length > 0 ? (
                      userLogs.map((log, i) => {
                        const relatedTask = tasksById.get(log.taskId);
                        const hasChanges = log.changes && Object.keys(log.changes).length > 0;

                        return (
                          <motion.div
                            key={log.id}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="flex flex-col gap-2 p-3 bg-makam-glass border border-surface-border rounded-xl"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-executive-blue truncate max-w-[220px] font-serif">
                                {relatedTask?.title || 'Bilinmeyen Talimat'}
                              </span>
                              <span className="text-[8px] text-text-tertiary font-mono">
                                {new Date(log.timestamp).toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            
                            {hasChanges ? (
                              <div className="flex flex-col gap-1 pl-1 border-l border-executive-blue/10">
                                {Object.entries(log.changes!).map(([field, change]) => {
                                  const label = AUDIT_FIELD_LABELS[field] ?? field;
                                  return (
                                    <div key={field} className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[7.5px] font-medium text-text-tertiary uppercase tracking-[0.2em] bg-surface-glass px-1 py-0.5 rounded border border-surface-border">
                                        {label}
                                      </span>
                                      <span className="text-[8.5px] text-text-tertiary line-through">{formatAuditValue(field, change.old)}</span>
                                      <ArrowRight className="w-2 h-2 text-text-tertiary flex-shrink-0" />
                                      <span className="text-[8.5px] font-medium text-executive-blue">{formatAuditValue(field, change.new)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[7.5px] font-medium text-text-tertiary uppercase tracking-[0.2em] bg-surface-glass px-1 py-0.5 rounded border border-surface-border">Durum</span>
                                <Badge variant={
                                  log.newValue === 'COMPLETED' ? 'success' :
                                  log.newValue === 'BLOCKED' ? 'danger' :
                                  log.newValue === 'IN_PROGRESS' ? 'info' :
                                  log.newValue === 'AWAITING_APPROVAL' ? 'warning' :
                                  'default'
                                }>
                                  {STATUS_LABELS[log.newValue as TaskStatus] ?? String(log.newValue)}
                                </Badge>
                              </div>
                            )}
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="py-12 flex flex-col items-center justify-center rounded-xl border border-dashed border-executive-blue/[0.05] bg-surface-glass">
                        <History className="w-8 h-8 text-surface-border/50 stroke-[1] mb-2" />
                        <span className="text-[9px] text-text-tertiary uppercase tracking-[0.35em]">Kayıtlı İşlem Yok</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ── Add User Modal ────────────────────────────────────── */}
      <Modal isOpen={isAddModalOpen} onClose={() => { setIsAddModalOpen(false); setAddUserError(''); }} title="Yeni Kadro Tanımla">
        <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
          {addUserError && (
            <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
              <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-status-danger font-semibold uppercase tracking-[0.1em] leading-relaxed">{addUserError}</p>
            </div>
          )}
          <Input label="Tam İsim" placeholder="Örn: Ali Yılmaz" value={newName} onChange={(e) => setNewName(e.target.value)} required />
          <Input label="E-posta" placeholder="orn@makam.com" type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setAddUserError(''); }} required />
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em] px-0.5">Yetki Seviyesi</label>
            <Select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} options={[
              { value: 'Staff', label: ROLE_LABELS.Staff },
              { value: 'Manager', label: ROLE_LABELS.Manager },
              { value: 'Admin', label: ROLE_LABELS.Admin }
            ]} />
          </div>
          <Input label="Departman / Birim" placeholder="Örn: Operasyon" value={newDept} onChange={(e) => setNewDept(e.target.value)} />
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" type="button" onClick={() => { setIsAddModalOpen(false); setAddUserError(''); }}>İptal</Button>
            <Button type="submit">Kadroyu Onayla</Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit User Modal ───────────────────────────────────── */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Kadro Revizyonu">
        <div className="flex flex-col gap-4">
          <Input label="Tam İsim" value={editName} onChange={(e) => setEditName(e.target.value)} required />
          {isAdmin ? (
            <>
              <Input label="E-posta" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.35em] px-0.5">Yetki Seviyesi</label>
                <Select value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)} options={[
                  { value: 'Staff', label: ROLE_LABELS.Staff },
                  { value: 'Manager', label: ROLE_LABELS.Manager },
                  { value: 'Admin', label: ROLE_LABELS.Admin }
                ]} />
              </div>
              <Input label="Departman / Birim" value={editDept} onChange={(e) => setEditDept(e.target.value)} />
            </>
          ) : (
            <div className="flex items-start gap-2 p-2.5 bg-surface-glass border border-surface-border rounded-xl">
              <Shield className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-text-tertiary font-medium uppercase tracking-[0.15em] leading-relaxed">
                E-posta, yetki seviyesi ve departman yalnızca Admin tarafından değiştirilebilir.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>İptal</Button>
            <Button onClick={handleSave}>Güncelle</Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Modal ──────────────────────────────────────── */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Kadrodan Çıkar">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted font-light leading-relaxed">
            <strong className="text-status-danger font-medium">{userToDelete?.fullName}</strong> isimli personeli dizgeden çıkarmak istediğinize emin misiniz?
          </p>
          {userToDelete && (() => {
            const activeTaskCount = tasks.filter(t =>
              (t.assigneeId === userToDelete.uid || t.assigneeId === userToDelete.email) &&
              t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
            ).length;
            return activeTaskCount > 0 ? (
              <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                <AlertTriangle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-status-danger font-semibold uppercase tracking-[0.1em] leading-relaxed">
                  Bu personelin üzerinde {activeTaskCount} aktif talimat var. Silme işleminden sonra bu talimatlar sahipsiz kalacaktır — devam etmeden önce sorumluluğu başka bir personele devretmeniz önerilir.
                </p>
              </div>
            ) : null;
          })()}
          <div className="flex justify-end gap-2.5 pt-4 border-t border-executive-blue/[0.04]">
            <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>İptal</Button>
            <Button variant="danger" onClick={confirmDelete}>Dizgeden Çıkar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
