import React, { useState, useEffect } from 'react';
import { Download, AlertCircle, CheckCircle2, Database, RotateCcw, Trash2, Smartphone, Bell, Settings as SettingsIcon, Clock } from 'lucide-react';
import { Task, User } from '../types';
import { cn } from '../lib/utils';
import { db, doc, writeBatch, collection, getDocs, query, setDoc, getCountFromServer, addDoc } from '../firebase';
import { z } from 'zod';
import { taskService } from '../services/taskService';
import { motion } from 'motion/react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getSLAConfigForPriority } from '../lib/sla';
import { SettingsCard, ActionButton, StatusBanner } from './settings/SharedUI';

interface SettingsProps {
  tasks: Task[];
  users: User[];
  blockers: any[];
  triggerToast?: (title: string, body: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
  currentUser?: User | null;
}

// ── Main Component ────────────────────────────────────────────────────────────
export const Settings = ({ tasks, users, blockers, triggerToast, currentUser }: SettingsProps) => {
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'sla' | 'data'>('general');
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const [localAuditLogsCount, setLocalAuditLogsCount] = useState<number>(0);

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
      const newConfig = {
        Low: { value: Number(slaLowVal), unit: slaLowUnit },
        Medium: { value: Number(slaMediumVal), unit: slaMediumUnit },
        High: { value: Number(slaHighVal), unit: slaHighUnit },
        Urgent: { value: Number(slaUrgentVal), unit: slaUrgentUnit },
        updatedAt: Date.now(),
        updatedBy: currentUser.uid
      };
      await setDoc(doc(db, 'system', 'sla_config'), newConfig);
      
      // Update localStorage synchronously
      localStorage.setItem('makam_sla_config', JSON.stringify({
        Low: newConfig.Low,
        Medium: newConfig.Medium,
        High: newConfig.High,
        Urgent: newConfig.Urgent
      }));

      // Audit log registration
      await addDoc(collection(db, 'audit_logs'), {
        taskId: 'system_settings',
        changedBy: currentUser.uid,
        oldValue: 'SLA Config Modified',
        newValue: 'Low: ' + slaLowVal + ' ' + slaLowUnit + ', Medium: ' + slaMediumVal + ' ' + slaMediumUnit + ', High: ' + slaHighVal + ' ' + slaHighUnit + ', Urgent: ' + slaUrgentVal + ' ' + slaUrgentUnit,
        timestamp: Date.now()
      });
      
      setImportStatus({ type: 'success', message: 'SLA Teslim Mühletleri başarıyla güncellendi.' });
      if (triggerToast) {
        triggerToast('📋 SLA GÜNCELLENDİ', 'Kurumsal SLA teslim süreleri başarıyla revize edildi.', 'success');
      }
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `SLA Kayıt Hatası: ${err.message}` });
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
          body: 'Sistem arka plan ve yerel bildirim altyapısı aktiftir.',
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

  useEffect(() => {
    const fetchAuditLogsCount = async () => {
      try {
        const snapshot = await getCountFromServer(collection(db, 'audit_logs'));
        setLocalAuditLogsCount(snapshot.data().count);
      } catch (err) {
        console.error('Failed to fetch settings audit logs count:', err);
      }
    };
    fetchAuditLogsCount();
  }, []);

  const handleInstallClick = async () => {
    const success = await install();
    if (success) {
      setImportStatus({ type: 'success', message: 'Uygulama başarıyla kuruluyor...' });
    } else {
      setImportStatus({ type: 'error', message: 'Yükleme başlatılamadı veya iptal edildi.' });
    }
  };

  // ── System snapshot data ──────────────────────────────────────────────────
  const snapshotStats = [
    { label: 'Talimat',       value: tasks.length },
    { label: 'Personel',    value: users.length },
    { label: 'Engel',       value: blockers.length },
    { label: 'Denetim İzi', value: localAuditLogsCount },
  ];

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!currentUser || currentUser.role !== 'Admin') {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Sistem yedeği indirme yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    setImportStatus({ type: 'loading', message: 'Sistem Verileri Yedekleniyor...' });
    try {
      const snapshot = await getDocs(query(collection(db, 'audit_logs')));
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const backup = {
        tasks, users, blockers, auditLogs: logs,
        exportDate: new Date().toISOString(),
        version: '2.1.0',
        system: 'MAKAM Executive Control',
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `MAKAM-Backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setImportStatus({ type: 'success', message: 'Sistem yedeği başarıyla indirildi.' });
    } catch (err: any) {
      console.error('Export failed:', err);
      setImportStatus({ type: 'error', message: `Yedekleme Hatası: ${err.message}` });
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentUser || currentUser.role !== 'Admin') {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Sistem geri yükleme yetkisi yalnızca Admin makamına aittir.', 'danger');
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
        const data = JSON.parse(content);

        // Zod validation schemas
        const userBackupSchema = z.object({
          uid: z.string(),
          fullName: z.string(),
          email: z.string().email(),
          role: z.enum(['Admin', 'Manager', 'Staff'])
        });

        const taskBackupSchema = z.object({
          id: z.string(),
          title: z.string().min(1),
          description: z.string(),
          creatorId: z.string(),
          assigneeId: z.string(),
          status: z.enum(['ASSIGNED', 'PENDING_DELEGATION', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL', 'COMPLETED', 'CANCELLED', 'CRISIS']),
          priority: z.enum(['Low', 'Medium', 'High', 'Urgent']),
          deadline: z.any(),
          createdAt: z.any(),
          updatedAt: z.any()
        });

        const backupValidation = z.object({
          system: z.literal('MAKAM Executive Control'),
          users: z.array(z.any()).optional(),
          tasks: z.array(z.any()).optional(),
          blockers: z.array(z.any()).optional(),
        }).safeParse(data);

        if (!backupValidation.success) {
          throw new Error('Yedek dosyası formatı geçersiz (MAKAM verisi değil).');
        }

        if (Array.isArray(data.users)) {
          data.users.forEach((u: any) => {
            const parsed = userBackupSchema.safeParse(u);
            if (!parsed.success) {
              throw new Error(`Personel verisi doğrulanamadı (${u.fullName || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
            }
          });
        }

        if (Array.isArray(data.tasks)) {
          data.tasks.forEach((t: any) => {
            const parsed = taskBackupSchema.safeParse(t);
            if (!parsed.success) {
              throw new Error(`Talimat verisi doğrulanamadı (${t.title || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
            }
          });
        }

        setImportStatus({ type: 'loading', message: 'Sistem Geri Yükleniyor...' });

        const cleanDataObj = (obj: any): any => {
          if (obj === null || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) return obj.map(item => cleanDataObj(item));
          const n: any = {};
          Object.keys(obj).forEach(k => { if (obj[k] !== undefined) n[k] = cleanDataObj(obj[k]); });
          return n;
        };
        const toTs = (val: any, fb?: number): number => {
          if (val == null) return fb ?? Date.now();
          if (typeof val === 'number') return val;
          if (typeof val === 'string') return new Date(val).getTime() || (fb ?? Date.now());
          if (typeof val === 'object' && 'seconds' in val) return val.seconds * 1000;
          return fb ?? Date.now();
        };
        const pick = (obj: any, keys: string[]) => {
          const r: any = {};
          keys.forEach(k => { if (k in obj && obj[k] !== undefined) r[k] = obj[k]; });
          return r;
        };

        const items: { ref: any; data: any }[] = [];
        if (Array.isArray(data.users)) {
          data.users.forEach((u: any) => {
            if (u.uid) items.push({ ref: doc(db, 'users', u.uid), data: pick(cleanDataObj(u), ['uid', 'fullName', 'email', 'role', 'departmentId', 'photoURL', 'fcmTokens']) });
          });
        }
        if (Array.isArray(data.tasks)) {
          data.tasks.forEach((t: any) => {
            if (t.id) {
              const s = cleanDataObj(t);
              s.deadline  = toTs(s.deadline);
              s.createdAt = toTs(s.createdAt);
              s.updatedAt = toTs(s.updatedAt);
              items.push({ ref: doc(db, 'tasks', t.id), data: s });
            }
          });
        }
        if (Array.isArray(data.blockers)) {
          data.blockers.forEach((b: any) => {
            if (b.id) {
              const { id, ...rest } = cleanDataObj(b);
              rest.createdAt = toTs(rest.createdAt);
              if (rest.resolvedAt) rest.resolvedAt = toTs(rest.resolvedAt);
              items.push({ ref: doc(db, 'blockers', id), data: rest });
            }
          });
        }

        const CHUNK = 50;
        for (let i = 0; i < items.length; i += CHUNK) {
          const chunk = items.slice(i, i + CHUNK);
          const batch = writeBatch(db);
          chunk.forEach(it => batch.set(it.ref, it.data, { merge: true }));
          await batch.commit();
          setImportStatus({ type: 'loading', message: `Veri Yazılıyor... %${Math.round(((i + chunk.length) / items.length) * 100)}` });
        }

        // Register restore audit log
        await addDoc(collection(db, 'audit_logs'), {
          taskId: 'system_backup_restore',
          changedBy: currentUser.uid,
          oldValue: 'Before Restore',
          newValue: 'Database Restored from Backup file',
          timestamp: Date.now()
        });

        setImportStatus({ type: 'success', message: 'Sistem başarıyla önceki sürüme döndürüldü.' });
        e.target.value = '';
      } catch (err: any) {
        setImportStatus({ type: 'error', message: `Hata: ${err.message}` });
      }
    };
    reader.readAsText(file);
  };

  // ── Archive ───────────────────────────────────────────────────────────────
  const handleArchive = async () => {
    if (!currentUser || currentUser.role !== 'Admin') {
      if (triggerToast) {
        triggerToast('YETKİSİZ İŞLEM', 'Log arşivleme ve temizleme yetkisi yalnızca Admin makamına aittir.', 'danger');
      }
      return;
    }
    setIsArchiving(true);
    setImportStatus({ type: 'loading', message: 'Denetim İzleri İndiriliyor...' });
    try {
      const snapshot = await getDocs(query(collection(db, 'audit_logs')));
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (logs.length === 0) {
        setImportStatus({ type: 'success', message: 'Temizlenecek denetim izi bulunamadı.' });
        setShowArchiveConfirm(false);
        return;
      }

      // Arşiv Dosyasını İndir (JSON)
      const backup = {
        auditLogs: logs,
        archiveDate: new Date().toISOString(),
        version: '2.1.0',
        system: 'MAKAM Executive Control Audit Archive',
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MAKAM-Logs-Backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setImportStatus({ type: 'loading', message: 'Veritabanı Temizleniyor...' });

      // Chunked Firestore Batch Deletion (max 500 items per batch limit of Firestore)
      const CHUNK_SIZE = 500;
      const docsList = snapshot.docs;
      for (let i = 0; i < docsList.length; i += CHUNK_SIZE) {
        const chunk = docsList.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach(docSnap => batch.delete(docSnap.ref));
        await batch.commit();
        setImportStatus({ 
          type: 'loading', 
          message: `Arşiv Temizleniyor... %${Math.round(((i + chunk.length) / docsList.length) * 100)}` 
        });
      }

      setLocalAuditLogsCount(0);

      // Add audit log for log cleaning
      await addDoc(collection(db, 'audit_logs'), {
        taskId: 'system_log_cleaning',
        changedBy: currentUser.uid,
        oldValue: logs.length + ' logs in DB',
        newValue: 'Cleaned and Archived',
        timestamp: Date.now()
      });

      setImportStatus({ type: 'success', message: 'Denetim izleri başarıyla yerel diske arşivlendi ve veritabanından kalıcı olarak silindi.' });
      setShowArchiveConfirm(false);
    } catch (err: any) {
      setImportStatus({ type: 'error', message: `Arşivleme Hatası: ${err.message}` });
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 pb-4 border-b border-executive-blue/[0.04]">
        <div className="w-8 h-8 rounded-xl bg-executive-blue flex items-center justify-center shadow-lg">
          <SettingsIcon className="w-4 h-4 text-white stroke-[1.5]" />
        </div>
        <div>
          <span className="text-[10px] font-medium text-executive-blue uppercase tracking-[0.4em] block leading-none">
            SİSTEM YAPILANDIRMASI
          </span>
          <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">Konfigürasyon & Veri Yönetimi</span>
        </div>
      </div>

      {/* ── Offline Banner ─────────────────────────────────────────── */}
      {!isOnline && (
        <div className="flex items-center gap-2.5 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl text-[10px] font-semibold uppercase tracking-[0.15em] animate-pulse">
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
                ? "bg-executive-blue text-white shadow-[0_4px_12px_rgba(30,41,59,0.15)]" 
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
                    ? "bg-executive-blue text-white shadow-[0_4px_12px_rgba(30,41,59,0.15)]" 
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
                    ? "bg-executive-blue text-white shadow-[0_4px_12px_rgba(30,41,59,0.15)]" 
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
                  Sistem ses sentezleyici çanını ve yerel bildirim motorunun (In-App Toast ve PWA Push) çalışma durumunu anında test edin.
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
                    MAKAM sistemini bilgisayarınıza veya telefonunuza bağımsız bir uygulama olarak yükleyebilirsiniz. Bu sayede daha hızlı erişim sağlar ve tam ekran deneyimi yaşarsınız.
                  </p>

                  {isInstalled ? (
                    <div className="flex items-center gap-2 p-2.5 bg-emerald-50/60 border border-emerald-100/60 rounded-xl">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span className="text-[9px] text-emerald-700 font-medium uppercase tracking-[0.2em]">
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
                    <div className="flex flex-col gap-2 p-3 bg-slate-50/60 border border-slate-100 rounded-xl text-[10px] text-text-muted font-normal leading-relaxed">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-[#C5A059] flex-shrink-0 mt-0.5 animate-pulse" />
                        <div>
                          <span className="font-semibold text-text-heading block mb-0.5">Yükleme Kılavuzu</span>
                          <span>Tarayıcınız otomatik yükleme butonunu şu an desteklemiyor olabilir. Alternatif yükleme adımları:</span>
                        </div>
                      </div>
                      <div className="h-px bg-executive-blue/[0.04] my-1" />
                      <ul className="list-disc pl-4 flex flex-col gap-1 text-[9px] text-text-tertiary">
                        <li><strong>iOS (iPhone/iPad):</strong> Safari tarayıcısında alt menüdeki <span className="text-text-muted font-semibold">Paylaş (Share)</span> butonuna tıklayıp, gelen menüden <span className="text-text-muted font-semibold">"Ana Ekrana Ekle"</span> seçeneğini seçin.</li>
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
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">Rutin (Low)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaLowVal}
                        onChange={(e) => setSlaLowVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaLowUnit}
                        onChange={(e) => setSlaLowUnit(e.target.value as any)}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days">İş Günü</option>
                        <option value="hours">İş Saati</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">Normal (Medium)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaMediumVal}
                        onChange={(e) => setSlaMediumVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaMediumUnit}
                        onChange={(e) => setSlaMediumUnit(e.target.value as any)}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days">İş Günü</option>
                        <option value="hours">İş Saati</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">Öncelikli (High)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaHighVal}
                        onChange={(e) => setSlaHighVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaHighUnit}
                        onChange={(e) => setSlaHighUnit(e.target.value as any)}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days">İş Günü</option>
                        <option value="hours">İş Saati</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-medium text-text-tertiary uppercase tracking-[0.15em]">İvedi (Urgent)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={slaUrgentVal}
                        onChange={(e) => setSlaUrgentVal(Math.max(1, parseInt(e.target.value) || 0))}
                        disabled={!isOnline || isSavingSla}
                        className="w-2/3 h-9 px-3 text-[12px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed font-display transition-colors"
                      />
                      <select
                        value={slaUrgentUnit}
                        onChange={(e) => setSlaUrgentUnit(e.target.value as any)}
                        disabled={!isOnline || isSavingSla}
                        className="w-1/3 h-9 px-1.5 text-[10px] bg-makam-glass border border-executive-blue/10 rounded-xl focus:outline-none focus:border-[#C5A059] disabled:bg-text-muted/5 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
                      >
                        <option value="days">İş Günü</option>
                        <option value="hours">İş Saati</option>
                      </select>
                    </div>
                  </div>
                </div>

                {!isOnline ? (
                  <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-100 rounded-xl">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[9px] text-red-600 font-semibold uppercase tracking-[0.15em] leading-relaxed">
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
              
              {/* System Snapshot */}
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-w-4xl"
              >
                {snapshotStats.map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex flex-col gap-0.5 p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl shadow-[0_1px_6px_rgba(22,21,19,0.02)]"
                  >
                    <span className="text-[20px] font-light text-executive-blue tabular-nums tracking-tight leading-none font-display">
                      {value}
                    </span>
                    <span className="text-[8px] text-text-tertiary font-medium uppercase tracking-[0.3em]">{label}</span>
                  </div>
                ))}
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Export */}
                <SettingsCard title="Arşivleme (Export)" description="Sistem yedeği oluştur" icon={Download} accentColor="slate" index={0}>
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
                <SettingsCard title="Geri Yükleme (Restore)" description="Yedekten sistemi döndür" icon={RotateCcw} accentColor="amber" index={1}>
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    Daha önce alınan bir yedek dosyasından sistemi geri yükler (Çalışma zamanı Zod doğrulaması içerir).
                  </p>

                  <input type="file" accept=".json" onChange={handleImport} className="hidden" id="restore-upload" disabled={!isOnline} />
                  
                  {!isOnline ? (
                    <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-100 rounded-xl">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[9px] text-red-600 font-semibold uppercase tracking-[0.15em] leading-relaxed">
                        Sistemi geri yüklemek için internet bağlantısı gereklidir.
                      </p>
                    </div>
                  ) : (
                    <>
                      <ActionButton
                        variant="warning"
                        htmlFor="restore-upload"
                        label={<><RotateCcw className="w-3.5 h-3.5 stroke-[2]" />Yedekten Dön</>}
                      />

                      <div className="flex items-start gap-2 p-2.5 bg-[#C5A059]/[0.05] border border-[#C5A059]/15 rounded-xl">
                        <AlertCircle className="w-3.5 h-3.5 text-[#C5A059] flex-shrink-0 mt-0.5 stroke-[1.5]" />
                        <p className="text-[9px] text-[#C5A059] font-medium uppercase tracking-[0.2em] leading-relaxed">
                          Bu işlem mevcut verilerin üzerine yazacaktır.
                        </p>
                      </div>
                    </>
                  )}
                </SettingsCard>

                {/* Clear Audit Logs */}
                <SettingsCard title="Denetim İzlerini Arşivle ve Temizle" description="Sistem log yönetimi" icon={Trash2} accentColor="red" index={2}>
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    Tüm sistem erişim ve değişim loglarını güvenli bir şekilde yerel JSON olarak arşivleyip indirir, ardından veritabanından kalıcı olarak temizler.
                  </p>

                  {!isOnline ? (
                    <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-100 rounded-xl">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[9px] text-red-600 font-semibold uppercase tracking-[0.15em] leading-relaxed">
                        Denetim izlerini temizlemek için internet bağlantısı gereklidir.
                      </p>
                    </div>
                  ) : showArchiveConfirm ? (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col gap-2"
                    >
                      <p className="text-[9px] text-red-600 font-medium uppercase tracking-[0.2em]">
                        Loglar indirilip silinecektir. Emin misiniz?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleArchive}
                          disabled={isArchiving}
                          className="flex-1 bg-red-600 text-white text-[9px] font-medium py-2 rounded-xl hover:bg-red-700 transition-all uppercase tracking-[0.2em] disabled:opacity-60"
                        >
                          {isArchiving ? 'Arşivleniyor...' : 'Evet, Arşivle ve Sil'}
                        </button>
                        <button
                          onClick={() => setShowArchiveConfirm(false)}
                          className="flex-1 bg-[#F5F3EF] text-text-muted text-[9px] font-medium py-2 rounded-xl hover:bg-slate-100 transition-all uppercase tracking-[0.2em]"
                        >
                          İptal
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <ActionButton
                      variant="danger"
                      onClick={() => setShowArchiveConfirm(true)}
                      label={<><Trash2 className="w-3.5 h-3.5 stroke-[2]" />Arşivle ve Temizle</>}
                    />
                  )}
                </SettingsCard>

                {/* System Optimization */}
                <SettingsCard title="Sistem Optimizasyonu" description="Önbellek & bildirim temizliği" icon={Database} accentColor="slate" index={3}>
                  <p className="text-[11px] text-text-muted font-light leading-relaxed">
                    Okunmuş bildirimleri ve geçici önbelleği temizleyerek sistem performansını artırır.
                  </p>
                  <ActionButton
                    variant="secondary"
                    disabled={!isOnline}
                    onClick={async () => {
                      setImportStatus({ type: 'loading', message: 'Sistem Optimize Ediliyor...' });
                      await taskService.cleanupDatabase();
                      setImportStatus({ type: 'success', message: 'Sistem başarıyla optimize edildi.' });
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
