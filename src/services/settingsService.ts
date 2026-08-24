import { z } from 'zod';
import { db, doc, setDoc, addDoc, collection, getDoc, writeBatch, increment } from '../firebase';
import { UserRoleSchema, TaskStatusSchema, TaskPrioritySchema } from '../types';
import type { SLAConfigEntry } from '../lib/sla';

// ── Yedek Doğrulama Şemaları (Restore) ──────────────────────────────────────
// role/status/priority değerleri types.ts'teki KANONİK enum'lardan alınır —
// burada elle kopyalanmış bağımsız bir liste tutulursa, types.ts'e yeni bir
// durum eklendiğinde bu şema güncellenmediği sürece tamamen geçerli, güncel
// bir MAKAM yedeği bile reddedilir (bkz. settingsService.restoreBackup).
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

// ── Saf veri dönüştürme yardımcıları (restore akışı) ─────────────────────────
const cleanDataObj = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => cleanDataObj(item));
  const n: any = {};
  Object.keys(obj).forEach(k => { if (obj[k] !== undefined) n[k] = cleanDataObj(obj[k]); });
  return n;
};

const toTs = (val: any, fb?: number): number => {
  if (val == null) return fb ?? Date.now();
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime() || (fb ?? Date.now());
  if (typeof val === 'object' && 'seconds' in val) return val.seconds * 1000;
  return fb ?? Date.now();
};

const pick = (obj: any, keys: string[]) => {
  const r: any = {};
  keys.forEach(k => { if (k in obj && obj[k] !== undefined) r[k] = obj[k]; });
  return r;
};

export interface SlaConfigInput {
  Low: SLAConfigEntry;
  Medium: SLAConfigEntry;
  High: SLAConfigEntry;
  Urgent: SLAConfigEntry;
}

export interface RestoreResult {
  userCount: number;
  taskCount: number;
  blockerCount: number;
}

export const settingsService = {
  /** SLA yapılandırmasını kaydeder, localStorage'ı senkronize eder ve
   *  audit_logs kaydı oluşturur — Settings.tsx bileşeni yalnızca form
   *  state'ini toplayıp bu fonksiyonu çağırır. */
  async saveSlaConfig(config: SlaConfigInput, userId: string, summaryLabel: string) {
    const newConfig = { ...config, updatedAt: Date.now(), updatedBy: userId };
    await setDoc(doc(db, 'system', 'sla_config'), newConfig);

    localStorage.setItem('makam_sla_config', JSON.stringify({
      Low: config.Low, Medium: config.Medium, High: config.High, Urgent: config.Urgent
    }));

    await addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_settings',
      changedBy: userId,
      oldValue: 'SLA Yapılandırması Değiştirildi',
      newValue: summaryLabel,
      timestamp: Date.now()
    });
  },

  /** Bir yedek JSON metnini doğrular ve dizgeye geri yükler; ilerleme
   *  yüzdesini (0-100) onProgress ile bildirir. Doğrulama hatası veya
   *  format hatası durumunda Error fırlatır. */
  async restoreBackup(rawJson: string, userId: string, fileName: string, onProgress?: (percent: number) => void): Promise<RestoreResult> {
    const data = JSON.parse(rawJson);

    const backupValidation = restoreBackupSchema.safeParse(data);
    if (!backupValidation.success) {
      throw new Error('Yedek dosyası formatı geçersiz (MAKAM verisi değil).');
    }

    if (Array.isArray(data.users)) {
      data.users.forEach((u: any) => {
        const parsed = userBackupSchema.safeParse(u);
        if (!parsed.success) {
          throw new Error(`Personel verisi doğrulanamadı (${u.fullName || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
        }
      });
    }

    if (Array.isArray(data.tasks)) {
      data.tasks.forEach((t: any) => {
        const parsed = taskBackupSchema.safeParse(t);
        if (!parsed.success) {
          throw new Error(`Talimat verisi doğrulanamadı (${t.title || 'Bilinmeyen'}). Hata: ${parsed.error.issues[0]?.message || parsed.error.message}`);
        }
      });
    }

    const userItems: { ref: any; data: any }[] = [];
    if (Array.isArray(data.users)) {
      data.users.forEach((u: any) => {
        if (u.uid) userItems.push({ ref: doc(db, 'users', u.uid), data: pick(cleanDataObj(u), ['uid', 'fullName', 'email', 'role', 'departmentId', 'photoURL', 'fcmTokens']) });
      });
    }
    const taskItems: { id: string; ref: any; data: any }[] = [];
    if (Array.isArray(data.tasks)) {
      data.tasks.forEach((t: any) => {
        if (t.id) {
          const s = cleanDataObj(t);
          s.deadline  = toTs(s.deadline);
          s.createdAt = toTs(s.createdAt);
          s.updatedAt = toTs(s.updatedAt);
          taskItems.push({ id: t.id, ref: doc(db, 'tasks', t.id), data: s });
        }
      });
    }
    const blockerItems: { ref: any; data: any }[] = [];
    if (Array.isArray(data.blockers)) {
      data.blockers.forEach((b: any) => {
        if (b.id) {
          const { id, ...rest } = cleanDataObj(b);
          rest.createdAt = toTs(rest.createdAt);
          if (rest.resolvedAt) rest.resolvedAt = toTs(rest.resolvedAt);
          blockerItems.push({ ref: doc(db, 'blockers', id), data: rest });
        }
      });
    }

    // system/stats agregat sayaçları (Dashboard'un canlı okuduğu totalTasks/
    // status_*) taskService'in create/transitionTask/updateTask/deleteTask
    // fonksiyonlarında increment() ile güncellenir. Restore burada bunların
    // hiçbirini çağırmadan doğrudan writeBatch yazdığından, restore edilen
    // her görev için ESKİ durumu (varsa) okuyup gerçek delta'yı kendimiz
    // hesaplıyor ve AYNI batch'e ekliyoruz — aksi halde sayaçlar restore
    // sonrası kalıcı olarak gerçek veriden sapar ve hiçbir normal işlemle
    // kendiliğinden düzelmez (her normal işlem yalnızca kendi deltasını uygular).
    const statsDelta: Record<string, number> = {};
    for (const item of taskItems) {
      const prevSnap = await getDoc(item.ref);
      const newStatus = item.data.status as string | undefined;
      if (!prevSnap.exists()) {
        statsDelta.totalTasks = (statsDelta.totalTasks ?? 0) + 1;
        if (newStatus) statsDelta[`status_${newStatus}`] = (statsDelta[`status_${newStatus}`] ?? 0) + 1;
      } else {
        const prevStatus = (prevSnap.data() as { status?: string }).status;
        if (newStatus && prevStatus !== newStatus) {
          if (prevStatus) statsDelta[`status_${prevStatus}`] = (statsDelta[`status_${prevStatus}`] ?? 0) - 1;
          statsDelta[`status_${newStatus}`] = (statsDelta[`status_${newStatus}`] ?? 0) + 1;
        }
      }
    }

    const items = [...userItems, ...taskItems, ...blockerItems];
    const CHUNK = 50;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      chunk.forEach(it => batch.set(it.ref, it.data, { merge: true }));
      // Sayaç deltası tek seferlik, tüm chunk'lardan bağımsız bir işlem
      // olarak yalnızca SON chunk'a eklenir — increment() atomik ve
      // birikimli olduğundan hangi chunk'ta gönderildiği sonucu etkilemez.
      if (i + CHUNK >= items.length && Object.keys(statsDelta).length > 0) {
        const statsPayload: Record<string, ReturnType<typeof increment>> = {};
        Object.entries(statsDelta).forEach(([key, value]) => {
          if (value !== 0) statsPayload[key] = increment(value);
        });
        if (Object.keys(statsPayload).length > 0) {
          batch.set(doc(db, 'system', 'stats'), statsPayload, { merge: true });
        }
      }
      await batch.commit();
      onProgress?.(Math.round(((i + chunk.length) / items.length) * 100));
    }

    // Register restore audit log — hangi dosyadan, kaç kayıt geri yüklendiği kaydedilir
    await addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_backup_restore',
      changedBy: userId,
      oldValue: `Yedek dosyası: ${fileName}`,
      newValue: `${data.users?.length ?? 0} kullanıcı, ${data.tasks?.length ?? 0} talimat, ${data.blockers?.length ?? 0} engel geri yüklendi`,
      timestamp: Date.now()
    });

    return { userCount: data.users?.length ?? 0, taskCount: data.tasks?.length ?? 0, blockerCount: data.blockers?.length ?? 0 };
  },

  /** Denetim izi dışa aktarımının kendisini audit_logs'a kaydeder — kayıtların
   *  hiçbiri silinmez, yalnızca "yerel dosyaya aktarıldı" izi düşülür. */
  async archiveAuditLogs(logCount: number, userId: string) {
    await addDoc(collection(db, 'audit_logs'), {
      taskId: 'system_log_export',
      changedBy: userId,
      oldValue: logCount + ' kayıt (veritabanında)',
      newValue: 'Yerel dosyaya aktarıldı',
      timestamp: Date.now()
    });
  }
};
