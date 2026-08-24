import React, { useState, useEffect } from 'react';
import { Download, AlertCircle, CheckCircle2, Database, RotateCcw, ShieldCheck, Smartphone, Bell, Settings as SettingsIcon, Clock } from 'lucide-react';
import { Task, User, TaskBlocker } from '../types';
import { cn, downloadBlob } from '../lib/utils';
import { taskService } from '../services/taskService';
import { auditLogService } from '../services/auditLogService';
import { settingsService } from '../services/settingsService';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getSLAConfigForPriority } from '../lib/sla';
import { SettingsCard, ActionButton, StatusBanner } from './settings/SharedUI';
import { Skeleton } from './ui/Skeleton';

interface SettingsProps {
  tasks: Task[];
  users: User[];
  blockers: TaskBlocker[];
  triggerToast?: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  currentUser?: User | null;
  isLoading?: boolean;
}

const AUDIT_LOG_EXPORT_PAGE_SIZE = 500;

const SettingsSkeleton = () => (
  <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto" aria-label="Ayarlar yükleniyor..." role="status">
    <div className="flex items-center gap-2.5 pb-4 border-b border-executive-blue/[0.04]">
      <Skeleton className="h-8 w-8" rounded="lg" />
      <Skeleton className="h-6 w-52" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="makam-card p-6 flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-9 w-full mt-2" rounded="full" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export const Settings = ({ tasks, users, blockers, triggerToast, currentUser, isLoading = false }: SettingsProps) => {
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'sla' | 'data'>('general');
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const isAdmin = currentUser?.role === 'Admin';

  // Network status listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // RBAC Tab Access control
  useEffect(() => {
    if (!isAdmin && (activeSubTab === 'sla' || activeSubTab === 'data')) {
      setActiveSubTab('general');
    }
  }, [activeSubTab, isAdmin]);

  // SLA Settings State
  const [slaLowVal, setSlaLowVal] = useState(15);
  const [slaLowUnit, setSlaLowUnit] = useState<'days' | 'hours'>('days');

  const [slaMediumVal, setSlaMediumVal] = useState(5);
  const [slaMediumUnit, setSlaMediumUnit] = useState<'days' | 'hours'>('days');

  const [slaHighVal, setSlaHighVal] = useState(2);
  const [slaHighUnit, setSlaHighUnit] = useState<'days' | 'hours'>('days');

  const [slaUrgentVal, setSlaUrgentVal] = useState(4);
  const [slaUrgentUnit, setSlaUrgentUnit] = useState<'days' | 'hours'>('hours');
  
  const [isSavingSla, setIsSavingSla] = useState(false);

  useEffect(() => {
    // Read initial SLA values using getSLAConfigForPriority helper
    const low = getSLAConfigForPriority('Low');
    setSlaLowVal(low.value);
    setSlaLowUnit(low.unit);

    const medium = getSLAConfigForPriority('Medium');
    setSlaMediumVal(medium.value);
    setSlaMediumUnit(medium.unit);

    const high = getSLAConfigForPriority('High');
    setSlaHighVal(high.value);
    setSlaHighUnit(high.unit);

    const urgent = getSLAConfigForPriority('Urgent');
    setSlaUrgentVal(urgent.value);
    setSlaUrgentUnit(urgent.unit);
  }, []);

  const handleSaveSla = async () => {
    if (!currentUser || currentUser.role !== 'Admin') return;
    setIsSavingSla(true);
    setImportStatus({ type: 'loading', message: 'SLA Yapılandırması Kaydediliyor...' });
    try {
      const summaryLabel = 'Rutin: ' + slaLowVal + ' ' + slaLowUnit + ', Normal: ' + slaMediumVal + ' ' + slaMediumUnit + ', Öncelikli: ' + slaHighVal + ' ' + slaHighUnit + ', İvedi: ' + slaUrgentVal + ' ' + slaUrgentUnit;
      await settingsService.saveSlaConfig({
        Low: { value: Number(slaLowVal), unit: slaLowUnit },
        Medium: { value: Number(slaMediumVal), unit: slaMediumUnit },
        High: { value: Number(slaHighVal), unit: slaHighUnit },
        Urgent: { value: Number(slaUrgentVal), unit: slaUrgentUnit },
      }, currentUser.uid, summaryLabel);

      setImportStatus({ type: 'success', message: 'SLA Teslim Mühletleri başarıyla güncellendi.' });
      if (triggerToast) {
        triggerToast('📋 SLA GÜNCELLENDİ', 'Kurumsal SLA teslim süreleri başarıyla revize edildi.', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `SLA Kayıt Hatası: ${msg}` });
    } finally {
      setIsSavingSla(false);
    }
  };

  const handleTestNotifications = async () => {
    // 1. Play the synthesis sound instantly
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Auto-resume context on click if suspended by browser autoplay policy
      if (audioCtx.state === 'suspended') {
        const resumeAudio = () => {
          audioCtx.resume();
          document.removeEventListener('click', resumeAudio);
        };
        document.addEventListener('click', resumeAudio);
      }

      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      const gain2 = audioCtx.createGain();
      
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(554.37, audioCtx.currentTime); // C#5 (Root tone)
      gain1.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
      
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 (Harmonic overtone)
      gain2.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
      
      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(audioCtx.destination);
      gain2.connect(audioCtx.destination);
      
      osc1.start();
      osc2.start();
      osc1.stop(audioCtx.currentTime + 0.8);
      osc2.stop(audioCtx.currentTime + 0.6);
    } catch {
      console.warn('Audio feedback blocked by browser autoplay policy');
    }

    // 2. Trigger the In-App Toast visual notification
    if (triggerToast) {
      triggerToast(
        'BİLDİRİM TESTİ',
        'Makam ses ve yazılı bildirim sentezleyici motoru başarıyla test edildi.',
        'success'
      );
    }

    // 3. Try to trigger native browser notification if allowed
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Makam Kurumsal Bildirim', {
          body: 'Dizge arka plan ve yerel bildirim altyapısı aktiftir.',
          icon: '/favicon.ico'
        });
      } catch (err) {
        console.warn('Native notification failed:', err);
      }
    } else {
      setImportStatus({
        type: 'success',
        message: 'Uygulama içi görsel ve sesli bildirim test edildi! Tarayıcı push izni etkin değil.'
      });
      setTimeout(() => setImportStatus(null), 5000);
    }
  };

  const handleInstallClick = async () => {
    const success = await install();
    if (success) {
      setImportStatus({ type: 'success', message: 'Uygulama başarıyla kuruluyor...' });
    } else {
      setImportStatus({ type: 'error', message: 'Yükleme başlatılamadı veya iptal edildi.' });
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!currentUser || currentUser.role !== 'Admin') {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Dizge yedeği indirme yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    setImportStatus({ type: 'loading', message: 'Dizge Verileri Yedekleniyor...' });
    try {
      const logs = await auditLogService.fetchAllPaged(AUDIT_LOG_EXPORT_PAGE_SIZE);

      const backup = {
        tasks, users, blockers, auditLogs: logs,
        exportDate: new Date().toISOString(),
        version: '2.2.0',
        system: 'MAKAM Stratejik Yönetim',
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `MAKAM-Backup-${new Date().toISOString().split('T')[0]}.json`);
      setImportStatus({ type: 'success', message: 'Dizge yedeği başarıyla indirildi.' });
    } catch (err) {
      console.error('Export failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `Yedekleme Hatası: ${msg}` });
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentUser || currentUser.role !== 'Admin') {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Dizge geri yükleme yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus({ type: 'loading', message: 'Veri Bütünlüğü Doğrulanıyor...' });

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const content = ev.target?.result as string;
        if (!content) throw new Error('Dosya içeriği okunamadı.');

        setImportStatus({ type: 'loading', message: 'Dizge Geri Yükleniyor...' });

        await settingsService.restoreBackup(content, currentUser.uid, file.name, (percent) => {
          setImportStatus({ type: 'loading', message: `Veri Yazılıyor... %${percent}` });
        });

        setImportStatus({ type: 'success', message: 'Dizge başarıyla önceki sürüme döndürüldü.' });
        e.target.value = '';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setImportStatus({ type: 'error', message: `Hata: ${msg}` });
      }
    };
    reader.readAsText(file);
  };

  // ── Archive (export-only) ───────────────────────────────────────────────────
  // NOT: Denetim izleri artık firestore.rules'ta değiştirilemez/silinemez
  // (kanıt bütünlüğü). Bu işlem yalnızca dışa aktarır — veritabanından hiçbir
  // kayıt silinmez.
  const handleArchive = async () => {
    if (!currentUser || currentUser.role !== 'Admin') {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Log dışa aktarma yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    setIsArchiving(true);
    setImportStatus({ type: 'loading', message: 'Denetim İzleri İndiriliyor...' });
    try {
      const logs = await auditLogService.fetchAllPaged(AUDIT_LOG_EXPORT_PAGE_SIZE);

      if (logs.length === 0) {
        setImportStatus({ type: 'success', message: 'Dışa aktarılacak denetim izi bulunamadı.' });
        return;
      }

      // Arşiv Dosyasını İndir (JSON)
      const backup = {
        auditLogs: logs,
        archiveDate: new Date().toISOString(),
        version: '2.2.0',
        system: 'MAKAM Stratejik Yönetim Denetim Arşivi',
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `MAKAM-Logs-Backup-${new Date().toISOString().split('T')[0]}.json`);

      // Dışa aktarma işleminin kendisi denetim izine kaydedilir (kayıtlar silinmez)
      await settingsService.archiveAuditLogs(logs.length, currentUser.uid);

      setImportStatus({ type: 'success', message: `${logs.length} denetim izi kaydı başarıyla yerel diske aktarıldı.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', message: `Arşivleme Hatası: ${msg}` });
    } finally {
      setIsArchiving(false);
    }
  };

  if (isLoading) return <SettingsSkeleton />;

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 pb-4 border-b border-executive-blue/[0.04]">
        <div className="w-8 h-8 rounded-xl bg-executive-blue flex items-center justify-center shadow-lg">
          <SettingsIcon className="w-4 h-4 text-[color:var(--executive-blue-text)] stroke-[1.5]" />
        </div>
        <div>
          <span className="text-[10px] font-medium text-executive-blue uppercase tracking-[0.4em] block leading-none">
            DİZGE YAPILANDIRMASI
          </span>
          <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">Konfigürasyon & Veri Yönetimi</span>
        </div>
      </div>

      {/* ── Offline Banner ─────────────────────────────────────────── */}
      {!isOnline && (
        <div className="flex items-center gap-2.5 p-3 bg-status-danger/10 border border-status-danger/20 text-status-danger rounded-2xl text-[10px] font-semibold uppercase tracking-[0.15em] animate-pulse">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Çevrimdışı moddasınız. Veritabanı ve SLA işlemleri geçici olarak kısıtlanmıştır.</span>
        </div>
      )}

      {/* ── Status Banner ──────────────────────────────────────────── */}
      <StatusBanner status={importStatus} />

      {/* ── Tabbed Layout ─────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-6 mt-2">
        
        {/* Left Sidebar Tabs Selector */}
        <div className="flex flex-row md:flex-col gap-1.5 overflow-x-auto md:overflow-x-visible pb-3 md:pb-0 shrink-0 md:w-56 border-b md:border-b-0 md:border-r border-surface-border">
          <button
            onClick={() => setActiveSubTab('general')}
            className={cn(
              "px-4 py-3 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] text-left transition-all shrink-0 w-full",
              activeSubTab === 'general' 
                ? "bg-executive-blue text-[color:var(--executive-blue-text)] shadow-[0_4px_12px_rgba(30,41,59,0.15)]"
                : "text-text-muted hover:text-text-heading hover:bg-executive-blue/[0.03]"
            )}
          >
            Genel & Görünüm
          </button>
          
          {isAdmin && (
            <>
              <button
                onClick={() => setActiveSubTab('sla')}
                className={cn(
                  "px-4 py-3 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] text-left transition-all shrink-0 w-full",
                  activeSubTab === 'sla' 
                    ? "bg-executive-blue text-[color:var(--executive-blue-text)] shadow-[0_4px_12px_rgba(30,41,59,0.15)]"
                    : "text-text-muted hover:text-text-heading hover:bg-executive-blue/[0.03]"
                )}
              >
                SLA Kuralları
              </button>
              <button
                onClick={() => setActiveSubTab('data')}
                className={cn(
                  "px-4 py-3 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] text-left transition-all shrink-0 w-full",
                  activeSubTab === 'data' 
                    ? "bg-executive-blue text-[color:var(--executive-blue-text)] shadow-[0_4px_12px_rgba(30,41,59,0.15)]"
                    : "text-text-muted hover:text-text-heading hover:bg-executive-blue/[0.03]"
                )}
              >
                Veri Yönetimi
              </button>
            </>
          )}
        </div>

        {/* Right Tab Content Panel */}
        <div className="flex-1 min-w-0">
          
          {/* TAB 1: GENERAL & VIEW */}
          {activeSubTab === 'general' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Notification and Audio System Test */}
              <SettingsCard title="Bildirim & Ses Testi" description="Akustik & görsel doğrulaması" icon={Bell} accentColor="amber" index={0}>
                <p className="text-[11px] text-text-muted font-light leading-relaxed">
                  Dizge ses sentezleyici çanını ve yerel bildirim motorunun (In-App Toast ve PWA Push) çalışma durumunu anında test edin.
                </p>
                <ActionButton
                  variant="warning"
                  onClick={handleTestNotifications}
                  label={<><Bell className="w-3.5 h-3.5 stroke-[2]" />Bildirimleri Test Et</>}
                />
              </SettingsCard>

              {/* PWA Installation */}
              <SettingsCard title="Cihaza Yükle (PWA)" description="Masaüstü & Mobil Uygulama" icon={Smartphone} accentColor="gold" index={1}>
                <div className="flex flex-col gap-2.5">
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    MAKAM dizgesini bilgisayarınıza veya telefonunuza bağımsız bir uygulama olarak yükleyebilirsiniz. Bu sayede daha hızlı erişim sağlar ve tam ekran deneyimi yaşarsınız.
                  </p>

                  {isInstalled ? (
                    <div className="flex items-center gap-2 p-2.5 bg-status-success/10 border border-status-success/20 rounded-xl">
                      <CheckCircle2 className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
                      <span className="text-[9px] text-status-success font-medium uppercase tracking-[0.2em]">
                        Uygulama zaten yüklü ve aktif!
                      </span>
                    </div>
                  ) : isInstallable ? (
                    <ActionButton
                      variant="primary"
                      onClick={handleInstallClick}
                      label={<><Smartphone className="w-3.5 h-3.5 stroke-[2]" />Uygulamayı Şimdi Yükle</>}
                    />
                  ) : (
                    <div className="flex flex-col gap-2 p-3 bg-surface-glass border border-surface-border rounded-xl text-[10px] text-text-muted font-normal leading-relaxed">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-executive-gold flex-shrink-0 mt-0.5 animate-pulse" />
                        <div>
                          <span className="font-semibold text-text-heading block mb-0.5">Yükleme Kılavuzu</span>
                          <span>Tarayıcınız otomatik yükleme butonunu şu an desteklemiyor olabilir. Alternatif yükleme adımları:</span>
                        </div>
                      </div>
                      <div className="h-px bg-executive-blue/[0.04] my-1" />
                      <ul className="list-disc pl-4 flex flex-col gap-1 text-[9px] text-text-tertiary">
                        <li><strong>iOS (iPhone/iPad):</strong> Safari tarayıcısında alt menüdeki <span className="text-text-muted font-semibold">Paylaş</span> butonuna tıklayıp, gelen menüden <span className="text-text-muted font-semibold">"Ana Ekrana Ekle"</span> seçeneğini seçin.</li>
                        <li><strong>Android (Chrome):</strong> Sağ üstteki üç noktaya tıklayıp <span className="text-text-muted font-semibold">"Uygulamayı yükle"</span> veya <span className="text-text-muted font-semibold">"Ana ekrana ekle"</span> seçeneğini seçin.</li>
                        <li><strong>Masaüstü (Chrome/Edge):</strong> Adres çubuğunun sağ tarafındaki <span className="text-text-muted font-semibold">"Yükle" (küçük monitör/ok)</span> simgesine tıklayın.</li>
                      </ul>
                    </div>
                  )}
                </div>
              </SettingsCard>

            </div>
          )}

          {/* TAB 2: SLA RULES */}
          {activeSubTab === 'sla' && isAdmin && (
            <div className="max-w-2xl">
              {/* SLA Configuration */}
              <SettingsCard 
                title="SLA Teslim Mühletleri" 
                description="Talimat öncelik süreleri" 
                icon={Clock} 
                accentColor="gold" 
                index={0}
              >
                <p className="text-[11px] text-text-muted font-light leading-relaxed mb-1">
                  Görevin tanımlandığı andan itibaren tamamlanması gereken iş günü veya mesai saati mühlet limitleri (Mesai: 09:00 - 18:00).
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">Rutin</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaLowVal}
                        onChange={(e) => setSlaLowVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaLowUnit}
                        onChange={(e) => setSlaLowUnit(e.target.value as 'days' | 'hours')}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days" className="bg-surface-base text-text-heading">İş Günü</option>
                        <option value="hours" className="bg-surface-base text-text-heading">İş Saati</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">Normal</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaMediumVal}
                        onChange={(e) => setSlaMediumVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaMediumUnit}
                        onChange={(e) => setSlaMediumUnit(e.target.value as 'days' | 'hours')}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days" className="bg-surface-base text-text-heading">İş Günü</option>
                        <option value="hours" className="bg-surface-base text-text-heading">İş Saati</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">Öncelikli</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaHighVal}
                        onChange={(e) => setSlaHighVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaHighUnit}
                        onChange={(e) => setSlaHighUnit(e.target.value as 'days' | 'hours')}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days" className="bg-surface-base text-text-heading">İş Günü</option>
                        <option value="hours" className="bg-surface-base text-text-heading">İş Saati</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">İvedi</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaUrgentVal}
                        onChange={(e) => setSlaUrgentVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaUrgentUnit}
                        onChange={(e) => setSlaUrgentUnit(e.target.value as 'days' | 'hours')}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus-visible:outline-none focus-visible:border-executive-gold disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days" className="bg-surface-base text-text-heading">İş Günü</option>
                        <option value="hours" className="bg-surface-base text-text-heading">İş Saati</option>
                      </select>
                    </div>
                  </div>
                </div>

                {!isOnline ? (
                  <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                    <AlertCircle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                    <p className="text-[9px] text-status-danger font-semibold uppercase tracking-[0.15em] leading-relaxed">
                      SLA sürelerini güncellemek için internet bağlantısı gereklidir.
                    </p>
                  </div>
                ) : (
                  <ActionButton
                    variant="primary"
                    disabled={isSavingSla}
                    onClick={handleSaveSla}
                    label={isSavingSla ? 'Kaydediliyor...' : 'Süreleri Güncelle'}
                  />
                )}
              </SettingsCard>
            </div>
          )}

          {/* TAB 3: DATA MANAGEMENT */}
          {activeSubTab === 'data' && isAdmin && (
            <div className="flex flex-col gap-4">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Export */}
                <SettingsCard title="Arşivleme" description="Dizge yedeği oluştur" icon={Download} accentColor="slate" index={0}>
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    Tüm talimat, personel ve denetim verilerini tek bir JSON dosyasına aktarır.
                  </p>
                  <ActionButton
                    variant="primary"
                    disabled={!isOnline}
                    onClick={handleExport}
                    label={<><Download className="w-3.5 h-3.5 stroke-[2]" />Yedeği İndir (.json)</>}
                  />
                </SettingsCard>

                {/* Import / Restore */}
                <SettingsCard title="Geri Yükleme" description="Yedekten dizgeyi döndür" icon={RotateCcw} accentColor="amber" index={1}>
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    Daha önce alınan bir yedek dosyasından dizgeyi geri yükler (Çalışma zamanı Zod doğrulaması içerir).
                  </p>

                  <input type="file" accept=".json" onChange={handleImport} className="hidden" id="restore-upload" disabled={!isOnline} />
                  
                  {!isOnline ? (
                    <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                      <AlertCircle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                      <p className="text-[9px] text-status-danger font-semibold uppercase tracking-[0.15em] leading-relaxed">
                        Dizgeyi geri yüklemek için internet bağlantısı gereklidir.
                      </p>
                    </div>
                  ) : (
                    <>
                      <ActionButton
                        variant="danger"
                        htmlFor="restore-upload"
                        label={<><RotateCcw className="w-3.5 h-3.5 stroke-[2]" />Yedekten Dön</>}
                      />

                      <div className="flex items-start gap-2.5 p-3.5 border-l-[3px] border-status-danger bg-status-danger/[0.06] rounded-r-xl">
                        <AlertCircle className="w-4 h-4 text-status-danger flex-shrink-0 mt-0.5 stroke-[1.5]" />
                        <p className="text-[12.5px] text-text-heading font-normal leading-relaxed">
                          Bu işlem mevcut verilerin üzerine yazacaktır. Kayıtlar toplu halde (chunk) yazılır — işlem yarıda kesilirse veritabanı kısmen güncellenmiş durumda kalabilir. Geri yüklemeden önce güncel bir yedek almanız önerilir.
                        </p>
                      </div>
                    </>
                  )}
                </SettingsCard>

                {/* Export Audit Logs */}
                <SettingsCard title="Denetim İzlerini Arşivle" description="Dizge log dışa aktarımı" icon={ShieldCheck} accentColor="slate" index={2}>
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    Tüm dizge erişim ve değişim loglarını yerel bir JSON dosyasına aktarır. Denetim izleri kanıt bütünlüğü gereği değiştirilemez/silinemez olduğundan bu işlem veritabanından hiçbir kaydı kaldırmaz.
                  </p>

                  {!isOnline ? (
                    <div className="flex items-start gap-2 p-2.5 bg-status-danger/10 border border-status-danger/20 rounded-xl">
                      <AlertCircle className="w-3.5 h-3.5 text-status-danger flex-shrink-0 mt-0.5" />
                      <p className="text-[9px] text-status-danger font-semibold uppercase tracking-[0.15em] leading-relaxed">
                        Denetim izlerini dışa aktarmak için internet bağlantısı gereklidir.
                      </p>
                    </div>
                  ) : (
                    <ActionButton
                      variant="primary"
                      disabled={isArchiving}
                      onClick={handleArchive}
                      label={isArchiving ? 'Arşivleniyor...' : <><Download className="w-3.5 h-3.5 stroke-[2]" />Arşivi İndir (.json)</>}
                    />
                  )}
                </SettingsCard>

                {/* System Optimization */}
                <SettingsCard title="Dizge Optimizasyonu" description="Önbellek & bildirim temizliği" icon={Database} accentColor="slate" index={3}>
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    Okunmuş bildirimleri ve geçici önbelleği temizleyerek dizge performansını artırır.
                  </p>
                  <ActionButton
                    variant="secondary"
                    disabled={!isOnline}
                    onClick={async () => {
                      setImportStatus({ type: 'loading', message: 'Dizge Optimize Ediliyor...' });
                      await taskService.cleanupDatabase();
                      setImportStatus({ type: 'success', message: 'Dizge başarıyla optimize edildi.' });
                    }}
                    label={<><RotateCcw className="w-3.5 h-3.5 stroke-[2]" />Optimizasyonu Çalıştır</>}
                  />
                </SettingsCard>

              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
