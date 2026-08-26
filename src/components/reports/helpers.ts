import type { Task, User, TaskBlocker, TaskStatus } from '../../types';
import { STATUS_LABELS_SHORT } from '../../constants';
import { isCompletedOnTime } from '../../lib/sla';
import { computeCompletionRatePercent } from '../dashboard/helpers';
import { format, subDays, differenceInCalendarDays } from 'date-fns';
import { tr } from 'date-fns/locale';

// dateFrom/dateTo salt tarih (yyyy-MM-dd) string'leri; saat eklenmeden
// parse edilirse ECMAScript bunu UTC gece yarısı sayar, saat eklenirse
// (ör. 'T23:59:59') YEREL saat sayar. İkisini karıştırmak (eskiden `to`
// saat ekliyor, `from` eklemiyordu) TR (UTC+3) için başlangıç gününün
// 00:00–02:59 aralığındaki kayıtların sessizce filtreden düşmesine yol
// açıyordu (bkz. kod denetimi). Her iki sınır da AÇIKÇA yerel saatle
// parse edilir ki gün sınırları tutarlı olsun.
export const parseRangeStart = (dateFrom: string): Date => new Date(dateFrom + 'T00:00:00');
export const parseRangeEnd = (dateTo: string): Date => new Date(dateTo + 'T23:59:59');

export const computeDepartmentsList = (users: User[], tasks: Task[]): string[] => {
  const depts = new Set<string>();
  users.forEach(u => {
    if (u.departmentId) depts.add(u.departmentId.trim());
  });
  tasks.forEach(t => {
    if (t.departmentId) depts.add(t.departmentId.trim());
  });
  return Array.from(depts);
};

// Bir görev, seçili tarih aralığıyla ÖRTÜŞÜYORSA (aralığın bitiminden önce zaten
// vardı VE ya hâlâ açık ya da bu aralık içinde sonuçlandı) kapsama girer.
// Eskiden yalnızca t.createdAt aralığa DÜŞEN görevler sayılıyordu — bu, aralıktan
// önce oluşturulmuş ama hâlâ AKTİF (ör. uzun süredir devam eden veya devredilmiş)
// bir görevi, o an fiilen bir sorumlunun elinde olmasına rağmen raporun tamamen
// dışında bırakıyordu. Sonuç: Yönetici Performans Endeksi'nde (ve aynı filtreyi
// paylaşan Personel Yük Dağılımı/SLA trendi/durum dağılımında) eski ama aktif iş
// yükü ağırlıklı bir yönetici "Veri yok" görünürken, yakın zamanda yeni görev
// alan bir başkası normal görünüyordu — aynı ekipteki iki kişi arasındaki veri
// var/yok tutarsızlığının kök nedeni buydu (bkz. kod denetimi). Tamamlanan/iptal
// edilen görevler için sonuç tarihi (completedAt / updatedAt) aralıktan ÖNCEYSE
// artık o dönemi ilgilendirmediğinden dışarıda bırakılır — yalnızca "hâlâ açık"
// veya "bu aralıkta sonuçlanmış" görevler sayılır. PDF/CSV dışa aktarma bundan
// etkilenmez: exportService kendi bağımsız (ve kasıtlı olarak salt createdAt'e
// dayalı) filtresini bu fonksiyonun çıktısı üzerine ayrıca uygular.
export const filterTasksByDateAndDept = (tasks: Task[], rangeStart: Date, rangeEnd: Date, selectedDept: string): Task[] => {
  const from = rangeStart.getTime();
  const to = rangeEnd.getTime();
  return tasks.filter(t => {
    const existedByRangeEnd = t.createdAt <= to;
    const isOpen = t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
    const resolvedAt = t.status === 'COMPLETED' ? (t.completedAt ?? t.updatedAt) : t.updatedAt;
    const matchDate = existedByRangeEnd && (isOpen || resolvedAt >= from);
    const matchDept = selectedDept === 'ALL' || t.departmentId === selectedDept;
    return matchDate && matchDept;
  });
};

// Seçili tarih/birim filtresine giren görevlere bağlı engeller — KPI kartının
// diğer metriklerle aynı kapsamı yansıtması için (öncesinde tüm sistemi
// gösteriyordu, filtreyle tutarsızdı).
export const filterBlockersByTasks = (blockers: TaskBlocker[], filteredTasks: Task[]): TaskBlocker[] => {
  const filteredTaskIds = new Set(filteredTasks.map(t => t.id));
  return blockers.filter(b => filteredTaskIds.has(b.taskId));
};

export const computeManagers = (users: User[], selectedDept: string): User[] =>
  users.filter(u => u.role === 'Manager' && (selectedDept === 'ALL' || u.departmentId === selectedDept));

// filteredTasks üzerinde her yönetici/personel için ayrı ayrı tam tarama
// yapmak yerine (O(kişi × görev) — tarih/departman filtresi her
// değiştiğinde tekrarlanıyordu) tek geçişte assigneeId'ye göre gruplanır
// (O(görev) + kişi başına O(1) lookup).
export const buildTasksByAssignee = (filteredTasks: Task[]): Map<string, Task[]> => {
  const map = new Map<string, Task[]>();
  for (const t of filteredTasks) {
    const list = map.get(t.assigneeId);
    if (list) list.push(t); else map.set(t.assigneeId, [t]);
  }
  return map;
};

export const getTasksForUser = (tasksByAssignee: Map<string, Task[]>, u: { uid: string; email: string }): Task[] => {
  const byUid = tasksByAssignee.get(u.uid) ?? [];
  if (u.email === u.uid) return byUid;
  const byEmail = tasksByAssignee.get(u.email) ?? [];
  return byEmail.length > 0 ? [...byUid, ...byEmail] : byUid;
};

export interface ManagerPerformanceRow extends User {
  total: number;
  completed: number;
  blocked: number;
  completionRate: number;
  slaRate: number;
  hasData: boolean;
}

export const computeManagerPerformance = (managers: User[], tasksByAssignee: Map<string, Task[]>): ManagerPerformanceRow[] =>
  managers.map(manager => {
    const mt = getTasksForUser(tasksByAssignee, manager);
    const completed = mt.filter(t => t.status === 'COMPLETED').length;
    const blocked   = mt.filter(t => t.status === 'BLOCKED').length;
    const total     = mt.length;
    // dashboard/helpers.ts'teki MERKEZİ tanım kullanılır (CANCELLED görevler
    // paydadan çıkarılır) — eskiden burada bağımsız bir formül vardı ve
    // Dashboard ile Reports aynı kavram için farklı rakamlar gösteriyordu
    // (bkz. kod denetimi).
    const completionRate = computeCompletionRatePercent(mt);
    const onTimeCompleted = mt.filter(isCompletedOnTime).length;
    const slaRate = completed > 0 ? Math.round((onTimeCompleted / completed) * 100) : 100;
    // total === 0 iken completionRate sabit %0 (kırmızı), slaRate sabit %100
    // (yeşil) dönüyor — aynı satırda birbiriyle çelişen, yanıltıcı bir "kötü
    // performans ama mükemmel SLA" görüntüsü oluşturuyordu (bkz. kod denetimi).
    // hasData bayrağı, seçili tarih/birim filtresinde bu yöneticiye ait hiç
    // görev olmadığını UI'da ayırt etmek için kullanılır.
    const hasData = total > 0;
    return { ...manager, total, completed, blocked, completionRate, slaRate, hasData };
  }).sort((a, b) => b.completionRate - a.completionRate);

export const computeAverageCompletionTime = (filteredTasks: Task[]): number => {
  const completed = filteredTasks.filter(t => t.status === 'COMPLETED');
  if (completed.length === 0) return 0;
  // Bekleme sürelerini (örn. BLOCKED durumu) hariç tutarak gerçek aktif çalışma süresini hesapla
  return completed.reduce((acc, t) => {
    const elapsed = (t.completedAt || t.updatedAt) - t.createdAt;
    const paused = t.totalPausedTime ?? 0;
    return acc + Math.max(0, elapsed - paused);
  }, 0) / completed.length;
};

export interface SlaTrendPoint {
  name: string;
  oran: number | null;
  tamamlanan: number;
}

// Önceki hali her gün için filteredTasks'ı baştan tarıyordu (14 × O(görev)).
// Burada tek geçişte tarihe göre 14 kovaya (bucket) dağıtılır — DST geçişlerinde
// yanlış gün hesaplamaması için ham ms farkı yerine date-fns'in takvim-günü
// farkı alan `differenceInCalendarDays`ı kullanılır (aynı yerel gün sınırlarını
// temel alır, tıpkı eski startOfDay/endOfDay aralığı gibi).
export const computeSlaComplianceTrend = (filteredTasks: Task[], today: Date): SlaTrendPoint[] => {
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
};

export interface StaffWorkloadRow {
  name: string;
  assigned: number;
  completed: number;
  total: number;
}

export const computeStaffWorkload = (users: User[], tasksByAssignee: Map<string, Task[]>, selectedDept: string): StaffWorkloadRow[] => {
  const staff = users.filter(u => u.role === 'Staff' && (selectedDept === 'ALL' || u.departmentId === selectedDept));
  return staff.map(u => {
    const ut = getTasksForUser(tasksByAssignee, u);
    const assigned = ut.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length;
    const completed = ut.filter(t => t.status === 'COMPLETED').length;
    return { name: u.fullName.split(' ')[0]!, assigned, completed, total: assigned + completed };
  }).filter(u => u.total > 0).sort((a, b) => b.total - a.total).slice(0, 6);
};

export interface StatusDistributionRow {
  label: string;
  color: string;
  count: number;
}

export const computeStatusDistribution = (filteredTasks: Task[]): StatusDistributionRow[] => {
  const map: Record<string, StatusDistributionRow> = {
    ASSIGNED:             { label: STATUS_LABELS_SHORT.ASSIGNED,           color: '#CBD5E1', count: 0 },
    PENDING_DELEGATION:   { label: STATUS_LABELS_SHORT.PENDING_DELEGATION, color: '#A78BFA', count: 0 },
    IN_PROGRESS:          { label: STATUS_LABELS_SHORT.IN_PROGRESS,        color: 'var(--color-status-info)', count: 0 },
    AWAITING_APPROVAL:    { label: STATUS_LABELS_SHORT.AWAITING_APPROVAL,  color: '#B38F46', count: 0 },
    BLOCKED:              { label: STATUS_LABELS_SHORT.BLOCKED,            color: '#A8201A', count: 0 },
    COMPLETED:            { label: STATUS_LABELS_SHORT.COMPLETED,          color: 'var(--chart-completed)', count: 0 },
  };
  filteredTasks.forEach(t => {
    const statusObj = map[t.status as TaskStatus];
    if (statusObj) {
      statusObj.count++;
    }
  });
  return Object.values(map).filter(v => v.count > 0);
};
