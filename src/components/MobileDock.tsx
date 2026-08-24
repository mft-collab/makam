import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, CheckSquare, AlertTriangle,
  Users, BarChart3, MoreHorizontal, Settings, Database,
  LogOut
} from 'lucide-react';
import { cn } from '../lib/utils';
import { User } from '../types';
import { triggerHaptic } from '../lib/haptics';
import { TAB_ROLES } from '../constants';

interface DockItem {
  id: string;
  label: string;
  icon: React.ElementType;
  roles: string[];
}

const ALL_ITEMS: DockItem[] = [
  { id: 'dashboard', label: 'Harekat',   icon: ShieldCheck,   roles: TAB_ROLES.dashboard },
  { id: 'tasks',     label: 'Talimatlar', icon: CheckSquare,  roles: TAB_ROLES.tasks },
  { id: 'blockers',  label: 'Engeller',  icon: AlertTriangle, roles: TAB_ROLES.blockers },
  { id: 'team',      label: 'Kadro',     icon: Users,         roles: TAB_ROLES.team },
  { id: 'reports',   label: 'Raporlar',  icon: BarChart3,     roles: TAB_ROLES.reports },
  { id: 'audit',     label: 'Denetim',   icon: Database,      roles: TAB_ROLES.audit },
  { id: 'settings',  label: 'Ayarlar',   icon: Settings,      roles: TAB_ROLES.settings },
];

const MAX_VISIBLE = 4;

interface MobileDockProps {
  user: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export const MobileDock = ({ user, activeTab, setActiveTab, onLogout }: MobileDockProps) => {
  const [showMore, setShowMore] = React.useState(false);

  const filtered = ALL_ITEMS.filter(item => user && item.roles.includes(user.role));
  const primary  = filtered.slice(0, MAX_VISIBLE);
  const overflow = filtered.slice(MAX_VISIBLE);
  const hasMore  = overflow.length > 0;

  const handleSelect = (id: string) => {
    triggerHaptic('light');
    setActiveTab(id);
    setShowMore(false);
  };

  return (
    <>
      {/* Overflow "Daha Fazla" Panel */}
      <AnimatePresence>
        {showMore && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMore(false)}
              aria-hidden="true"
              className="fixed inset-0 bg-executive-blue/20 backdrop-blur-sm z-[70] lg:hidden"
            />

            {/* Overflow panel — sağ alt köşeden yukarı fırlar */}
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              className="fixed bottom-24 right-4 left-auto z-[80] lg:hidden
                         bg-makam-glass backdrop-blur-3xl backdrop-saturate-[180%]
                         border border-surface-border
                         rounded-[22px] shadow-[0_20px_60px_-12px_rgba(22,21,19,0.14)]
                         overflow-hidden min-w-[190px] max-w-[calc(100vw-2rem)]"
            >
              {/* Panel başlık */}
              <div className="px-4 py-2.5 border-b border-executive-blue/[0.04]">
                <span className="text-[8px] text-text-muted/50 uppercase tracking-[0.18em] font-medium truncate block">
                  Ek Modüller
                </span>
              </div>

              {overflow.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.label}
                    className={cn(
                      'flex items-center gap-3 w-full px-4 py-3.5 transition-all duration-200 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-inset',
                      isActive
                        ? 'bg-executive-blue/5 text-executive-blue'
                        : 'text-text-muted hover:bg-executive-blue/[0.03] hover:text-text-heading'
                    )}
                  >
                    <Icon
                      className={cn(
                        'w-4 h-4 flex-shrink-0',
                        isActive ? 'text-executive-blue' : 'text-text-muted/60'
                      )}
                      strokeWidth={isActive ? 2 : 1.5}
                      aria-hidden={true}
                    />
                    <span className="text-[12px] font-medium tracking-wide flex-1 min-w-0 truncate">
                      {item.label}
                    </span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-executive-gold flex-shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })}

              {/* Ayraç + Çıkış */}
              <div className="border-t border-executive-blue/[0.04]">
                <button
                  onClick={onLogout}
                  className="flex items-center gap-3 w-full px-4 py-3.5 transition-all duration-200
                             text-status-danger/70 hover:text-status-danger hover:bg-status-danger/10"
                >
                  <LogOut className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                  <span className="text-[12px] font-medium tracking-wide min-w-0 truncate">Oturumu Kapat</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── DOCK BAR ───────────────────────────────────────────────── */}
      <nav
        className="fixed bottom-4 left-4 right-4 z-[60] lg:hidden"
        aria-label="Mobil navigasyon"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom) - 12px, 0px)' }}
      >
        <div
          className="flex items-stretch gap-1 px-2.5 sm:px-3 py-1.5
                     bg-makam-glass backdrop-blur-[30px] backdrop-saturate-[180%]
                     border border-surface-border
                     rounded-[28px]
                     shadow-[0_12px_40px_-10px_rgba(22,21,19,0.08),0_0_0_0.5px_rgba(22,21,19,0.04)]"
        >
          {primary.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                className="flex-1 flex flex-col items-center justify-center
                           gap-1 py-2.5 px-0.5 sm:px-1 rounded-xl transition-all duration-300
                           relative min-w-0 group active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-1"
              >
                {/* Aktif zemin */}
                {isActive && (
                  <motion.div
                    layoutId="dock-active-bg"
                    className="absolute inset-0 bg-executive-blue/[0.07] rounded-xl"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    aria-hidden="true"
                  />
                )}

                {/* İkon */}
                <div className="relative flex items-center justify-center w-6 h-6" aria-hidden="true">
                  <motion.div
                    animate={{ scale: isActive ? 1.12 : 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  >
                    <Icon
                      className={cn(
                        'w-5 h-5 transition-colors duration-300',
                        isActive ? 'text-executive-blue' : 'text-text-muted/50 group-hover:text-text-muted'
                      )}
                      strokeWidth={isActive ? 2 : 1.5}
                    />
                  </motion.div>

                  {/* Gold aktif nokta */}
                  <AnimatePresence>
                    {isActive && (
                      <motion.span
                        key="dot"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                        className="absolute -top-0.5 -right-0.5
                                   w-1.5 h-1.5 rounded-full bg-executive-gold
                                   shadow-[0_0_6px_rgba(197,160,89,0.5)]"
                      />
                    )}
                  </AnimatePresence>
                </div>

                {/* Etiket */}
                <span
                  className={cn(
                    'text-[8.5px] sm:text-[9px] font-medium tracking-normal sm:tracking-wide truncate leading-none transition-colors duration-300 max-w-full',
                    isActive ? 'text-executive-blue' : 'text-text-muted/45 group-hover:text-text-muted/70'
                  )}
                  aria-hidden="true"
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* "Daha Fazla" butonu — sadece overflow varsa */}
          {hasMore && (
            <button
              onClick={() => {
                triggerHaptic('light');
                setShowMore(prev => !prev);
              }}
              aria-label={showMore ? 'Ek modülleri gizle' : 'Ek modülleri göster'}
              aria-expanded={showMore}
              aria-haspopup="true"
              className="flex-1 flex flex-col items-center justify-center
                         gap-1 py-2.5 px-0.5 sm:px-1 rounded-xl transition-all duration-300
                         relative min-w-0 group active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-1"
            >
              {showMore && (
                <motion.div
                  layoutId="dock-active-bg"
                  className="absolute inset-0 bg-executive-blue/[0.07] rounded-xl"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  aria-hidden="true"
                />
              )}

              <motion.div animate={{ rotate: showMore ? 90 : 0 }} transition={{ duration: 0.2 }} aria-hidden="true">
                <MoreHorizontal
                  className={cn(
                    'w-5 h-5 transition-colors duration-300',
                    showMore ? 'text-executive-blue' : 'text-text-muted/50 group-hover:text-text-muted'
                  )}
                  strokeWidth={1.5}
                />
              </motion.div>

              <span
                aria-hidden="true"
                className={cn(
                  'text-[8.5px] sm:text-[9px] font-medium tracking-normal sm:tracking-wide leading-none transition-colors duration-300',
                  showMore ? 'text-executive-blue' : 'text-text-muted/45 group-hover:text-text-muted/70'
                )}
              >
                Diğer
              </span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
};
