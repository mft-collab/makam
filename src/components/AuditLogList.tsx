import React, { useState, useEffect } from 'react';
import { ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';
import type { QueryDocumentSnapshot, DocumentData, QueryConstraint } from 'firebase/firestore';
import { AuditLog, Task, User, TaskStatus } from '../types';
import { Button } from './ui/Button';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { STATUS_LABELS, ROLE_LABELS, PRIORITY_LABELS } from '../constants';
import { db, collection, getDocs, query, where, orderBy, limit, startAfter } from '../firebase';
import { useUIStore } from '../store/uiStore';

interface AuditLogListProps {
  tasks: Task[];
  users: User[];
}

export const AuditLogList = ({ tasks, users }: AuditLogListProps) => {
  const addToast = useUIStore(state => state.addToast);
  const [logsState, setLogsState] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  // Filter States
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Aktör ve tarih aralığı filtreleri sunucu tarafında (Firestore sorgusu) uygulanır —
  // yalnızca yüklenmiş sayfada arama yapmak, henüz getirilmemiş eski kayıtları
  // yanlışlıkla "kayıt yok" gibi göstererek denetim aramalarını yanıltabilirdi.
  const buildQuery = (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
    const constraints: QueryConstraint[] = [];
    if (selectedUser !== 'ALL') constraints.push(where('changedBy', '==', selectedUser));
    if (dateFrom) constraints.push(where('timestamp', '>=', new Date(dateFrom).getTime()));
    if (dateTo) constraints.push(where('timestamp', '<=', new Date(dateTo + 'T23:59:59.999').getTime()));
    constraints.push(orderBy('timestamp', 'desc'));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(15));
    return query(collection(db, 'audit_logs'), ...constraints);
  };

  const fetchLogs = async (isFirstLoad = false, cursor: QueryDocumentSnapshot<DocumentData> | null = null) => {
    if (loading) return;
    setLoading(true);
    try {
      const snapshot = await getDocs(buildQuery(cursor));
      const newLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));

      if (isFirstLoad) {
        setLogsState(newLogs);
      } else {
        setLogsState(prev => [...prev, ...newLogs]);
      }

      if (snapshot.docs.length < 15) {
        setHasMore(false);
      } else {
        setHasMore(true);
        setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      addToast({ title: '⚠️ Denetim İzi Yüklenemedi', body: 'Kayıtlar getirilirken bir hata oluştu. Lütfen tekrar deneyin.', type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  // Aktör veya tarih aralığı değiştiğinde sorguyu baştan başlat (sayfalama sıfırlanır)
  useEffect(() => {
    setLogsState([]);
    setLastVisibleDoc(null);
    setHasMore(true);
    fetchLogs(true, null);
  }, [selectedUser, dateFrom, dateTo]);

  const filteredLogs = logsState.filter(log => {
    const isStatusChange = !log.changes && log.newValue !== undefined;
    const matchType = selectedType === 'ALL' ||
      (selectedType === 'STATUS' && isStatusChange) ||
      (selectedType === 'FIELD' && (log.changes !== undefined || (log.newValue === undefined && log.oldValue === undefined)));
    return matchType;
  });

  return (
    <div className="flex flex-col gap-5 py-4 max-w-[1440px] mx-auto font-sans">

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-executive-blue/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-executive-blue flex items-center justify-center shadow-lg">
            <ShieldCheck className="w-4 h-4 text-white stroke-[1.5]" />
          </div>
          <div>
            <span className="text-[10px] font-medium text-executive-blue uppercase tracking-[0.4em] block leading-none">DENETİM İZLERİ</span>
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.3em]">
              {loading && logsState.length === 0 ? 'Yükleniyor...' : `${filteredLogs.length} / ${logsState.length} Kayıt`}
            </span>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* User Filter select */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2">
            <Avatar size="xs" name="Filter" />
            <select
              value={selectedUser}
              onChange={e => setSelectedUser(e.target.value)}
              className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer pr-4 font-medium"
              aria-label="Aktör Filtresi"
            >
              <option value="ALL" className="bg-surface-base text-text-heading">Tüm Aktörler</option>
              {users.map(u => (
                <option key={u.uid} value={u.uid} className="bg-surface-base text-text-heading">
                  {u.fullName}
                </option>
              ))}
            </select>
          </div>

          {/* Action Type filter select */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2">
            <ShieldCheck className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" />
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer pr-4 font-medium"
              aria-label="İşlem Tipi Filtresi"
            >
              <option value="ALL" className="bg-surface-base text-text-heading">Tüm İşlemler</option>
              <option value="STATUS" className="bg-surface-base text-text-heading">Durum Değişiklikleri</option>
              <option value="FIELD" className="bg-surface-base text-text-heading">İçerik Güncellemeleri</option>
            </select>
          </div>

          {/* Date range filter */}
          <div className="flex items-center gap-1.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2">
            <label htmlFor="audit-date-from" className="sr-only">Başlangıç Tarihi</label>
            <input
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              max={dateTo || undefined}
              className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer font-medium"
              aria-label="Başlangıç Tarihi"
            />
            <ArrowRight className="w-3 h-3 text-text-tertiary flex-shrink-0" />
            <label htmlFor="audit-date-to" className="sr-only">Bitiş Tarihi</label>
            <input
              id="audit-date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              className="text-[11px] text-text-heading bg-transparent outline-none border-none cursor-pointer font-medium"
              aria-label="Bitiş Tarihi"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-[9px] text-text-tertiary hover:text-executive-blue uppercase tracking-wider pl-1"
              >
                Temizle
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {filteredLogs.length > 0 ? (
          filteredLogs.map((log) => {
            const task = tasks.find((t: Task) => t.id === log.taskId);
            const user = users.find((u: User) => u.uid === log.changedBy);

            return (
              <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl group hover:bg-surface-elevated hover:shadow-sm transition-all relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-executive-blue/10 group-hover:bg-executive-blue transition-all rounded-l-xl" />

                <div className="flex items-center gap-6 flex-1">
                  {/* Avatar */}
                  <Avatar
                    name={user?.fullName ?? 'Dizge'}
                    photoURL={user?.photoURL}
                    size="sm"
                  />
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-executive-blue tracking-tight group-hover:text-executive-blue transition-colors">{user?.fullName || 'Dizge'}</span>
                      <span className="text-[8px] text-text-tertiary font-medium uppercase tracking-[0.15em] px-1.5 py-0.5 bg-surface-glass border border-surface-border rounded-md">{user ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] : ''}</span>
                    </div>
                    <span className="text-[9px] text-text-tertiary uppercase tracking-[0.2em]">{new Date(log.timestamp).toLocaleString('tr-TR')}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 flex-[1.2] border-t sm:border-t-0 sm:border-l border-executive-blue/[0.04] pt-2.5 sm:pt-0 sm:pl-4">
                  <span className="text-[8px] text-text-tertiary font-medium uppercase tracking-[0.25em]">Operasyon Hedefi</span>
                  <span className="text-[12px] font-medium text-executive-blue truncate max-w-[280px] font-serif">{task?.title || 'Bilinmeyen Talimat'}</span>
                </div>

                <div className="flex flex-col gap-2 flex-[1.6] border-t sm:border-t-0 sm:border-l border-executive-blue/[0.04] pt-2.5 sm:pt-0 sm:pl-4">
                  <span className="text-[8px] text-text-tertiary font-medium uppercase tracking-[0.25em]">Durum Değişimi / Değer Detayı</span>
                  {log.changes ? (
                    <div className="flex flex-col gap-1.5 w-full max-w-[340px]">
                      {Object.entries(log.changes).map(([field, diff]) => {
                        const fieldLabel = {
                          title: 'Başlık',
                          description: 'Açıklama',
                          assigneeId: 'Sorumlu',
                          coordinatorId: 'İrtibatlı',
                          priority: 'Öncelik',
                          deadline: 'Son Tarih',
                          evidence: 'Kanıt',
                          tags: 'Etiketler',
                          estimatedHours: 'Tahmini Süre',
                          status: 'Durum',
                          deleted: 'Silindi'
                        }[field] || field;

                        const truncateValue = (val: unknown) => {
                          if (val === null || val === undefined) return '-';
                          // Ham enum değerleri (ör. öncelik/durum) İngilizce saklanır —
                          // denetim izinde okunabilir olması için Türkçe etikete çevrilir.
                          if (field === 'priority' && typeof val === 'string' && val in PRIORITY_LABELS) {
                            return PRIORITY_LABELS[val as keyof typeof PRIORITY_LABELS];
                          }
                          if (field === 'status' && typeof val === 'string' && val in STATUS_LABELS) {
                            return STATUS_LABELS[val as TaskStatus];
                          }
                          if (field === 'deleted' && typeof val === 'boolean') {
                            return val ? 'Evet' : 'Hayır';
                          }
                          if (typeof val === 'object') return JSON.stringify(val).slice(0, 30);
                          const str = String(val);
                          return str.length > 20 ? str.slice(0, 20) + '...' : str;
                        };

                        return (
                          <div key={field} className="flex flex-col gap-0.5 text-[9px] bg-executive-blue/[0.02] border border-executive-blue/[0.04] p-1.5 rounded-lg">
                            <span className="font-bold text-[8px] text-text-tertiary uppercase tracking-wider">{fieldLabel}</span>
                            <div className="flex items-center gap-1 text-[10px] text-text-muted">
                              <span className="line-through opacity-60 truncate max-w-[120px]">{truncateValue(diff.old)}</span>
                              <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" />
                              <span className="font-medium text-text-heading truncate max-w-[120px]">{truncateValue(diff.new)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={
                        log.oldValue === 'COMPLETED' ? 'success' :
                        log.oldValue === 'BLOCKED' ? 'danger' :
                        log.oldValue === 'IN_PROGRESS' ? 'info' :
                        log.oldValue === 'AWAITING_APPROVAL' ? 'warning' :
                        'default'
                      }>
                        {STATUS_LABELS[log.oldValue as TaskStatus] || String(log.oldValue)}
                      </Badge>
                      <ArrowRight className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                      <Badge variant={
                        log.newValue === 'COMPLETED' ? 'success' :
                        log.newValue === 'BLOCKED' ? 'danger' :
                        log.newValue === 'IN_PROGRESS' ? 'info' :
                        log.newValue === 'AWAITING_APPROVAL' ? 'warning' :
                        'default'
                      }>
                        {STATUS_LABELS[log.newValue as TaskStatus] || String(log.newValue)}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          !loading && (
            <div className="py-16 flex flex-col items-center justify-center bg-surface-glass border border-dashed border-executive-blue/[0.05] rounded-2xl gap-4">
              <ShieldCheck className="w-10 h-10 text-surface-border/50 stroke-[1]" />
              <span className="text-[9px] text-text-tertiary uppercase tracking-[0.4em]">Kayıt Bulunamadı</span>
            </div>
          )
        )}
      </div>

      {hasMore && logsState.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button
            variant="secondary"
            onClick={() => fetchLogs(false, lastVisibleDoc)}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 uppercase tracking-[0.2em] text-[10px] font-medium rounded-xl border border-surface-border bg-surface-elevated hover:bg-surface-glass transition-all"
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            Daha Fazla Yükle
          </Button>
        </div>
      )}

      {loading && logsState.length === 0 && (
        <div className="py-16 flex justify-center items-center">
          <Loader2 className="w-6 h-6 animate-spin text-executive-blue" />
        </div>
      )}

    </div>
  );
};
