import { z } from 'zod';
import { UserRoleSchema, TaskStatusSchema, TaskPrioritySchema } from '../../types';

// ── Yedek Doğrulama Şemaları (Restore) ──────────────────────────────────────
// role/status/priority değerleri types.ts'teki KANONİK enum'lardan alınır —
// burada elle kopyalanmış bağımsız bir liste tutulursa, types.ts'e yeni bir
// durum eklendiğinde bu şema güncellenmediği sürece tamamen geçerli, güncel
// bir MAKAM yedeği bile reddedilir (bkz. Settings.tsx handleImport).
export const userBackupSchema = z.object({
  uid: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  role: UserRoleSchema
});

export const taskBackupSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  creatorId: z.string(),
  assigneeId: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
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
