import React, { useState, useEffect } from 'react';
import { AlertCircle, Sun, Moon, Monitor, Wifi, WifiOff, Building } from 'lucide-react';
import { Logo } from './Logo';
import { Avatar } from './ui/Avatar';
import { LocalTime } from './LocalTime';
import { Badge } from './ui/Badge';
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
  const { theme, setTheme } = useUIStore();
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [queueCount, setQueueCount] = useState(0);

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
      <header className="hidden lg:flex h-20 bg-makam-glass border-b border-makam-border/5 items-center justify-between px-8 sticky top-0 z-40 backdrop-blur-[40px] lg:ml-64">
        <div className="flex items-center gap-8">
           <div className="flex flex-col gap-1.5 border-l-2 border-executive-gold/20 pl-6">
             <h1 className="text-[13px] font-medium text-text-heading uppercase tracking-[0.22em] font-display">
               {Boolean(activeTab === 'dashboard') && 'Stratejik Harekat Merkezi'}
               {Boolean(activeTab === 'tasks') && 'Talimatlar'}
               {Boolean(activeTab === 'blockers') && 'Riskler'}
               {Boolean(activeTab === 'team') && 'Kadro'}
               {Boolean(activeTab === 'reports') && 'Raporlar'}
               {Boolean(activeTab === 'audit') && 'Sistem Denetim İzleri'}
               {Boolean(activeTab === 'settings') && 'Sistem Konfigürasyon Merkezi'}
             </h1>
             <div className="flex items-center gap-3">
               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]" />
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
              className="flex items-center gap-3 px-4 py-2 bg-red-50/40 border border-red-100/60 rounded-full animate-makam-flash shadow-sm hover:bg-red-500/10 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <AlertCircle className="w-3.5 h-3.5 text-red-500 stroke-[1.5]" aria-hidden="true" />
              <span className="text-[9px] font-medium text-red-600 uppercase tracking-[0.18em]">
                {notifications.length} Bekleyen Talimat
              </span>
            </button>
          )}

          {/* Live Network Status Indicator */}
          {isOnline ? (
            <div 
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/[0.04] border border-emerald-500/10 rounded-full cursor-help group relative"
              title="Sistem Güvenli & Senkronize"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
              <span className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest hidden sm:inline">ONLINE</span>
            </div>
          ) : (
            <div 
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/[0.04] border border-amber-500/10 rounded-full animate-pulse cursor-help relative group"
              title={`Çevrimdışı İcra Modu — ${queueCount} işlem kuyrukta bekliyor.`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
              <span className="text-[8px] font-bold text-amber-600 uppercase tracking-widest">
                OFFLINE {queueCount > 0 && `(${queueCount})`}
              </span>
            </div>
          )}
          {/* Global Focus Filter Selector */}
          <div className="flex items-center gap-2 bg-[#F5F3EF]/60 p-1.5 rounded-full border border-executive-blue/[0.04] shadow-sm select-none">
            <Building className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" />
            <select
              value={globalFocusDept}
              onChange={(e) => onGlobalFocusDeptChange(e.target.value)}
              className="text-[9px] uppercase tracking-widest text-text-heading bg-transparent border-none outline-none font-bold cursor-pointer pr-4 focus:ring-0"
              aria-label="Global Odak Birimi Filtresi"
            >
              <option value="ALL" className="bg-surface-base text-text-heading">Tüm Odaklar</option>
              {departments.map(dept => (
                <option key={dept} value={dept} className="bg-surface-base text-text-heading">{dept}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleToggleTheme}
            aria-label={`Temayı değiştir. Şu anki tema: ${
              theme === 'light' ? 'Açık' : theme === 'dark' ? 'Koyu' : 'Sistem'
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
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-ping" />
            )}
          </div>

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
              className="flex items-center gap-2 px-3 py-1.5 bg-red-50/60 border border-red-100/60 rounded-full animate-makam-flash text-[9px] font-medium text-red-600 uppercase tracking-[0.25em]"
            >
              <AlertCircle className="w-3.5 h-3.5 text-red-500 stroke-[1.5]" />
              <span>{notifications.length} Talimat</span>
            </button>
          )}
        </div>
      </header>
    </>
  );
}
