/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, updateDoc, onSnapshot, writeBatch
} from './firebase';
import { User, Task } from './types';
import { motion, AnimatePresence } from 'motion/react';

// UI Components
import { Sidebar } from './components/Sidebar';
import { Login } from './components/Login';

// Lazy loaded routes (tabs)
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const TaskBoard = lazy(() => import('./components/TaskBoard').then(m => ({ default: m.TaskBoard })));
const BlockerList = lazy(() => import('./components/BlockerList').then(m => ({ default: m.BlockerList })));
const TeamList = lazy(() => import('./components/TeamList').then(m => ({ default: m.TeamList })));
const AuditLogList = lazy(() => import('./components/AuditLogList').then(m => ({ default: m.AuditLogList })));
const Reports = lazy(() => import('./components/Reports').then(m => ({ default: m.Reports })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
import { Modal } from './components/ui/Modal';
import { TaskFormModal } from './components/TaskFormModal';
import { TaskDetails } from './components/TaskDetails';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationPrompt } from './components/NotificationPrompt';
import { ExecutiveToast } from './components/ExecutiveToast';
import { ReloadPrompt } from './components/ReloadPrompt';
import { Logo } from './components/Logo';
import { MobileDock } from './components/MobileDock';
import { OfflineBanner } from './components/OfflineBanner';
import { AppHeader } from './components/AppHeader';
import { NotificationPanel } from './components/NotificationPanel';
import { CertificateModal } from './components/CertificateModal';
import { WarningModal } from './components/WarningModal';

// Services & Hooks
import { notificationService } from './services/notificationService';
import { conflictDetectionService } from './services/conflictDetectionService';
import { logError } from './services/errorLoggingService';
import { useAppHandlers } from './services/useAppHandlers';
import { useFirestoreData } from './hooks/useFirestoreData';
import { useNotifications } from './hooks/useNotifications';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { useSLASync } from './hooks/useSLASync';
import { useIdleTimer } from './hooks/useIdleTimer';
import { useSelfHealing } from './hooks/useSelfHealing';
import { useUIStore, type ToastItem } from './store/uiStore';

function getOperationalErrorToast(error: unknown): Omit<ToastItem, 'id'> {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const errorMsg = error instanceof Error ? error.message : String(error);
  const normalized = `${errorCode} ${errorMsg}`.toLowerCase();

  if (normalized.includes('auth/unauthorized-domain')) {
    const currentDomain = typeof window !== 'undefined' ? window.location.hostname : 'bu domain';

    return {
      title: 'Giriş Domaini Yetkisiz',
      body: `Firebase Authentication ayarlarında "${currentDomain}" yetkili domain olarak tanımlı olmalı. Console > Authentication > Settings > Authorized domains listesini kontrol edin.`,
      type: 'warning'
    };
  }

  return {
    title: 'Sistem Hatası',
    body: `Hata: ${errorMsg}`,
    type: 'danger'
  };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedTask, setFetchedTask] = useState<Task | null>(null);
  const [activeCertificateTask, setActiveCertificateTask] = useState<Task | null>(null);
  const [activeWarningTask, setActiveWarningTask] = useState<Task | null>(null);

  const notifRef = useRef<HTMLDivElement>(null);
  const isLoggingOutRef = useRef(false);
  const tasksRef = useRef<Task[]>([]);
  const usersRef = useRef<User[]>([]);

  // ─── uiStore ─────────────────────────────────────────────────────────────
  const {
    activeTab, setActiveTab,
    toasts, addToast, removeToast,
    isCreateModalOpen, setIsCreateModalOpen,
    isEditModalOpen, setIsEditModalOpen,
    parentTaskId, setParentTaskId,
    initialTitle, setInitialTitle,
    selectedTaskId, setSelectedTaskId,
    showNotifications, setShowNotifications,
    theme,
  } = useUIStore();

  // ─── Tema Uygulama ────────────────────────────────────────────────────────
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);

      const listener = (e: MediaQueryListEvent) => {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      };
      
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    } else {
      root.classList.add(theme);
      return undefined;
    }
  }, [theme]);

  // Close notification panel when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotifications, setShowNotifications]);
  
  // Tab yetki kontrolü (Güvenlik Duvarı)
  useEffect(() => {
    if (!user) return;
    const allowedRoles: Record<string, string[]> = {
      dashboard: ['Admin', 'Manager', 'Staff'],
      tasks: ['Admin', 'Manager', 'Staff'],
      blockers: ['Admin', 'Manager'],
      reports: ['Admin'],
      team: ['Admin', 'Manager'],
      audit: ['Admin'],
      settings: ['Admin'],
    };
    const allowed = allowedRoles[activeTab];
    if (allowed && !allowed.includes(user.role)) {
      console.warn(`[Security] Yetkisiz ekran erişimi engellendi (${activeTab}). Harekat Merkezi'ne yönlendiriliyor.`);
      setActiveTab('dashboard');
    }
  }, [activeTab, user, setActiveTab]);

  // ─── Firestore hata yöneticisi ────────────────────────────────────────────
  const handleFirestoreError = useCallback((error: unknown, operationType: string, path: string | null) => {
    const errorMsg = error instanceof Error ? error.message : String(error);

    const isPermissionError = errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('yetki');
    if (isPermissionError && (isLoggingOutRef.current || !auth.currentUser)) {
      console.warn('[Auth] Logout sonrası izin hatası yoksayıldı:', errorMsg);
      return;
    }

    // İyimser Kilitleme Çakışma Tespiti (VERSION_MISMATCH)
    if (errorMsg.includes('VERSION_MISMATCH') && path && path.startsWith('tasks/')) {
      const taskId = path.split('/')[1] || '';
      const task = tasksRef.current.find(t => t.id === taskId);
      const taskTitle = task?.title || 'Seçili Talimat';
      
      const match = errorMsg.match(/Beklenen Versiyon (\d+), Sunucu Versiyonu (\d+)/);
      const expectedVersion = match ? parseInt(match[1]!) : 0;
      
      conflictDetectionService.detectConflict(error, taskId, taskTitle, expectedVersion);
      return; // UI'da çakışma uyarısı tetiklendi, ek sistem hatası toast'ına gerek yok
    }

    console.error(`[Firestore] ${operationType} on "${path}" failed:`, errorMsg);
    logError(error, 'firestore', { operationType, path: path ?? undefined });

    addToast(getOperationalErrorToast(error));
  }, [addToast]);

  // ─── Offline kuyruk ───────────────────────────────────────────────────────
  const {
    isOffline,
    queueLength: offlineQueueLength,
    pendingMutations: offlineMutations,
  } = useOfflineQueue();

  // SLA konfigürasyon senkronizasyonu (Firestore → localStorage)
  useSLASync(user);

  const { tasks: firestoreTasks, users, blockers: firestoreBlockers, isLoading: isDataLoading } = useFirestoreData(user, handleFirestoreError);

  // Derived tasks state — offline queue üzerine Firestore verisi
  const tasks = (() => {
    let result = [...firestoreTasks];
    offlineMutations.forEach(mutation => {
      if (mutation.collectionName === 'tasks') {
        if (mutation.action === 'create') {
          if (!result.some(t => t.id === mutation.data?.id)) result.push(mutation.data);
        } else if (mutation.action === 'update' || mutation.action === 'set') {
          const idx = result.findIndex(t => t.id === mutation.docId);
          if (idx !== -1) result[idx] = { ...result[idx], ...mutation.data };
        } else if (mutation.action === 'delete') {
          result = result.filter(t => t.id !== mutation.docId);
        }
      }
    });
    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  })();

  tasksRef.current = tasks;
  usersRef.current = users;

  // Derived blockers state
  const blockers = (() => {
    let result = [...firestoreBlockers];
    offlineMutations.forEach(mutation => {
      if (mutation.collectionName === 'blockers') {
        if (mutation.action === 'create') {
          if (!result.some(b => b.id === mutation.data?.id)) result.push(mutation.data);
        } else if (mutation.action === 'update' || mutation.action === 'set') {
          const idx = result.findIndex(b => b.id === mutation.docId);
          if (idx !== -1) result[idx] = { ...result[idx], ...mutation.data };
        } else if (mutation.action === 'delete') {
          result = result.filter(b => b.id !== mutation.docId);
        }
      }
    });
    return result.filter(b => !b.isResolved);
  })();

  // ─── Global Focus Filter (Birim Odak Filtresi) ───────────────────────────
  const [globalFocusDept, setGlobalFocusDept] = useState<string>('ALL');

  const departments = useMemo(() => {
    const depts = new Set<string>();
    users.forEach(u => {
      if (u.departmentId) depts.add(u.departmentId);
    });
    firestoreTasks.forEach(t => {
      if (t.departmentId) depts.add(t.departmentId);
    });
    return Array.from(depts).sort();
  }, [users, firestoreTasks]);

  const filteredTasksByFocus = useMemo(() => {
    if (globalFocusDept === 'ALL') return tasks;
    return tasks.filter(t => t.departmentId === globalFocusDept);
  }, [tasks, globalFocusDept]);

  const filteredUsersByFocus = useMemo(() => {
    if (globalFocusDept === 'ALL') return users;
    return users.filter(u => u.departmentId === globalFocusDept || u.role === 'Admin');
  }, [users, globalFocusDept]);

  const filteredBlockersByFocus = useMemo(() => {
    if (globalFocusDept === 'ALL') return blockers;
    const focusTaskIds = new Set(filteredTasksByFocus.map(t => t.id));
    return blockers.filter(b => focusTaskIds.has(b.taskId));
  }, [blockers, globalFocusDept, filteredTasksByFocus]);

  // On-demand task fetch (CQRS — lokal listede yoksa)
  useEffect(() => {
    if (!selectedTaskId) { setFetchedTask(null); return; }
    if (tasks.find(t => t.id === selectedTaskId)) { setFetchedTask(null); return; }
    getDoc(doc(db, 'tasks', selectedTaskId))
      .then(snap => setFetchedTask(snap.exists() ? { id: snap.id, ...snap.data() } as Task : null))
      .catch(() => setFetchedTask(null));
  }, [selectedTaskId, tasks]);

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || fetchedTask;

  // ─── Bildirimler ──────────────────────────────────────────────────────────
  const { notifications } = useNotifications(user?.uid ?? null);

  // ─── Toast yardımcıları (geriye dönük uyumluluk için) ────────────────────
  const handleSuccess = useCallback((title: string, body: string, taskId?: string) => {
    addToast({ title, body, type: 'success', taskId });
  }, [addToast]);

  const triggerToast = useCallback((title: string, body: string, type: 'info' | 'success' | 'warning' | 'danger' = 'success', taskId?: string) => {
    addToast({ title, body, type, taskId });
  }, [addToast]);

  // ─── Çakışma Tespiti ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = conflictDetectionService.subscribe((info) => {
      addToast({
        title: '⚠️ Düzenleme Çakışması',
        body: `"${info.taskTitle.slice(0, 40)}" başka bir kullanıcı tarafından güncellendi. Lütfen sayfayı yenileyin.`,
        type: 'warning',
        taskId: info.taskId,
      });
    });
    return unsubscribe;
  }, [addToast]);

  // Auth Listener
  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubscribeUserDoc) { unsubscribeUserDoc(); unsubscribeUserDoc = null; }

      if (firebaseUser) {
        const userEmail = firebaseUser.email?.toLowerCase().trim();

        unsubscribeUserDoc = onSnapshot(doc(db, 'users', firebaseUser.uid), async (userDoc) => {
          if (userDoc.exists()) {
            const userData = userDoc.data() as User;
            if (firebaseUser.photoURL && firebaseUser.photoURL !== userData.photoURL) {
              try {
                await updateDoc(doc(db, 'users', firebaseUser.uid), { photoURL: firebaseUser.photoURL });
              } catch { /* sessizce geç */ }
            }
            setUser({ ...userData, photoURL: firebaseUser.photoURL ?? userData.photoURL });
            setLoading(false);
          } else {
            if (userEmail) {
              try {
                const tempDocRef = doc(db, 'users', userEmail);
                const tempDocSnap = await getDoc(tempDocRef);
                if (tempDocSnap.exists()) {
                  const tempData = tempDocSnap.data();
                  const batch = writeBatch(db);
                  batch.set(doc(db, 'users', firebaseUser.uid), {
                    ...tempData,
                    uid: firebaseUser.uid,
                    photoURL: firebaseUser.photoURL || tempData.photoURL || null,
                  });
                  batch.delete(tempDocRef);
                  await batch.commit();
                  return;
                }
              } catch (migrationErr) {
                console.error('[Migration] Kullanıcı dökümanı taşıma hatası:', migrationErr);
              }
            }
            setLoading(false);
            // Kullanıcı Firestore'da bulunamadı — Login ekranı göster
            setUser(null);
          }
        }, (err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const isPermissionError = errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('yetki');
          if (!(isPermissionError && (isLoggingOutRef.current || !auth.currentUser))) {
            handleFirestoreError(err, 'auth', 'users');
          }
          setLoading(false);
        });
      } else {
        isLoggingOutRef.current = false;
        setUser(null);
        setLoading(false);
      }
    });

    return () => { unsubscribe(); if (unsubscribeUserDoc) unsubscribeUserDoc(); };
  }, [handleFirestoreError]);

  // ─── Periyodik Denetim (Admin) ────────────────────────────────────────────
  useEffect(() => {
    const uid = user?.uid;
    const role = user?.role;
    if (!uid || role !== 'Admin') return;
    
    const runAudit = () => {
      const currentTasks = tasksRef.current;
      const currentUsers = usersRef.current;
      if (currentTasks.length === 0) return;
      const admins = currentUsers.filter(u => u.role === 'Admin');
      if (admins.length === 0) return;
      notificationService.performAudit(currentTasks, admins).catch(console.error);
    };

    // Run audit after a small delay on startup
    const timeout = setTimeout(runAudit, 3000);

    const interval = setInterval(runAudit, 60 * 60 * 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [user?.uid, user?.role]);

  // ─── Self-Healing + Idle Timer ────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    isLoggingOutRef.current = true;
    try { await signOut(auth); }
    catch (err) { isLoggingOutRef.current = false; handleFirestoreError(err, 'auth', 'users'); }
  }, [handleFirestoreError]);

  useSelfHealing({ user, tasks, blockers });
  useIdleTimer({ onIdle: handleLogout, enabled: !!user });

  // ─── Tüm CRUD handler'lar ─────────────────────────────────────────────────
  const {
    updateTaskStatus, createTask, updateTask, deleteTask,
    addBlocker, resolveBlocker, addComment,
    addUser, updateUserRole, deleteUser,
    updateBlocker, deleteBlocker,
  } = useAppHandlers({ user, tasks, blockers, onError: handleFirestoreError });

  // ─── Auth Handlers ────────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) { handleFirestoreError(err, 'auth', 'users'); }
  }, [handleFirestoreError]);

  if (loading) {
    return (
      <div
        className="min-h-screen bg-surface-base flex items-center justify-center font-sans"
        role="status"
        aria-label="Uygulama yükleniyor"
      >
        <div className="flex flex-col items-center gap-12">
          <Logo size="xl" withText={false} />
          <div className="flex flex-col items-center gap-4">
            <span className="text-text-muted font-normal uppercase tracking-[0.6em] text-[11px] animate-pulse">STRATEJİK VERİ BAĞLANTISI</span>
            <div className="w-48 h-[1px] bg-text-muted/15 overflow-hidden relative">
              <motion.div
                className="absolute inset-y-0 w-24 bg-executive-blue"
                animate={{ x: [-100, 200] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <a href="#main-content" className="skip-to-content">Ana içeriğe geç</a>

      <div className="min-h-screen bg-surface-base text-text-body selection:bg-executive-blue/10 font-sans">
        <OfflineBanner isOffline={isOffline} queueLength={offlineQueueLength} />
        {user && <NotificationPrompt userId={user.uid} onComplete={() => {}} />}

        {/* Toast Bölgesi */}
        <div
          aria-label="Bildirimler"
          className="fixed top-12 left-1/2 -translate-x-1/2 z-[150] flex flex-col gap-4 pointer-events-none w-full max-w-md px-6"
        >
          {toasts.map(toast => (
            <ExecutiveToast
              key={toast.id}
              toast={toast}
              onClose={removeToast}
              onClick={(taskId) => taskId && setSelectedTaskId(taskId)}
            />
          ))}
        </div>

        {!user ? (
          <Login onLogin={handleLogin} />
        ) : (
          <>
            <Sidebar user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
            <AppHeader 
              user={user} 
              activeTab={activeTab} 
              notifications={notifications} 
              showNotifications={showNotifications} 
              setShowNotifications={setShowNotifications}
              globalFocusDept={globalFocusDept}
              onGlobalFocusDeptChange={setGlobalFocusDept}
              departments={departments}
            />
            <NotificationPanel showNotifications={showNotifications} setShowNotifications={setShowNotifications} notifRef={notifRef} userUid={user.uid} notifications={notifications} handleSuccess={handleSuccess} setSelectedTaskId={setSelectedTaskId} setActiveTab={setActiveTab} />

            <main id="main-content" className="lg:ml-64 min-h-screen relative z-10 scroll-smooth pb-24 lg:pb-0">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="p-4 lg:p-6"
                >
                  <Suspense fallback={
                    <div className="flex items-center justify-center p-20 min-h-[400px]">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-8 h-8 border-2 border-executive-gold/20 border-t-executive-gold rounded-full animate-spin" />
                        <span className="text-[10px] text-text-muted font-medium uppercase tracking-[0.3em] opacity-50">MODÜL YÜKLENİYOR...</span>
                      </div>
                    </div>
                  }>
                    {activeTab === 'dashboard' && (
                      <Dashboard
                        tasks={filteredTasksByFocus} users={filteredUsersByFocus} user={user}
                        onViewTask={(t) => { setSelectedTaskId(t.id); setActiveTab('tasks'); }}
                        setActiveTab={setActiveTab}
                        isLoading={isDataLoading}
                        isFiltered={globalFocusDept !== 'ALL'}
                      />
                    )}
                    {Boolean(activeTab === 'tasks') && (
                      <TaskBoard
                        tasks={filteredTasksByFocus} users={filteredUsersByFocus} currentUser={user}
                        onAddTask={() => { setParentTaskId(undefined); setIsCreateModalOpen(true); }}
                        onViewTask={(t) => setSelectedTaskId(t.id)}
                        onUpdateTaskStatus={updateTaskStatus}
                        isLoading={isDataLoading}
                      />
                    )}
                    {Boolean(activeTab === 'blockers') && (
                      <BlockerList
                        tasks={filteredTasksByFocus} blockers={filteredBlockersByFocus} users={filteredUsersByFocus}
                        isAdmin={user?.role === 'Admin' || user?.role === 'Manager'}
                        isSystemAdmin={user?.role === 'Admin'}
                        onResolve={resolveBlocker}
                        onEditBlocker={updateBlocker}
                        onDeleteBlocker={deleteBlocker}
                        onViewTask={(t) => { setSelectedTaskId(t.id); setActiveTab('tasks'); }}
                      />
                    )}
                    {Boolean(activeTab === 'team') && (
                      <TeamList
                        users={filteredUsersByFocus} tasks={filteredTasksByFocus} currentUser={user}
                        onUpdateUser={updateUserRole}
                        onDeleteUser={deleteUser}
                        onAddUser={addUser}
                      />
                    )}
                    {Boolean(activeTab === 'reports') && <Reports tasks={filteredTasksByFocus} users={filteredUsersByFocus} blockers={filteredBlockersByFocus} setActiveTab={setActiveTab} />}
                    {Boolean(activeTab === 'audit') && (
                      <AuditLogList
                        tasks={filteredTasksByFocus} users={filteredUsersByFocus}
                      />
                    )}
                    {Boolean(activeTab === 'settings') && (
                      <Settings tasks={tasks} users={users} blockers={blockers} triggerToast={triggerToast} currentUser={user} />
                    )}
                  </Suspense>
                </motion.div>
              </AnimatePresence>
            </main>

            {/* Görev Form Modalı (Yeni / Düzenle) */}
            <Modal
              isOpen={isCreateModalOpen || isEditModalOpen}
              onClose={() => { setIsCreateModalOpen(false); setIsEditModalOpen(false); }}
              title={isEditModalOpen ? "Talimat Güncellemesi" : "Yeni Talimat Tanımla"}
              size="lg"
            >
              <TaskFormModal
                users={users}
                currentUser={user!}
                task={isEditModalOpen && selectedTask ? selectedTask : undefined}
                parentId={parentTaskId}
                initialTitle={initialTitle}
                onSubmit={(data) => {
                  if (isEditModalOpen && selectedTask) updateTask(selectedTask.id, data);
                  else createTask(data);
                }}
                onClose={() => { setIsCreateModalOpen(false); setIsEditModalOpen(false); setParentTaskId(undefined); }}
              />
            </Modal>

            {/* Görev Detay Modalı */}
            <Modal
              isOpen={!!selectedTaskId && !isEditModalOpen && !isCreateModalOpen}
              onClose={() => setSelectedTaskId(null)}
              title="Talimat Detayı & İcra"
              size="xl"
              layoutId={selectedTask ? `task-card-${selectedTask.id}` : undefined}
            >
              {Boolean(selectedTask) && (
                <TaskDetails
                  task={selectedTask!}
                  tasks={tasks}
                  users={users}
                  currentUser={user!}
                  blockers={blockers.filter(b => b.taskId === selectedTask!.id)}
                  onStatusChange={(status, evidence, type) => selectedTask && updateTaskStatus(selectedTask.id, status, evidence, type as any)}
                  onAddBlocker={(reason) => selectedTask && addBlocker(selectedTask.id, reason)}
                  onResolveBlocker={resolveBlocker}
                  onAddSubTask={(parentId, title) => { setParentTaskId(parentId); setInitialTitle(title); setIsCreateModalOpen(true); }}
                  onAddComment={(text) => selectedTask && addComment(selectedTask.id, text)}
                  onViewTask={(t) => setSelectedTaskId(t.id)}
                  onEdit={() => setIsEditModalOpen(true)}
                  onDelete={() => selectedTask && deleteTask(selectedTask.id)}
                  onClearCoordinator={() => selectedTask && updateTask(selectedTask.id, { coordinatorId: undefined })}
                  onShowCertificate={setActiveCertificateTask}
                  onShowWarning={setActiveWarningTask}
                  onUpdateTask={(data) => selectedTask && updateTask(selectedTask.id, data)}
                />
              )}
            </Modal>

            {/* Belgeler - Detay Modalının Dışında */}
            {activeCertificateTask && (
              <CertificateModal
                task={activeCertificateTask}
                assignee={users.find(u => u.uid === activeCertificateTask.assigneeId || u.email === activeCertificateTask.assigneeId)}
                onClose={() => setActiveCertificateTask(null)}
              />
            )}

            {activeWarningTask && (
              <WarningModal
                task={activeWarningTask}
                assignee={users.find(u => u.uid === activeWarningTask.assigneeId || u.email === activeWarningTask.assigneeId)}
                onClose={() => setActiveWarningTask(null)}
              />
            )}

            <MobileDock user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
          </>
        )}
      </div>
      <ReloadPrompt />
    </ErrorBoundary>
  );
}
