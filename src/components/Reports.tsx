import React, { useMemo, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Target, Zap, TrendingUp, BarChart3, Users, CheckCircle2, Loader2, Download, FileText, Calendar, ArrowRight } from 'lucide-react';
import { Task, User, TaskBlocker } from '../types';
import { cn } from '../lib/utils';
import { isCompletedOnTime } from '../lib/sla';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { format, subDays, differenceInCalendarDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useUIStore } from '../store/uiStore';

interface ReportsProps {
  tasks: Task[];
  users: User[];
  blockers: TaskBlocker[];
  setActiveTab?: (tab: string) => void;
}

// ─── Compact KPI Card ─────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  color: 'blue' | 'red' | 'green';
  index?: number;
}

const KpiCard = ({ label, value, icon: Icon, color, index = 0 }: KpiCardProps) => {
  const palette = {
    blue:  { bg: 'bg-executive-blue/5',   icon: 'text-executive-blue',  bar: 'bg-executive-blue' },
    red:   { bg: 'bg-status-danger/10',   icon: 'text-status-danger',   bar: 'bg-status-danger' },
    green: { bg: 'bg-status-success/10',  icon: 'text-status-success',  bar: 'bg-status-success' },
  }[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: index * 0.06 }}
      className="flex items-center gap-3 p-3.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl shadow-[0_1px_8px_rgba(22,21,19,0.02)] hover:shadow-md hover:bg-surface-elevated transition-all duration-300 group"
    >
      <div className={cn('w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform', palette.bg)}>
        <Icon className={cn('w-4 h-4 stroke-[1.5]', palette.icon)} />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[22px] font-light text-executive-blue tracking-tight tabular-nums leading-none font-serif">
          {value}
        </span>
        <span className="text-[9px] text-text-tertiary font-medium uppercase tracking-[0.3em]">{label}</span>
      </div>
    </motion.div>
  );
};

// ─── Reports ──────────────────────────────────────────────────────────────────
export const Reports = ({ tasks: propsTasks, users, blockers: propsBlockers, setActiveTab }: ReportsProps) => {
  const addToast = useUIStore(state => state.addToast);
  const tasks = propsTasks;
  const blockers = propsBlockers;

  // ─── Tarih Aralığı Filtresi ───────────────────────────────────────────────
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(format(subDays(today, 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(today, 'yyyy-MM-dd'));
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  // Native <input type="date"> boş/eksik yazarken (ör. ayırıcı karakter
  // yazılırken) geçici olarak '' raporlayabilir; bu değer state'e girerse
  // aşağıdaki format(new Date(dateFrom), ...) çağrısı date-fns'te
  // "RangeError: Invalid time value" fırlatıp ekranı ErrorBoundary'e
  // düşürüyordu (bkz. kod denetimi). Geçersiz/boş girişler state'e hiç
  // yazılmaz — son geçerli tarih korunur.
  const isValidDateInput = (value: string) => value !== '' && !Number.isNaN(new Date(value).getTime());
  const handleDateFromChange = (value: string) => { if (isValidDateInput(value)) setDateFrom(value); };
  const handleDateToChange = (value: string) => { if (isValidDateInput(value)) setDateTo(value); };

  const departmentsList = useMemo(() => {
    const depts = new Set<string>();
    users.forEach(u => {
      if (u.departmentId) depts.add(u.departmentId.trim());
    });
    tasks.forEach(t => {
      if (t.departmentId) depts.add(t.departmentId.trim());
    });
    return Array.from(depts);
  }, [users, tasks]);

  const filteredTasks = useMemo(() => {
    const from = new Date(dateFrom).getTime();
    const to = new Date(dateTo + 'T23:59:59').getTime();
    return tasks.filter(t => {
      const matchDate = t.createdAt >= from && t.createdAt <= to;
      const matchDept = selectedDept === 'ALL' || t.departmentId === selectedDept;
      return matchDate && matchDept;
    });
  }, [tasks, dateFrom, dateTo, selectedDept]);

  // Seçili tarih/birim filtresine giren görevlere bağlı engeller — KPI kartının
  // diğer metriklerle aynı kapsamı yansıtması için (öncesinde tüm sistemi
  // gösteriyordu, filtreyle tutarsızdı).
  const filteredBlockers = useMemo(() => {
    const filteredTaskIds = new Set(filteredTasks.map(t => t.id));
    return blockers.filter(b => filteredTaskIds.has(b.taskId));
  }, [blockers, filteredTasks]);

  // jsPDF (+html2canvas, ~140KB gzip) yalnızca Export butonuna basıldığında
  // yükleniyor — statik import Reports sekmesine her girişte bu paketi
  // gereksiz yere indiriyordu.
  const handleExportPDF = useCallback(async () => {
    setIsExporting(true);
    try {
      const { exportTasksToPDF } = await import('../services/exportService');
      await exportTasksToPDF(filteredTasks, users, {
        from: new Date(dateFrom),
        to: new Date(dateTo + 'T23:59:59'),
      });
    } catch (err) {
      console.error('PDF export hatası:', err);
      addToast({ title: '⚠️ Dışa Aktarma Başarısız', body: 'PDF raporu oluşturulurken bir hata oluştu. Lütfen tekrar deneyin.', type: 'danger' });
    } finally {
      setIsExporting(false);
    }
  }, [filteredTasks, users, dateFrom, dateTo]);

  const handleExportCSV = useCallback(async () => {
    const { exportTasksToCSV } = await import('../services/exportService');
    exportTasksToCSV(filteredTasks, users, {
      from: new Date(dateFrom),
      to: new Date(dateTo + 'T23:59:59'),
    });
  }, [filteredTasks, users, dateFrom, dateTo]);

  const managers = useMemo(() => {
    return users.filter(u => u.role === 'Manager' && (selectedDept === 'ALL' || u.departmentId === selectedDept));
  }, [users, selectedDept]);

  // filteredTasks üzerinde her yönetici/personel için ayrı ayrı tam tarama
  // yapmak yerine (O(kişi × görev) — tarih/departman filtresi her
  // değiştiğinde tekrarlanıyordu) tek geçişte assigneeId'ye göre gruplanır
  // (O(görev) + kişi başına O(1) lookup).
  const tasksByAssignee = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filteredTasks) {
      const list = map.get(t.assigneeId);
      if (list) list.push(t); else map.set(t.assigneeId, [t]);
    }
    return map;
  }, [filteredTasks]);

  const tasksForUser = (u: { uid: string; email: string }): Task[] => {
    const byUid = tasksByAssignee.get(u.uid) ?? [];
    if (u.email === u.uid) return byUid;
    const byEmail = tasksByAssignee.get(u.email) ?? [];
    return byEmail.length > 0 ? [...byUid, ...byEmail] : byUid;
  };

  const managerPerformance = useMemo(() => managers.map(manager => {
    const mt = tasksForUser(manager);
    const completed = mt.filter(t => t.status === 'COMPLETED').length;
    const blocked   = mt.filter(t => t.status === 'BLOCKED').length;
    const total     = mt.length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const onTimeCompleted = mt.filter(isCompletedOnTime).length;
    const slaRate = completed > 0 ? Math.round((onTimeCompleted / completed) * 100) : 100;
    // total === 0 iken completionRate sabit %0 (kırmızı), slaRate sabit %100
    // (yeşil) dönüyor — aynı satırda birbiriyle çelişen, yanıltıcı bir "kötü
    // performans ama mükemmel SLA" görüntüsü oluşturuyordu (bkz. kod denetimi).
    // hasData bayrağı, seçili tarih/birim filtresinde bu yöneticiye ait hiç
    // görev olmadığını UI'da ayırt etmek için kullanılır.
    const hasData = total > 0;
    return { ...manager, total, completed, blocked, completionRate, slaRate, hasData };
  }).sort((a, b) => b.completionRate - a.completionRate), [managers, tasksByAssignee]);

  const averageCompletionTime = useMemo(() => {
    const completed = filteredTasks.filter(t => t.status === 'COMPLETED');
    if (completed.length === 0) return 0;
    // Bekleme sürelerini (örn. BLOCKED durumu) hariç tutarak gerçek aktif çalışma süresini hesapla
    return completed.reduce((acc, t) => {
      const elapsed = (t.completedAt || t.updatedAt) - t.createdAt;
      const paused = t.totalPausedTime ?? 0;
      return acc + Math.max(0, elapsed - paused);
    }, 0) / completed.length;
  }, [filteredTasks]);

  const avgDays = Math.round(averageCompletionTime / (1000 * 60 * 60 * 24));
  const completionRate = filteredTasks.length > 0
    ? Math.round((filteredTasks.filter(t => t.status === 'COMPLETED').length / filteredTasks.length) * 100)
    : 0;

  // #6 — Son 14 gün SLA uyum oranı (trend)
  // Önceki hali her gün için filteredTasks'ı baştan tarıyordu (14 × O(görev)).
  // Burada tek geçişte tarihe göre 14 kovaya (bucket) dağıtılır — DST geçişlerinde
  // yanlış gün hesaplamaması için ham ms farkı yerine date-fns'in takvim-günü
  // farkı alan `differenceInCalendarDays`ı kullanılır (aynı yerel gün sınırlarını
  // temel alır, tıpkı eski startOfDay/endOfDay aralığı gibi).
  const slaComplianceTrend = useMemo(() => {
    const today = new Date();
    const buckets: { completed: number; onTime: number }[] = Array.from({ length: 14 }, () => ({ completed: 0, onTime: 0 }));
    for (const t of filteredTasks) {
      if (t.status !== 'COMPLETED') continue;
      const daysAgo = differenceInCalendarDays(today, new Date(t.updatedAt));
      const dayIndex = 13 - daysAgo;
      const bucket = dayIndex >= 0 && dayIndex <= 13 ? buckets[dayIndex] : undefined;
      if (!bucket) continue;
      bucket.completed++;
      if (isCompletedOnTime(t)) bucket.onTime++;
    }
    return buckets.map((b, i) => {
      const day = subDays(today, 13 - i);
      return {
        name: format(day, 'dd MMM', { locale: tr }),
        oran: b.completed > 0 ? Math.round((b.onTime / b.completed) * 100) : null,
        tamamlanan: b.completed,
      };
    });
  }, [filteredTasks]);

  // #6 — Personel yük dağılımı (Staff bazlı)
  const staffWorkload = useMemo(() => {
    const staff = users.filter(u => u.role === 'Staff' && (selectedDept === 'ALL' || u.departmentId === selectedDept));
    return staff.map(u => {
      const ut = tasksForUser(u);
      const assigned = ut.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length;
      const completed = ut.filter(t => t.status === 'COMPLETED').length;
      return { name: u.fullName.split(' ')[0], assigned, completed, total: assigned + completed };
    }).filter(u => u.total > 0).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [users, tasksByAssignee, selectedDept]);

  // #6 — Durum dağılımı (Pie chart verisi)
  const statusDistribution = useMemo(() => {
    const map: Record<string, { label: string; color: string; count: number }> = {
      ASSIGNED:             { label: 'Atandı',    color: '#CBD5E1', count: 0 },
      PENDING_DELEGATION:   { label: 'Devrediliyor', color: '#A78BFA', count: 0 },
      IN_PROGRESS:          { label: 'İşlemde',   color: 'var(--color-executive-blue)', count: 0 },
      AWAITING_APPROVAL:    { label: 'Onayda',    color: '#B38F46', count: 0 },
      BLOCKED:              { label: 'Engelli',   color: '#A8201A', count: 0 },
      COMPLETED:            { label: 'Tamam',     color: 'var(--chart-completed)', count: 0 },
    };
    filteredTasks.forEach(t => {
      const statusObj = map[t.status];
      if (statusObj) {
        statusObj.count++;
      }
    });
    return Object.values(map).filter(v => v.count > 0);
  }, [filteredTasks]);

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-executive-blue/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-executive-blue flex items-center justify-center shadow-lg">
            <TrendingUp className="w-4 h-4 text-white stroke-[1.5]" aria-hidden="true" />
          </div>
          <div>
            <span className="text-[10px] font-medium text-executive-blue uppercase tracking-[0.4em] block leading-none">
              OPERASYONEL ANALİTİK
            </span>
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">İçgörü Matrisi</span>
          </div>
        </div>

        {/* Tarih Aralığı + Birim Filtresi + Export */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Birim Filtresi */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2">
            <Users className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" aria-hidden="true" />
            <select
              value={selectedDept}
              onChange={e => setSelectedDept(e.target.value)}
              className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer pr-4 font-medium"
              aria-label="Birim Filtresi"
            >
              <option value="ALL" className="bg-surface-base text-text-heading">Tüm Birimler</option>
              {departmentsList.map(dept => (
                <option key={dept} value={dept} className="bg-surface-base text-text-heading">
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" aria-hidden="true" />
            <label htmlFor="report-date-from" className="sr-only">Başlangıç tarihi</label>
            <input
              id="report-date-from"
              type="date"
              value={dateFrom}
              onChange={e => handleDateFromChange(e.target.value)}
              className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer"
              aria-label="Rapor başlangıç tarihi"
            />
            <span className="text-[10px] text-text-tertiary mx-1">—</span>
            <label htmlFor="report-date-to" className="sr-only">Bitiş tarihi</label>
            <input
              id="report-date-to"
              type="date"
              value={dateTo}
              onChange={e => handleDateToChange(e.target.value)}
              className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer"
              aria-label="Rapor bitiş tarihi"
            />
          </div>

          <button
            onClick={handleExportCSV}
            aria-label="Raporu CSV olarak dışa aktar"
            className="flex items-center gap-1.5 px-3 py-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl text-[10px] uppercase tracking-widest text-text-muted hover:text-executive-blue hover:bg-surface-elevated transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue"
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            CSV
          </button>

          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            aria-label="Raporu PDF olarak dışa aktar"
            className="flex items-center gap-1.5 px-3 py-2 bg-executive-blue text-white rounded-2xl text-[10px] uppercase tracking-widest hover:bg-executive-blue/90 transition-all shadow-lg shadow-executive-blue/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue focus-visible:ring-offset-2"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {isExporting ? 'Hazırlanıyor...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Filtre özeti — önceden çok soluk (text-tertiary) olduğundan, dar bir
          tarih aralığında %0 gibi görünen metrikler "herkesin performansı
          kötü" gibi yanlış okunabiliyordu; aktif kapsam artık daha belirgin
          (bkz. kod denetimi). */}
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-widest font-medium">
        <Calendar className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{filteredTasks.length} talimat</span>
        <span>·</span>
        <span className="tabular-nums">{format(new Date(dateFrom), 'd MMM yyyy', { locale: tr })} — {format(new Date(dateTo), 'd MMM yyyy', { locale: tr })}</span>
      </div>

      {/* ── KPI Cards — 1 col mobile, 3 cols sm+ ─────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Ort. Tamamlanma" value={`${avgDays} Gün`}  icon={Zap}           color="blue"  index={0} />
        <KpiCard label="Aktif Darboğaz"  value={`${filteredBlockers.filter(b => !b.isResolved).length}`} icon={AlertTriangle} color="red" index={1} />
        <KpiCard label="Hedef Gerçekleşme" value={`%${completionRate}`} icon={Target}    color="green" index={2} />
      </div>

      {/* ── Görsel Analiz — özet sayılardan sonra, detay tablosundan önce ── */}
      {/* #6 — SLA Trend + Durum Dağılımı */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* SLA Uyum Trend Çizgi Grafiği */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.2 }}
          className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[13px] font-medium text-executive-blue font-serif tracking-tight">SLA Uyum Trendi</h3>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">Son 14 Gün</p>
            </div>
            <TrendingUp className="w-4 h-4 text-executive-gold stroke-[1.5]" />
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={slaComplianceTrend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" fontSize={8} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }} />
                <YAxis domain={[0, 100]} fontSize={8} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }}
                  tickFormatter={(v) => `%${v}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface-base)',
                    borderColor: 'var(--color-surface-border)',
                    borderRadius: '14px',
                    fontSize: '11px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                    backdropFilter: 'blur(20px)',
                    color: 'var(--color-text-heading)'
                  }}
                  itemStyle={{ color: 'var(--color-text-body)' }}
                  formatter={(v: any) => v !== null ? [`%${v}`, 'SLA Uyum'] : ['Veri yok', '']}
                />
                <Line dataKey="oran" stroke="#C5A059" strokeWidth={2} dot={{ r: 3, fill: '#C5A059' }}
                  activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Durum Dağılımı (Pie) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.25 }}
          className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[13px] font-medium text-executive-blue font-serif tracking-tight">Talimat Dağılımı</h3>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">Durum Matrisi</p>
            </div>
            <CheckCircle2 className="w-4 h-4 text-status-success stroke-[1.5]" />
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusDistribution} dataKey="count" nameKey="label"
                  cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                  paddingAngle={3}
                >
                  {statusDistribution.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface-base)',
                    borderColor: 'var(--color-surface-border)',
                    borderRadius: '14px',
                    fontSize: '11px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                    backdropFilter: 'blur(20px)',
                    color: 'var(--color-text-heading)'
                  }}
                  itemStyle={{ color: 'var(--color-text-body)' }}
                  formatter={(v: any, name: any) => [v, name]}
                />
                <Legend iconSize={8} iconType="circle"
                  formatter={(v) => <span style={{ fontSize: 9, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Personel Yük Dağılımı */}
      {staffWorkload.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.3 }}
          className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl p-4 shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[13px] font-medium text-executive-blue font-serif tracking-tight">Personel İş Yükü</h3>
              <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">Aktif vs Tamamlanan</p>
            </div>
            <Users className="w-4 h-4 text-text-tertiary stroke-[1]" />
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={staffWorkload} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="barActive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-executive-blue)" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="var(--color-executive-blue)" stopOpacity="0.35" />
                  </linearGradient>
                  <linearGradient id="barCompleted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-completed)" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="var(--chart-completed)" stopOpacity="0.35" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }} />
                <YAxis fontSize={8} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-light)' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface-base)',
                    borderColor: 'var(--color-surface-border)',
                    borderRadius: '14px',
                    fontSize: '11px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                    backdropFilter: 'blur(20px)',
                    color: 'var(--color-text-heading)'
                  }}
                  itemStyle={{ color: 'var(--color-text-body)' }}
                  cursor={{ fill: 'rgba(22, 21, 19, 0.02)' }}
                />
                <Bar dataKey="assigned" name="Aktif" fill="url(#barActive)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Tamamlanan" fill="url(#barCompleted)" radius={[4, 4, 0, 0]} />
                <Legend iconSize={8} iconType="circle"
                  formatter={(v) => <span style={{ fontSize: 9, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>{v}</span>}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* ── Manager Performance Table ─────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 28, delay: 0.4 }}
        className="bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl overflow-hidden shadow-[0_1px_8px_rgba(22,21,19,0.02)]"
      >
        {/* Table header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-executive-blue/[0.04]">
          <div>
            <h3 className="text-[13px] font-medium text-executive-blue font-serif tracking-tight">Yönetici Performans Endeksi</h3>
            <p className="text-[9px] text-text-tertiary uppercase tracking-[0.3em] mt-0.5">{managerPerformance.length} Yetkili</p>
          </div>
          <BarChart3 className="w-5 h-5 text-surface-border/50 stroke-[1]" />
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-makam-border/30">
          {managerPerformance.length === 0 ? (
            <div className="py-12 text-center text-[10px] text-text-tertiary uppercase tracking-[0.4em]">
              Veri bulunamadı
            </div>
          ) : (
            managerPerformance.map((m, i) => (
              <motion.div
                key={m.uid}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', stiffness: 280, damping: 30, delay: i * 0.04 }}
                className="flex items-center gap-3 p-3.5"
              >
                <div className="w-9 h-9 rounded-full bg-surface-elevated border border-executive-blue/[0.06] flex items-center justify-center text-[14px] font-light text-executive-blue flex-shrink-0">
                  {m.fullName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-executive-blue font-serif line-clamp-1">{m.fullName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] text-text-tertiary tabular-nums">{m.total} talimat</span>
                    <span className="text-[9px] text-status-success tabular-nums">{m.completed} tamamlandı</span>
                    {m.blocked > 0 && <span className="text-[9px] text-status-danger tabular-nums">{m.blocked} engel</span>}
                    {m.hasData ? (
                      <span className={cn(
                        'text-[9px] font-bold px-1.5 py-0.5 rounded border',
                        m.slaRate > 80 ? 'text-status-success border-status-success/20 bg-status-success/10' :
                        m.slaRate > 50 ? 'text-executive-gold border-executive-gold/20 bg-executive-gold/10' :
                        'text-status-danger border-status-danger/20 bg-status-danger/10'
                      )}>SLA %{m.slaRate}</span>
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-text-tertiary border-surface-border bg-surface-glass">Veri yok</span>
                    )}
                  </div>
                  {m.hasData ? (
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1 bg-surface-border rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${m.completionRate}%` }}
                        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: i * 0.05 }}
                        className={cn(
                          'h-full rounded-full',
                          m.completionRate > 70 ? 'bg-status-success' :
                          m.completionRate > 40 ? 'bg-executive-gold' : 'bg-status-danger'
                        )}
                      />
                    </div>
                    <span className={cn(
                      'text-[10px] font-medium tabular-nums w-8 text-right',
                      m.completionRate > 70 ? 'text-status-success' :
                      m.completionRate > 40 ? 'text-executive-gold' : 'text-status-danger'
                    )}>%{m.completionRate}</span>
                  </div>
                  ) : (
                    <p className="text-[9px] text-text-tertiary mt-1.5">Seçili aralıkta talimat yok</p>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto custom-scrollbar">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-glass">
                {[
                  { label: 'Yetkili Makam', align: 'left' },
                  { label: 'İş Yükü',       align: 'center' },
                  { label: 'Çıktı',          align: 'center' },
                  { label: 'Darboğaz',       align: 'center' },
                  { label: 'SLA Uyum',       align: 'center' },
                  { label: 'Performans',     align: 'right' },
                ].map(({ label, align }) => (
                  <th
                    key={label}
                    className={cn(
                      'px-4 py-3 text-[8px] font-medium text-text-tertiary uppercase tracking-[0.35em]',
                      align === 'center' && 'text-center',
                      align === 'right'  && 'text-right'
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-makam-border/30">
              {managerPerformance.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[10px] text-text-tertiary uppercase tracking-[0.4em]">
                    Yönetici kaydı bulunamadı.
                  </td>
                </tr>
              ) : (
                managerPerformance.map((m, i) => (
                  <motion.tr
                    key={m.uid}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => setActiveTab?.('tasks')}
                    title="Bu yöneticinin talimatlarını görmek için tıklayın"
                    className="hover:bg-makam-glass transition-all duration-300 group cursor-pointer"
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface-elevated border border-executive-blue/[0.06] flex items-center justify-center text-[13px] font-light text-executive-blue shadow-inner flex-shrink-0 group-hover:scale-105 transition-transform">
                          {m.fullName.charAt(0)}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[13px] font-medium text-executive-blue font-serif tracking-tight group-hover:text-executive-blue transition-colors">
                            {m.fullName}
                          </span>
                          <span className="text-[8px] text-text-tertiary uppercase tracking-[0.25em]">
                            {m.departmentId || 'Stratejik Planlama'}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Total */}
                    <td className="px-4 py-3 text-center">
                      <span className="text-[16px] font-light text-executive-blue tabular-nums">{m.total}</span>
                    </td>

                    {/* Completed */}
                    <td className="px-4 py-3 text-center">
                      <span className="text-[12px] font-medium text-status-success bg-status-success/10 px-3 py-1 rounded-lg border border-status-success/20 tabular-nums">
                        {m.completed}
                      </span>
                    </td>

                    {/* Blocked */}
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        'text-[12px] font-medium px-3 py-1 rounded-lg border tabular-nums',
                        m.blocked > 0
                          ? 'text-status-danger bg-status-danger/10 border-status-danger/20'
                          : 'text-text-tertiary bg-surface-glass border-surface-border'
                      )}>
                        {m.blocked}
                      </span>
                    </td>

                    {/* SLA Rate */}
                    <td className="px-4 py-3 text-center">
                      {m.hasData ? (
                        <span className={cn(
                          'text-[12px] font-medium px-3 py-1 rounded-lg border tabular-nums',
                          m.slaRate > 80 ? 'text-status-success bg-status-success/10 border-status-success/20' :
                          m.slaRate > 50 ? 'text-executive-gold bg-executive-gold/10 border-executive-gold/20' :
                          'text-status-danger bg-status-danger/10 border-status-danger/20'
                        )}>
                          %{m.slaRate}
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium px-3 py-1 rounded-lg border text-text-tertiary bg-surface-glass border-surface-border uppercase tracking-wider">
                          Veri Yok
                        </span>
                      )}
                    </td>

                    {/* Score + progress bar + nav arrow */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {m.hasData ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={cn(
                            'text-[18px] font-light tabular-nums tracking-tight font-serif',
                            m.completionRate > 70 ? 'text-status-success' :
                            m.completionRate > 40 ? 'text-executive-gold' : 'text-status-danger'
                          )}>
                            %{m.completionRate}
                          </span>
                          <div className="w-24 h-1 bg-surface-border/80 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${m.completionRate}%` }}
                              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.06 }}
                              className={cn(
                                'h-full rounded-full',
                                m.completionRate > 70 ? 'bg-status-success' :
                                m.completionRate > 40 ? 'bg-executive-gold' : 'bg-status-danger'
                              )}
                            />
                          </div>
                        </div>
                        ) : (
                          <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Seçili aralıkta talimat yok</span>
                        )}
                        <div className="w-6 h-6 rounded-full bg-executive-blue/5 border border-executive-blue/10 flex items-center justify-center group-hover:bg-executive-blue group-hover:border-transparent transition-all flex-shrink-0">
                          <ArrowRight className="w-3 h-3 text-text-tertiary group-hover:text-white stroke-[2] transition-colors" />
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

    </div>
  );
};
