import React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Notification } from '../types';

interface Props {
  showNotifications: boolean;
  setShowNotifications: (show: boolean) => void;
  notifRef: React.RefObject<HTMLDivElement | null>;
  notifications: Notification[];
  setSelectedTaskId: (id: string) => void;
  setActiveTab: (tab: string) => void;
  /** useAppHandlers üzerinden — bu bileşen artık notificationService'i
   *  doğrudan çağırmıyor (bkz. kod denetimi: "okundu işaretleme" bir yazma
   *  işlemidir ve merkezi handler katmanını atlamamalıdır). */
  markNotificationRead: (notificationId: string) => Promise<void>;
  /** Yalnızca panelde GERÇEKTEN gösterilen bildirimlerin id'leri işaretlenir
   *  (bkz. kod denetimi: sunucudan bağımsız "tümünü getir" sorgusu, panelin
   *  limit(5) ile sınırlı görünümünün dışında kalan hiç görülmemiş bir
   *  bildirimi — ör. eski bir Kriz uyarısını — sessizce kaybedebiliyordu). */
  markAllNotificationsRead: (notificationIds: string[]) => Promise<void>;
}

export function NotificationPanel({
  showNotifications,
  setShowNotifications,
  notifRef,
  notifications,
  setSelectedTaskId,
  setActiveTab,
  markNotificationRead,
  markAllNotificationsRead,
}: Props) {
  if (!showNotifications) return null;

  return (
    <div
      ref={notifRef}
      className="fixed top-16 lg:top-20 right-3 lg:right-8 z-[200]
                 w-[calc(100vw-24px)] max-w-sm lg:max-w-md
                 bg-surface-elevated backdrop-blur-2xl
                 border border-surface-border
                 rounded-2xl
                 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.18)]
                 overflow-hidden"
    >
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-executive-blue/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-status-danger" />
          <span className="text-[9px] font-medium text-status-danger uppercase tracking-[0.35em]">
            Bekleyen Kurumsal Talimatlar
          </span>
        </div>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            await markAllNotificationsRead(notifications.map(n => n.id));
            setShowNotifications(false);
          }}
          className="text-[8px] text-text-tertiary hover:text-executive-blue uppercase tracking-[0.25em] font-medium transition-colors px-2 py-1 rounded-lg hover:bg-surface-glass"
        >
          Tamamını Okundu Say
        </button>
      </div>

      {/* Notification list */}
      <div className="max-h-[60vh] lg:max-h-80 overflow-y-auto divide-y divide-makam-border/30">
        {notifications.map(n => {
          const isCrisis  = n.type === 'Crisis';
          const isWarning = n.type === 'Warning';
          const hasTask   = Boolean(n.taskId);
          return (
            <div key={n.id} className="flex flex-col gap-2 px-4 py-3 hover:bg-surface-glass transition-colors">
              <div className="flex items-start gap-2.5">
                <div className={cn(
                  'w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                  isCrisis  ? 'bg-status-danger/10 text-status-danger' :
                  isWarning ? 'bg-executive-gold/10 text-executive-gold' :
                  'bg-executive-blue/5 text-executive-blue'
                )}>
                  <AlertCircle className="w-3 h-3" />
                </div>
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      'text-[7px] font-bold uppercase tracking-[0.3em] px-1.5 py-0.5 rounded-full',
                      isCrisis  ? 'bg-status-danger/20 text-status-danger' :
                      isWarning ? 'bg-executive-gold/10 text-executive-gold' :
                      'bg-executive-blue/5 text-executive-blue'
                    )}>
                      {isCrisis ? '🚨 KRİZ' : isWarning ? '⚠ UYARI' : 'ℹ BİLGİ'}
                    </span>
                    <span className="text-[11px] font-medium text-executive-blue line-clamp-1 leading-tight">
                      {n.title}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted leading-relaxed line-clamp-3">
                    {n.message}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pl-8 gap-2">
                <span className="text-[8px] text-text-tertiary uppercase tracking-[0.2em]">
                  {isCrisis
                    ? "→ Talimatlar'da atıl talimatları denetleyin"
                    : hasTask
                    ? '→ Talimata erişmek için tıklayın'
                    : '→ Üst makam müdahalesi gerekiyor'}
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {hasTask && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setSelectedTaskId(n.taskId!);
                        setActiveTab('tasks');
                        await markNotificationRead(n.id);
                        setShowNotifications(false);
                      }}
                      className="px-2.5 py-1 text-[8px] font-medium text-[color:var(--executive-blue-text)] bg-executive-blue rounded-lg uppercase tracking-[0.2em] hover:opacity-85 transition-opacity"
                    >
                      Talimata Git
                    </button>
                  )}
                  {isCrisis && !hasTask && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveTab('tasks'); setShowNotifications(false); }}
                      className="px-2.5 py-1 text-[8px] font-medium text-[color:var(--status-danger-text)] bg-status-danger rounded-lg uppercase tracking-[0.2em] hover:opacity-85 transition-opacity"
                    >
                      Talimatlara Git
                    </button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await markNotificationRead(n.id);
                    }}
                    className="px-2.5 py-1 text-[8px] font-medium text-text-tertiary bg-surface-glass border border-surface-border rounded-lg uppercase tracking-[0.2em] hover:text-executive-blue hover:bg-surface-elevated transition-colors"
                  >
                    Okundu
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Panel footer */}
      <div className="px-4 py-2.5 border-t border-executive-blue/[0.04] bg-surface-glass">
        <p className="text-[8px] text-text-tertiary uppercase tracking-[0.25em] text-center">
          Okundu sayılan talimatlar listeden kaldırılır
        </p>
      </div>
    </div>
  );
}
