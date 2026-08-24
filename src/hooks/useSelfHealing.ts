/**
 * useSelfHealing — Tutarsız BLOCKED Görev Onarıcı
 *
 * Aktif blockerı olmayan BLOCKED durumdaki görevleri otomatik olarak
 * IN_PROGRESS durumuna döndürür. Her görev/blocker değişikliğinde
 * 5 saniye gecikmeyle çalışır (aşırı istek önlemi).
 *
 * Sadece Admin ve Manager rolündeki kullanıcılar için aktiftir.
 */
import { useEffect } from 'react';
import { taskService } from '../services/taskService';
import { logger } from '../lib/logger';
import type { Task, TaskBlocker, User } from '../types';

interface UseSelfHealingOptions {
  user: User | null;
  tasks: Task[];
  blockers: TaskBlocker[];
}

export function useSelfHealing({ user, tasks, blockers }: UseSelfHealingOptions) {
  // Yalnızca uid/role'e (primitive) bağımlı — user nesnesi, kullanıcının
  // Firestore dokümanındaki onarımla alakasız her değişiklikte (fotoğraf,
  // fcmTokens vb.) yeni bir referansla set ediliyor (bkz. App.tsx); tüm
  // `user` nesnesini dependency array'e koymak bu tür güncellemelerde
  // gereksiz yere 5sn'lik onarım zamanlayıcısını sıfırlardı — useFirestoreData.ts'teki
  // aynı desen (bkz. kod denetimi).
  const uid = user?.uid;
  const role = user?.role;

  useEffect(() => {
    if (!uid || tasks.length === 0) return;
    if (role !== 'Admin' && role !== 'Manager') return;

    const timer = setTimeout(async () => {
      const blockedTasks = tasks.filter(t => t.status === 'BLOCKED');

      for (const task of blockedTasks) {
        const hasActiveBlocker = blockers.some(b => b.taskId === task.id && !b.isResolved);
        if (!hasActiveBlocker) {
          logger.debug(
            `[SelfHealing] "${task.title}" — aktif blocker yok, IN_PROGRESS'e döndürülüyor...`
          );
          try {
            await taskService.updateTaskStatus(task.id, 'IN_PROGRESS', 'BLOCKED', uid, undefined, undefined, task.lockVersion);
          } catch (e) {
            // VERSION_MISMATCH burada beklenen bir durumdur (görev bu 5sn içinde
            // başka bir yerden değişti) — sessizce atlanır, bir sonraki tetiklemede
            // güncel veriyle yeniden denenir. Diğer hatalar loglanır.
            logger.warn('[SelfHealing] Onarım başarısız:', e);
          }
        }
      }
    }, 5_000);

    return () => clearTimeout(timer);
  }, [uid, role, tasks, blockers]);
}
