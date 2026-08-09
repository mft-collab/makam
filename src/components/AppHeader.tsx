import React, { useState, useEffect } from 'react';
import { AlertCircle, Sun, Moon, Monitor, Building, BookOpen } from 'lucide-react';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { LocalTime } from './LocalTime';
import { Badge } from './ui/Badge';
import { Tooltip } from './ui/Tooltip';
import { GuideModal } from './GuideModal';
import { ROLE_LABELS } from '../constants';
import { useUIStore } from '../store/uiStore';
import type { User, Notification } from '../types';
import { offlineQueue } from '../lib/offlineQueue';

interface Props {
  user: User;
  activeTab: string;
  notifications: Notification[];
  showNotifications: boolean;
  setShowNotifications: (show: boolean) => void;
  globalFocusDept: string;
  onGlobalFocusDeptChange: (dept: string) => void;
  departments: string[];
}

export function AppHeader({
  user,
  activeTab,
  notifications,
  showNotifications,
  setShowNotifications,
  globalFocusDept,
  onGlobalFocusDeptChange,
  departments
}: Props) {
  // Selector bazlı okuma — bu bileşen sticky/her zaman görünür olduğundan
  // whole-store `useUIStore()` toasts/filter/activeTab gibi ilgisiz her alan
  // değişiminde (ör. her toast eklenip 6sn sonra otomatik kaldırıldığında)
  // gereksiz yeniden render'a yol açıyordu.
  const theme = useUIStore(s => s.theme);
  const setTheme = useUIStore(s => s.setTheme);
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [queueCount, setQueueCount] = useState(0);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const updateQueueCount = () => {
      setQueueCount(offlineQueue.getQueue().length);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('makam_queue_changed', updateQueueCount);

    updateQueueCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('makam_queue_changed', updateQueueCount);
    };
  }, []);

  const handleToggleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  return (
    <>
      {/* Desktop Header Refined */}
      <header className="hidden lg:flex min-h-20 bg-makam-glass border-b border-makam-border/5 items-center justify-between px-8 sticky top-0 z-40 backdrop-blur-[40px] lg:ml-64">
        <div className="flex items-center gap-8">
           <div className="flex flex-col gap-1.5 border-l-2 border-executive-gold/20 pl-6">
             <h1 className="text-[13px] font-medium text-text-heading uppercase tracking-[0.22em] font-display">
               {Boolean(activeTab === 'dashboard') && 'Stratejik Harekat Merkezi'}
               {Boolean(activeTab === 'tasks') && 'Talimatlar'}
               {Boolean(activeTab === 'blockers') && 'Engeller'}
               {Boolean(activeTab === 'team') && 'Kadro'}
               {Boolean(activeTab === 'reports') && 'Raporlar'}
               {Boolean(activeTab === 'audit') && 'Denetim İzleri'}
               {Boolean(activeTab === 'settings') && 'Dizge Ayarları'}
             </h1>
             <div className="flex items-center gap-3">
               <span className="w-1.5 h-1.5 rounded-full bg-status-success shadow-[0_0_10px_var(--color-status-success)]" />
               <LocalTime />
             </div>
           </div>
        </div>

        <div className="flex items-center gap-6">
          {Boolean(notifications.length > 0) && (
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={`${notifications.length} bekleyen bildirim. Bildirimleri ${showNotifications ? 'gizle' : 'göster'}.`}
              aria-expanded={showNotifications}
              aria-haspopup="true"
              className="flex items-center gap-3 px-4 py-2 bg-status-danger/[0.06] border border-status-danger/20 rounded-full animate-makam-flash shadow-sm hover:bg-status-danger/10 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger"
            >
              <AlertCircle className="w-3.5 h-3.5 text-status-danger stroke-[1.5]" aria-hidden="true" />
              <span className="text-[9px] font-medium text-status-danger uppercase tracking-[0.18em]">
                {notifications.length} Bekleyen Talimat
              </span>
            </button>
          )}

          {/* Live Network Status Indicator */}
          {isOnline ? (
            <div 
              className="flex items-center gap-1.5 px-3 py-1.5 bg-status-success/[0.04] border border-status-success/10 rounded-full cursor-help group relative"
              title="Dizge Güvenli & Senkronize"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-status-success shadow-[0_0_8px_var(--color-status-success)] animate-pulse" />
              <span className="text-[8px] font-bold text-status-success uppercase tracking-widest hidden sm:inline">ONLINE</span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 bg-status-warning/[0.04] border border-status-warning/10 rounded-full animate-pulse cursor-help relative group"
              title={`Çevrimdışı İcra Modu — ${queueCount} işlem kuyrukta bekliyor.`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-status-warning shadow-[0_0_8px_var(--color-status-warning)]" />
              <span className="text-[8px] font-bold text-status-warning uppercase tracking-widest">
                OFFLINE {queueCount > 0 && `(${queueCount})`}
              </span>
            </div>
          )}
          {/* Global Focus Filter Selector — Staff panosu kişisel kapsamlıdır, birim odağı anlamsız */}
          {user.role !== 'Staff' && (
            <div className="flex items-center gap-2 bg-surface-base/60 p-1.5 rounded-full border border-executive-blue/[0.04] shadow-sm select-none">
              <Building className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" />
              <select
                value={globalFocusDept}
                onChange={(e) => onGlobalFocusDeptChange(e.target.value)}
                className="text-[9px] uppercase tracking-widest text-text-heading bg-transparent border-none font-bold cursor-pointer pr-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue rounded"
                aria-label="Global Odak Birimi Filtresi"
              >
                <option value="ALL" className="bg-surface-base text-text-heading">Tüm Odaklar</option>
                {departments.map(dept => (
                  <option key={dept} value={dept} className="bg-surface-base text-text-heading">{dept}</option>
                ))}
              </select>
            </div>
          )}

          <Tooltip content="Çalışma kuralları, mühlet disiplinleri ve belge koşulları" side="bottom">
            <button
              onClick={() => setIsGuideOpen(true)}
              aria-label="Kılavuzu aç"
              className="w-9 h-9 flex items-center justify-center rounded-full border border-makam-border/10 bg-makam-glass hover:bg-text-muted/5 transition-all text-text-muted hover:text-executive-blue cursor-pointer"
            >
              <BookOpen className="w-4 h-4 stroke-[1.5]" />
            </button>
          </Tooltip>

          <button
            onClick={handleToggleTheme}
            aria-label={`Temayı değiştir. Şu anki tema: ${
              theme === 'light' ? 'Açık' : theme === 'dark' ? 'Koyu' : 'Dizge'
            }`}
            className="w-9 h-9 flex items-center justify-center rounded-full border border-makam-border/10 bg-makam-glass hover:bg-text-muted/5 transition-all text-text-muted hover:text-executive-blue cursor-pointer"
          >
            {theme === 'light' && <Sun className="w-4 h-4 stroke-[1.5]" />}
            {theme === 'dark' && <Moon className="w-4 h-4 stroke-[1.5]" />}
            {theme === 'system' && <Monitor className="w-4 h-4 stroke-[1.5]" />}
          </button>

          <div className="h-6 w-[1px] bg-executive-blue/[0.06]" />
          
          <div className="flex items-center gap-3 group p-1.5 pr-4 rounded-full hover:bg-makam-glass transition-all">
            <div className="flex flex-col items-end gap-1">
              <span className="text-[12px] font-normal text-executive-blue tracking-tight font-display leading-none">{user.fullName}</span>
              <Badge variant="primary" className="text-[7.5px] px-2 py-0.5 font-bold">{ROLE_LABELS[user.role]}</Badge>
            </div>
            {/* #10 — Avatar bileşeni */}
            <Avatar
              name={user.fullName}
              photoURL={user.photoURL}
              size="md"
              ring
              className="group-hover:scale-105 group-hover:rotate-2 transition-all"
            />
          </div>
        </div>
      </header>

      {/* Mobile Header Refined */}
      <header className="lg:hidden h-16 bg-makam-glass border-b border-makam-border/5 flex items-center justify-between px-6 sticky top-0 z-40 backdrop-blur-3xl">
        <Logo size="sm" variant="light" />
        
        <div className="flex items-center gap-3">
          {/* Mobile Network Indicator */}
          <div className="flex items-center">
            {isOnline ? (
              <span className="w-1.5 h-1.5 rounded-full bg-status-success shadow-[0_0_8px_var(--color-status-success)] animate-pulse" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-status-warning shadow-[0_0_8px_var(--color-status-warning)] animate-ping" />
            )}
          </div>

          <button
            onClick={() => setIsGuideOpen(true)}
            aria-label="Kılavuzu aç"
            className="w-8 h-8 flex items-center justify-center rounded-full border border-makam-border/10 bg-makam-glass text-text-muted hover:text-executive-blue"
          >
            <BookOpen className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>

          <button
            onClick={handleToggleTheme}
            aria-label="Temayı değiştir"
            className="w-8 h-8 flex items-center justify-center rounded-full border border-makam-border/10 bg-makam-glass text-text-muted hover:text-executive-blue"
          >
            {theme === 'light' && <Sun className="w-3.5 h-3.5 stroke-[1.5]" />}
            {theme === 'dark' && <Moon className="w-3.5 h-3.5 stroke-[1.5]" />}
            {theme === 'system' && <Monitor className="w-3.5 h-3.5 stroke-[1.5]" />}
          </button>

          {Boolean(notifications.length > 0) && (
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="flex items-center gap-2 px-3 py-1.5 bg-status-danger/10 border border-status-danger/20 rounded-full animate-makam-flash text-[9px] font-medium text-status-danger uppercase tracking-[0.25em]"
            >
              <AlertCircle className="w-3.5 h-3.5 text-status-danger stroke-[1.5]" />
              <span>{notifications.length} Talimat</span>
            </button>
          )}
        </div>
      </header>

      <GuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </>
  );
}
