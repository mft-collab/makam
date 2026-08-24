import { TaskStatus, TaskPriority, UserRole } from './types';

export type AppTabId = 'dashboard' | 'tasks' | 'blockers' | 'team' | 'reports' | 'audit' | 'settings';

/** Sekme → izinli roller eşlemesi — TEK doğruluk kaynağı. App.tsx'teki RBAC
 *  güvenlik duvarı ile Sidebar/MobileDock'un menü filtrelemesi hepsi buradan
 *  okur; üçü bağımsız kopyalanmış olsaydı biri güncellenip diğerleri
 *  unutulduğunda sessiz bir güvenlik/UX tutarsızlığı (görünen ama erişilemeyen
 *  ya da erişilebilen ama görünmeyen bir sekme) oluşabilirdi (bkz. kod denetimi). */
export const TAB_ROLES: Record<AppTabId, UserRole[]> = {
  dashboard: ['Admin', 'Manager', 'Staff'],
  tasks: ['Admin', 'Manager', 'Staff'],
  blockers: ['Admin', 'Manager'],
  team: ['Admin', 'Manager'],
  reports: ['Admin'],
  audit: ['Admin'],
  settings: ['Admin'],
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  ASSIGNED: 'Talimat Verildi',
  PENDING_DELEGATION: 'Yetki Devri Bekleniyor',
  IN_PROGRESS: 'İcra Aşamasında',
  BLOCKED: 'Engellenmiş',
  AWAITING_APPROVAL: 'Onay Sürecinde',
  COMPLETED: 'İcra Edildi',
  CANCELLED: 'Lağvedildi',
  CRISIS: 'Kriz — Gecikmiş',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  Low: 'Rutin',
  Medium: 'Normal',
  High: 'Öncelikli',
  Urgent: 'İvedi',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  Admin: 'Müftü',
  Manager: 'Müdür',
  Staff: 'Memur',
};

export const IDLE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  Low: 'bg-surface-border/[0.04] text-text-muted border-surface-border/50',
  Medium: 'bg-executive-blue/[0.04] text-executive-blue/80 border-executive-blue/[0.08]',
  High: 'bg-executive-gold/[0.05] text-executive-gold border-executive-gold/15',
  Urgent: 'bg-status-danger/[0.05] text-status-danger border-status-danger/10',
};

/** Badge bileşeninin `variant` prop'una eşleme — öncelik rozetlerinin tüm
 *  ekranlarda (BlockerList, TaskBoard, vb.) tutarlı görünmesi için tek kaynak. */
export const PRIORITY_BADGE_VARIANT: Record<TaskPriority, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  Low: 'default',
  Medium: 'info',
  High: 'warning',
  Urgent: 'danger',
};

/** Badge bileşeninin `variant` prop'una eşleme — durum rozetlerinin tüm
 *  ekranlarda (AuditLogList, Dashboard, TaskBoard, TaskDetails, TeamList)
 *  tutarlı görünmesi için tek kaynak. Eskiden her ekran bu eşlemeyi bağımsız
 *  olarak yeniden yazıyordu ve biri (TaskBoard) diğerlerinden sapmıştı
 *  (IN_PROGRESS → 'primary' vs 'info') — bkz. kod denetimi. */
export const STATUS_BADGE_VARIANT: Record<TaskStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  ASSIGNED: 'default',
  PENDING_DELEGATION: 'warning',
  IN_PROGRESS: 'info',
  BLOCKED: 'danger',
  AWAITING_APPROVAL: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'default',
  CRISIS: 'danger',
};
