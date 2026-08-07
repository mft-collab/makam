import React, { useState } from 'react';
import { motion } from 'motion/react';
import { CheckSquare, AlertTriangle, LogOut, Users, BarChart3, ShieldCheck, Settings as SettingsIcon, Database } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { triggerHaptic } from '../lib/haptics';
import { cn } from '../lib/utils';
import { User } from '../types';
import { ROLE_LABELS } from '../constants';
import { Logo } from './Logo';
import { PremiumIcon } from './ui/PremiumIcon';
import { Avatar } from './ui/Avatar';
import { AboutModal } from './AboutModal';

interface SidebarProps {
  user: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
}

export const Sidebar = ({ user, activeTab, setActiveTab, onLogout }: SidebarProps) => {
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  const primaryItems: MenuItem[] = [
    { id: 'dashboard', label: 'Harekat Merkezi', icon: ShieldCheck, roles: ['Admin', 'Manager', 'Staff'] },
    { id: 'tasks', label: 'Talimatlar', icon: CheckSquare, roles: ['Admin', 'Manager', 'Staff'] },
    { id: 'blockers', label: 'Engeller', icon: AlertTriangle, roles: ['Admin', 'Manager'] },
    { id: 'team', label: 'Kadro', icon: Users, roles: ['Admin', 'Manager'] },
    { id: 'reports', label: 'Raporlar', icon: BarChart3, roles: ['Admin'] },
  ];

  const systemItems: MenuItem[] = [
    { id: 'audit', label: 'Denetim İzleri', icon: Database, roles: ['Admin'] },
    { id: 'settings', label: 'Dizge Ayarları', icon: SettingsIcon, roles: ['Admin'] },
  ];

  const filteredPrimaryItems = primaryItems.filter(item => user && item.roles.includes(user.role));
  const filteredSystemItems = systemItems.filter(item => user && item.roles.includes(user.role));

  const renderMenuItem = (item: MenuItem) => (
    <button
      key={item.id}
      onClick={() => {
        triggerHaptic('light');
        setActiveTab(item.id);
      }}
      aria-current={activeTab === item.id ? 'page' : undefined}
      aria-label={item.label}
      className={cn(
        'flex items-center gap-4 px-3.5 py-2.5 rounded-xl transition-all duration-500 group relative border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        activeTab === item.id
          ? 'bg-executive-gold/[0.08] border-executive-gold/15 shadow-[0_8px_32px_rgba(197,160,89,0.05)] translate-x-1'
          : 'hover:bg-surface-glass hover:translate-x-0.5'
      )}
    >
      <PremiumIcon
        icon={item.icon}
        active={activeTab === item.id}
        size="sm"
        variant={activeTab === item.id ? 'gold' : 'glass'}
        aria-hidden
      />
      <span className={cn(
        'font-normal text-[13px] tracking-wide transition-colors duration-300',
        activeTab === item.id ? 'text-executive-gold font-medium' : 'text-text-muted group-hover:text-text-body'
      )}>
        {item.label}
      </span>
      {activeTab === item.id && (
        <motion.div
          layoutId="active-pill"
          className="absolute -left-8 w-1.5 h-6 bg-executive-gold rounded-r-full"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          aria-hidden="true"
        />
      )}
    </button>
  );

  const SidebarContent = (
    <div className="w-64 h-full bg-makam-glass backdrop-blur-[35px] flex flex-col p-6 gap-8 relative overflow-y-auto no-scrollbar border-r border-surface-border shadow-2xl">
      <div className="relative w-full py-4 px-3 flex justify-center items-center rounded-2xl bg-surface-glass border border-surface-border shadow-[0_8px_32px_rgba(0,0,0,0.15)] overflow-hidden group">
        <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-executive-gold/30 to-transparent opacity-70 pointer-events-none" />

        <button
          onClick={() => {
            triggerHaptic('medium');
            setIsAboutModalOpen(true);
          }}
          className="relative z-10 w-full flex items-center justify-center outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
          aria-label="Dizge Hakkında"
        >
          <Logo variant="dark" size="md" className="drop-shadow-[0_4px_12px_rgba(197,160,89,0.12)]" />
          <div className="absolute -right-2 -top-2 bg-executive-gold text-brand-obsidian text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300">v2.1.0</div>
        </button>
      </div>

      <nav className="flex flex-col gap-7 flex-1" aria-label="Ana menü">
        <div className="flex flex-col gap-1.5">
          <div className="text-[9px] text-text-muted font-medium uppercase tracking-[0.22em] mb-2 px-2" aria-hidden="true">
            OPERASYON
          </div>
          {filteredPrimaryItems.map(renderMenuItem)}
        </div>

        {filteredSystemItems.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-surface-border">
            <div className="text-[9px] text-text-muted font-medium uppercase tracking-[0.22em] mb-2 px-2" aria-hidden="true">
              SİSTEM
            </div>
            {filteredSystemItems.map(renderMenuItem)}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-4 pt-6">
        <div className="makam-divider mb-2 opacity-10" />
        <div className="px-4 py-3 flex items-center gap-3 group bg-surface-glass border border-surface-border rounded-2xl shadow-sm transition-all duration-300 hover:bg-makam-glass">
          <Avatar
            name={user?.fullName ?? '?'}
            photoURL={user?.photoURL}
            size="md"
            ring
            className="border-surface-border flex-shrink-0 group-hover:scale-105 transition-all"
          />
          <div className="flex flex-col overflow-hidden gap-1">
            <span className="text-[14px] font-normal text-text-heading truncate tracking-tight leading-none font-display">{user?.fullName}</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1 h-1 rounded-full bg-status-success" />
              <span className="text-[8px] text-executive-gold font-medium uppercase tracking-[0.22em]">{user ? ROLE_LABELS[user.role] : ''}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            triggerHaptic('medium');
            onLogout();
          }}
          aria-label="Oturumu kapat"
          className="flex items-center justify-center gap-2 px-5 py-3 text-text-tertiary hover:text-status-danger hover:bg-status-danger/10 rounded-full transition-all group font-medium text-[11px] uppercase tracking-[0.16em] border border-surface-border hover:border-status-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
        >
          <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1" aria-hidden="true" />
          <span>Oturumu Kapat</span>
        </button>

        <button
          onClick={() => setIsAboutModalOpen(true)}
          className="mt-2 text-[10px] text-text-tertiary/60 hover:text-executive-gold transition-colors font-medium tracking-widest uppercase text-center"
        >
          MAKAM v2.1.0
        </button>
      </div>

      <AboutModal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} />
    </div>
  );

  return (
    <aside className="hidden lg:flex w-64 h-screen fixed left-0 top-0 z-40">
      {SidebarContent}
    </aside>
  );
};
