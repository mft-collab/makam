/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import {
  auth, db, googleProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged,
  doc, getDoc, updateDoc, onSnapshot, writeBatch, isUsingFirebaseEmulator
} from './firebase';
import { User, Task } from './types';
import { TAB_ROLES, type AppTabId } from './constants';
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
// TaskDetails, uygulamanın en büyük bileşenidir (~1000 satır) ve yalnızca bir
// görev detayına tıklandığında Modal içinde render edilir — ilk sayfa
// yüklemesinde hiç gerekli değil. Diğer tüm route/panel ağırlığındaki
// bileşenler (Dashboard/TaskBoard/... yukarıda) lazy() ile yükleniyor,
// bu ikisi de aynı sınır kuralına tabi (bkz. kod denetimi). getPrimaryAction
// ise Modal'ın footer prop'unu SENKRON hesaplamak için kullanılan saf bir
// fonksiyon olduğundan (bir bileşen değil) lazy() arkasına alınamaz —
// zaten küçük olan taskDetails/helpers.ts'ten statik import edilir.
const TaskDetails = lazy(() => import('./components/TaskDetails').then(m => ({ default: m.TaskDetails })));
const TaskDetailsFooter = lazy(() => import('./components/taskDetails/Footer').then(m => ({ default: m.TaskDetailsFooter })));
import { getPrimaryAction } from './components/taskDetails/helpers';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationPrompt } from './components/NotificationPrompt';
import { ExecutiveToast } from './components/ExecutiveToast';
import { ReloadPrompt } from './components/ReloadPrompt';
import { Logo } from './components/Logo';
import { useResolvedTheme } from './hooks/useResolvedTheme';
import { MobileDock } from './components/MobileDock';
import { OfflineBanner } from './components/OfflineBanner';
import { AppHeader } from './components/AppHeader';
import { NotificationPanel } from './components/NotificationPanel';
import { CertificateModal } from './components/CertificateModal';
import { WarningModal } from './components/WarningModal';

// Services & Hooks
import { conflictDetectionService } from './services/conflictDetectionService';
import { logError } from './services/errorLoggingService';
import { useAppHandlers } from './services/useAppHandlers';
import { useFirestoreData, fetchTaskById } from './hooks/useFirestoreData';
import { useNotifications } from './hooks/useNotifications';
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { applyOfflineMutations } from './lib/offlineQueue';
import { useSLASync } from './hooks/useSLASync';
import { useIdleTimer } from './hooks/useIdleTimer';
import { useSelfHealing } from './hooks/useSelfHealing';
import { useUIStore, type ToastItem } from './store/uiStore';
import { useShallow } from 'zustand/react/shallow';

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
    title: 'Dizge Hatası',
    body: `Hata: ${errorMsg}`,
    type: 'danger'
  };
}

export default function App() {
  const resolvedTheme = useResolvedTheme();
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
  // `useShallow` ile yalnızca burada kullanılan alanlar seçilir — aksi halde
  // whole-store `useUIStore()` store'daki İLGİSİZ her alan değişiminde (ör.
  // isOffline, filter, editingTask — bu bileşenin kullanmadığı alanlar) App'in
  // ve altındaki tüm ağacın gereksiz yere yeniden render olmasına yol açardı.
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
  } = useUIStore(useShallow(s => ({
    activeTab: s.activeTab, setActiveTab: s.setActiveTab,
    toasts: s.toasts, addToast: s.addToast, removeToast: s.removeToast,
    isCreateModalOpen: s.isCreateModalOpen, setIsCreateModalOpen: s.setIsCreateModalOpen,
    isEditModalOpen: s.isEditModalOpen, setIsEditModalOpen: s.setIsEditModalOpen,
    parentTaskId: s.parentTaskId, setParentTaskId: s.setParentTaskId,
    initialTitle: s.initialTitle, setInitialTitle: s.setInitialTitle,
    selectedTaskId: s.selectedTaskId, setSelectedTaskId: s.setSelectedTaskId,
    showNotifications: s.showNotifications, setShowNotifications: s.setShowNotifications,
    theme: s.theme,
  })));

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
    const allowed = TAB_ROLES[activeTab as AppTabId];
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
      const serverVersion = match ? parseInt(match[2]!) : undefined;

      conflictDetectionService.detectConflict(error, taskId, taskTitle, expectedVersion, serverVersion);
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

  // Derived tasks/blockers state — offline kuyruktaki bekleyen mutasyonlar
  // Firestore verisinin üzerine bindirilir (bkz. lib/offlineQueue.ts
  // applyOfflineMutations — tasks ve blockers için eskiden burada neredeyse
  // birebir kopyalanmış iki ayrı IIFE vardı, bkz. kod denetimi).
  const tasks = (() => {
    const result = applyOfflineMutations(firestoreTasks, offlineMutations, 'tasks');
    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  })();

  tasksRef.current = tasks;
  usersRef.current = users;

  const blockers = applyOfflineMutations(firestoreBlockers, offlineMutations, 'blockers')
    .filter(b => !b.isResolved);

  // ─── Global Focus Filter (Birim Odak Filtresi) ───────────────────────────
  const [globalFocusDept, setGlobalFocusDept] = useState<string>('ALL');

  // Rol bazlı ilk odak: Yönetici için varsayılan kendi birimidir. Login başına
  // yalnızca bir kez çalışır (ref, uid'i saklar) — Firestore snapshot'ı user
  // referansını yenilediğinde ya da kullanıcı manuel "Tüm Odaklar" seçtiğinde
  // asla geri ezilmez.
  const focusInitializedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.uid || focusInitializedUidRef.current === user.uid) return;
    focusInitializedUidRef.current = user.uid;
    if (user.role === 'Manager' && user.departmentId) {
      setGlobalFocusDept(user.departmentId);
    }
  }, [user]);

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

  // On-demand task fetch (CQRS — lokal listede yoksa). fetchTaskById,
  // useFirestoreData'daki diğer tüm task okumalarıyla AYNI zod doğrulamasından
  // geçer — burada doğrudan getDoc çağırmak bu tek yolu şemasız bırakırdı.
  useEffect(() => {
    if (!selectedTaskId) { setFetchedTask(null); return; }
    if (tasks.find(t => t.id === selectedTaskId)) { setFetchedTask(null); return; }
    fetchTaskById(selectedTaskId)
      .then(setFetchedTask)
      .catch(() => setFetchedTask(null));
  }, [selectedTaskId, tasks]);

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || fetchedTask;

  // ─── Bildirimler ──────────────────────────────────────────────────────────
  const { notifications } = useNotifications(user?.uid ?? null);

  // ─── Toast yardımcıları ──────────────────────────────────────────────────
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

  // E2E test girişi — yalnızca Firebase Emulator Suite'e bağlıyken ve URL'de
  // ?e2e_token= parametresi varsa çalışır. Gerçek Google OAuth popup'ını
  // otomatikleştirmek pratik olmadığından, Playwright bu token'ı bir seed
  // script'inin (scripts/seedE2E.ts) ürettiği custom token ile sağlar.
  useEffect(() => {
    if (!isUsingFirebaseEmulator) return;
    const token = new URLSearchParams(window.location.search).get('e2e_token');
    if (!token) return;
    signInWithCustomToken(auth, token).catch((err) => {
      console.error('[E2E] signInWithCustomToken failed:', err);
    });
  }, []);

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

  // NOT: Atıl görev denetimi artık yalnızca sunucu tarafında çalışıyor
  // (functions/src/scheduledAudit.ts — günde bir, Cloud Function). Burada
  // eskiden istemci tarafında da (saatte bir) çalışan eşdeğer bir denetim
  // vardı; iki sistemin aynı işi yapması gereksiz/çakışan yazmalara yol
  // açabileceğinden kaldırıldı.

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
    addBlocker, resolveBlocker, addComment, delegateTask,
    addUser, updateUserRole, deleteUser,
    updateBlocker, deleteBlocker,
    markNotificationRead, markAllNotificationsRead,
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
          <Logo size="xl" withText={false} variant={resolvedTheme} />
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
          role="region"
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
          <main id="main-content">
            <Login onLogin={handleLogin} />
          </main>
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
              isOffline={isOffline}
              queueLength={offlineQueueLength}
            />
            <NotificationPanel showNotifications={showNotifications} setShowNotifications={setShowNotifications} notifRef={notifRef} notifications={notifications} setSelectedTaskId={setSelectedTaskId} setActiveTab={setActiveTab} markNotificationRead={markNotificationRead} markAllNotificationsRead={markAllNotificationsRead} />

            <main id="main-content" className="lg:ml-64 min-h-screen relative z-10 scroll-smooth pb-24 lg:pb-0">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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
                        isLoading={isDataLoading}
                      />
                    )}
                    {Boolean(activeTab === 'reports') && <Reports tasks={filteredTasksByFocus} users={filteredUsersByFocus} blockers={filteredBlockersByFocus} setActiveTab={setActiveTab} />}
                    {Boolean(activeTab === 'audit') && (
                      <AuditLogList
                        tasks={filteredTasksByFocus} users={filteredUsersByFocus}
                      />
                    )}
                    {Boolean(activeTab === 'settings') && (
                      <Settings tasks={tasks} users={users} blockers={blockers} triggerToast={triggerToast} currentUser={user} isLoading={isDataLoading} />
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

            {/* Görev Detay Modalı — TaskDetails/TaskDetailsFooter lazy() olduğundan
                bu Suspense sınırı, footer prop'u dahil ikisini de kapsar (Suspense
                lexical iç içelikten değil, render ağacındaki soydan bağımsızdır). */}
            <Suspense fallback={
              <div className="flex items-center justify-center p-16 min-h-[300px]">
                <div className="w-6 h-6 border-2 border-executive-gold/20 border-t-executive-gold rounded-full animate-spin" />
              </div>
            }>
              <Modal
                isOpen={!!selectedTaskId && !isEditModalOpen && !isCreateModalOpen}
                onClose={() => setSelectedTaskId(null)}
                title="Talimat Detayı & İcra"
                size="xl"
                layoutId={selectedTask ? `task-card-${selectedTask.id}` : undefined}
                footer={selectedTask && getPrimaryAction(selectedTask, user) ? (
                  <TaskDetailsFooter
                    task={selectedTask}
                    currentUser={user}
                    onStatusChange={(status, evidence, type) => updateTaskStatus(selectedTask.id, status, evidence, type)}
                  />
                ) : undefined}
              >
                {Boolean(selectedTask) && (
                  <TaskDetails
                    task={selectedTask!}
                    tasks={tasks}
                    users={users}
                    currentUser={user!}
                    blockers={blockers.filter(b => b.taskId === selectedTask!.id)}
                    onAddBlocker={(reason, severity) => selectedTask && addBlocker(selectedTask.id, reason, severity)}
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
                    onDelegateTask={(newAssigneeId) => selectedTask && delegateTask(selectedTask.id, newAssigneeId)}
                  />
                )}
              </Modal>
            </Suspense>

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
