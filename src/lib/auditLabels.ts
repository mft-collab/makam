import { STATUS_LABELS, PRIORITY_LABELS } from '../constants';
import type { TaskStatus, TaskPriority } from '../types';

// Denetim izi (audit log) alan-bazlı diff görselleştirmesinde kullanılan
// Türkçe etiket haritası. TaskDetails.tsx (görev geçmişi sekmesi),
// TeamList.tsx (kullanıcı detay modalı, denetim izi sekmesi) ve
// AuditLogList.tsx (Denetim İzleri sekmesi) ile paylaşılır.
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  status: 'Durum', title: 'Başlık', description: 'Açıklama',
  assigneeId: 'Sorumlu', coordinatorId: 'İrtibatlı',
  priority: 'Öncelik', deadline: 'Son Tarih', evidence: 'Kanıt',
  deleted: 'Silindi', tags: 'Etiketler', estimatedHours: 'Tahmini Süre',
  checklist: 'Kontrol Listesi'
};

// Denetim izindeki eski/yeni değerleri okunabilir Türkçe metne çevirir.
// Ham enum değerleri (öncelik/durum) İngilizce saklanır; checklist gibi
// nesne dizileri ise JSON/"[object Object]" olarak değil özet halinde gösterilir.
export const formatAuditValue = (field: string, value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (field === 'checklist' && Array.isArray(value)) {
    const items = value as { isCompleted?: boolean }[];
    const done = items.filter(item => item?.isCompleted).length;
    return `${done}/${items.length} tamamlandı`;
  }
  if (field === 'priority' && typeof value === 'string' && value in PRIORITY_LABELS) {
    return PRIORITY_LABELS[value as TaskPriority];
  }
  if (field === 'status' && typeof value === 'string' && value in STATUS_LABELS) {
    return STATUS_LABELS[value as TaskStatus];
  }
  if (field === 'deleted') {
    return (value === true || value === 'true') ? 'Evet' : 'Hayır';
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 30);
  const str = String(value);
  return str.length > 20 ? str.slice(0, 20) + '...' : str;
};
