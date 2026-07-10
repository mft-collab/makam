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
  PENDING_DELEGATION: 'bg-[#C5A059]/[0.05] text-[#C5A059] border-[#C5A059]/[0.15]',
  IN_PROGRESS: 'bg-executive-blue/[0.06] text-executive-blue border-executive-blue/[0.15]',
  BLOCKED: 'bg-red-500/[0.03] text-red-500 border-red-500/10',
  AWAITING_APPROVAL: 'bg-[#C5A059]/[0.08] text-[#C5A059] border-[#C5A059]/0.25',
  COMPLETED: 'bg-emerald-500/[0.03] text-emerald-600 border-emerald-500/10',
  CANCELLED: 'bg-gray-400/[0.04] text-text-muted border-surface-border/50',
  CRISIS: 'bg-red-500/[0.06] text-red-600 border-red-500/15',
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  Low: 'bg-gray-400/[0.04] text-slate-400 border-surface-border/50',
  Medium: 'bg-executive-blue/[0.04] text-executive-blue/80 border-executive-blue/[0.08]',
  High: 'bg-[#C5A059]/[0.05] text-[#C5A059] border-[#C5A059]/0.15',
  Urgent: 'bg-red-500/[0.05] text-red-600 border-red-500/10',
};
