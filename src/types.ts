import { z } from 'zod';

export const UserRoleSchema = z.enum(['Admin', 'Manager', 'Staff']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  uid: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  role: UserRoleSchema,
  departmentId: z.string().optional(),
  photoURL: z.string().url().optional(),
  fcmTokens: z.array(z.string()).optional(),
});
export type User = z.infer<typeof UserSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  message: z.string(),
  type: z.enum(['Crisis', 'Info', 'Warning', 'TaskAssigned']),
  taskId: z.string().optional(),
  timestamp: z.number(),
  isRead: z.boolean(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const TaskStatusSchema = z.enum([
  'ASSIGNED',
  'PENDING_DELEGATION',
  'IN_PROGRESS',
  'BLOCKED',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'CANCELLED',
  'CRISIS'
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(['Low', 'Medium', 'High', 'Urgent']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  title: z.string().min(1),
  description: z.string(),
  creatorId: z.string(),
  assigneeId: z.string(),
  coordinatorId: z.string().optional(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  deadline: z.number(), // Business day calculated deadline
  createdAt: z.number(),
  updatedAt: z.number(),
  pausedAt: z.number().nullable().optional(), // Timestamp when timer paused (BLOCKED or AWAITING_APPROVAL)
  totalPausedTime: z.number().default(0), // Accumulated pause time in ms
  evidence: z.string().optional(),
  evidenceType: z.enum(['PDF', 'Image', 'Link']).optional(),
  comments: z.array(z.object({
    userId: z.string(),
    text: z.string(),
    timestamp: z.number(),
  })).default([]),
  lockVersion: z.number().default(0), // For optimistic locking
  departmentId: z.string().optional(),
  // ─ Yeni alanlar (v1.2.1) ────────────────────────────────────────
  /** Görevin tamamlandığı an (ms epoch). COMPLETED statüsünde set edilir. */
  completedAt: z.number().optional(),
  /** Tahmini efor (saat). Raporlama ve KPI hesaplamaları için. */
  estimatedHours: z.number().min(0).optional(),
  /** Etiketler — özel filtreleme için. Maksimum 10 etiket. */
  tags: z.array(z.string().max(30)).max(10).default([]),
  checklist: z.array(z.object({
    id: z.string(),
    text: z.string(),
    isCompleted: z.boolean(),
  })).default([]),
  /** Son durum geçişini yapan kullanıcının uid'si — transitionTaskInTransaction
   *  tarafından her geçişte set edilir. Cloud Functions'taki onTaskStatusChanged
   *  trigger'ının "değiştiren kişiye bildirim gönderme" filtresi bu alana bakar. */
  changedBy: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskBlockerSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  reason: z.string().min(1),
  isResolved: z.boolean(),
  createdAt: z.number(),
  resolvedAt: z.number().optional(),
});
export type TaskBlocker = z.infer<typeof TaskBlockerSchema>;

export const AuditLogSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  changedBy: z.string(),
  changes: z.record(z.string(), z.object({
    old: z.unknown(),
    new: z.unknown(),
  })).optional(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  timestamp: z.number(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
