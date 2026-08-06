import { TaskStatus, TaskPriority, UserRole } from './types';

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

export const STATUS_COLORS: Record<TaskStatus, string> = {
  ASSIGNED: 'bg-executive-blue/[0.03] text-executive-blue border-executive-blue/[0.08]',
  PENDING_DELEGATION: 'bg-executive-gold/[0.05] text-executive-gold border-executive-gold/[0.15]',
  IN_PROGRESS: 'bg-executive-blue/[0.06] text-executive-blue border-executive-blue/[0.15]',
  BLOCKED: 'bg-status-danger/[0.03] text-status-danger border-status-danger/10',
  AWAITING_APPROVAL: 'bg-executive-gold/[0.08] text-executive-gold border-executive-gold/25',
  COMPLETED: 'bg-status-success/[0.03] text-status-success border-status-success/10',
  CANCELLED: 'bg-surface-border/[0.04] text-text-muted border-surface-border/50',
  CRISIS: 'bg-status-danger/[0.06] text-status-danger border-status-danger/15',
};

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
