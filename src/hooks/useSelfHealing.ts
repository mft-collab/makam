/**
 * useSelfHealing — Tutarsız BLOCKED Görev Onarıcı
 *
 * Aktif blockerı olmayan BLOCKED durumdaki görevleri otomatik olarak
 * IN_PROGRESS durumuna döndürür. Her görev/blocker değişikliğinde
 * 5 saniye gecikmeyle çalışır (aşırı istek önlemi).
 *
 * Sadece Admin ve Manager rolündeki kullanıcılar için aktiftir.
 */
import { useEffect, useRef } from 'react';
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

  // tasks/blockers'ın GÜNCEL içeriğine setTimeout callback'i içinde erişmek
  // için ref'te tutulur (her render'da güncellenir) — effect'in dependency
  // array'i ise aşağıdaki DAR imzalara bağlıdır, dizilerin referansına değil.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const blockersRef = useRef(blockers);
  blockersRef.current = blockers;

  // Zamanlayıcının yeniden başlatılıp başlatılmayacağına yalnızca ONARIMLA
  // İLGİLİ alanlar (BLOCKED görevlerin id+lockVersion'ı, blocker'ların
  // taskId+isResolved'ı) karar verir — tasks/blockers dizilerinin referansı
  // DEĞİL. Önceden effect doğrudan `tasks`/`blockers` dizilerine bağımlıydı;
  // App.tsx'teki useMemo'lar bu dizileri her onSnapshot güncellemesinde
  // (alakasız bir alan değişse bile) YENİ bir referansla ürettiğinden, yoğun
  // trafikte 5sn'lik zamanlayıcı sürekli sıfırlanıp hiç ateşlenmeyebiliyordu
  // (bkz. kod denetimi — uid/role için zaten uygulanan aynı "primitive'e
  // indirgeme" prensibi burada da uygulandı).
  const blockedSignature = tasks
    .filter(t => t.status === 'BLOCKED')
    .map(t => `${t.id}:${t.lockVersion ?? 0}`)
    .join(',');
  const blockerSignature = blockers
    .map(b => `${b.taskId}:${b.isResolved}`)
    .join(',');

  useEffect(() => {
    if (!uid || tasksRef.current.length === 0) return;
    if (role !== 'Admin' && role !== 'Manager') return;

    const timer = setTimeout(async () => {
      const blockedTasks = tasksRef.current.filter(t => t.status === 'BLOCKED');

      for (const task of blockedTasks) {
        const hasActiveBlocker = blockersRef.current.some(b => b.taskId === task.id && !b.isResolved);
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
  }, [uid, role, blockedSignature, blockerSignature]);
}
