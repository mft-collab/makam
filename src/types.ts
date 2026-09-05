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

/**
 * departments/{departmentId} — departman/birim REFERANS varlığı.
 *
 * Doküman ID'si departmanın KENDİ string değeridir ("Operasyon") ve `name` ile
 * birebir aynıdır (firestore.rules `isValidDepartment` bunu zorunlu kılar).
 * Bu, mevcut `users.departmentId` / `tasks.departmentId` alanlarındaki string
 * değerlerin hiçbirinin yeniden yazılmasını gerektirmeyen taşıma kararıdır:
 * o değerlere karşılık gelen bir dokümanın yalnızca VAR OLMASI yeterlidir.
 * `id` alanı Firestore'da tutulmaz, okuma sırasında doküman ID'sinden doldurulur.
 */
export const DepartmentSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  createdAt: z.number(),
  createdBy: z.string(),
});
export type Department = z.infer<typeof DepartmentSchema>;

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
  // Bağlı görevin önceliğinden bağımsız olarak engelin kendi ciddiyeti —
  // eski kayıtlarda yok, okuyan taraflar 'Medium' varsayımıyla ele almalı.
  severity: TaskPrioritySchema.optional(),
  isResolved: z.boolean(),
  createdAt: z.number(),
  resolvedAt: z.number().optional(),
});
export type TaskBlocker = z.infer<typeof TaskBlockerSchema>;

// system/stats dokümanı için zod şeması — useFirestoreData.ts'teki tasks/users
// okumalarıyla AYNI validateOrPassthrough disiplinine tabi tutmak için (bkz.
// kod denetimi: eskiden bu doküman `as any` ile ham cast ediliyordu). Tüm
// alanlar .default(0) ile eksik/bozuk bir sayaç alanının uygulamayı hiç
// çökertmemesini, yalnızca 0'a düşmesini sağlar.
// status_PENDING_DELEGATION burada EKSİKTİ (bkz. kod denetimi): taskService.ts
// (ve scheduledAudit.ts) `status_${task.status}` ile TAMAMEN dinamik/jenerik
// increment yaptığından Firestore'daki dokümanda bu alan zaten doğru
// tutuluyordu, ama z.object() varsayılan olarak şemada tanımlı OLMAYAN
// alanları sessizce STRİPLEDİĞİNDEN, bu sayaç validateOrPassthrough'tan hiç
// geçemiyordu. Sonuç: computeStats'ın globalStats dalı (Admin/Müdür'ün
// varsayılan, filtresiz pano görünümü) "Bekleyen" kartında yalnızca ASSIGNED'ı
// sayıyor, PENDING_DELEGATION'daki (izin/mazeret devri bekleyen) görevleri
// görünmez kılıyordu — aynı kartın yerel (Staff/filtreli) hesap yolu ikisini
// de sayıyordu, iki yol arasında sessiz bir tutarsızlık vardı.
export const GlobalStatsSchema = z.object({
  totalTasks: z.number().default(0),
  status_ASSIGNED: z.number().default(0),
  status_PENDING_DELEGATION: z.number().default(0),
  status_IN_PROGRESS: z.number().default(0),
  status_AWAITING_APPROVAL: z.number().default(0),
  status_COMPLETED: z.number().default(0),
  status_BLOCKED: z.number().default(0),
  status_CANCELLED: z.number().default(0),
  status_CRISIS: z.number().default(0),
});

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
