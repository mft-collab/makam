import { z } from 'zod';

// ── Yedek Doğrulama Şemaları (Restore) ──────────────────────────────────────
export const userBackupSchema = z.object({
  uid: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  role: z.enum(['Admin', 'Manager', 'Staff'])
});

export const taskBackupSchema = z.object({
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

export const restoreBackupSchema = z.object({
  // Eski yedekler 'MAKAM Executive Control' değerini taşıyor — geriye
  // dönük uyumluluk için ikisi de kabul edilir (bkz. AboutModal/index.html
  // markasının Türkçeleştirilmesi).
  system: z.enum(['MAKAM Stratejik Yönetim', 'MAKAM Executive Control']),
  users: z.array(z.any()).optional(),
  tasks: z.array(z.any()).optional(),
  blockers: z.array(z.any()).optional(),
});
