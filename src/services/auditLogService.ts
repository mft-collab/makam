import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  db
} from '../firebase';
import type { QueryConstraint, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { AuditLog, AuditLogSchema } from '../types';
import { logger } from '../lib/logger';

/**
 * audit_logs koleksiyonu için TEK okuma katmanı. Önceden TaskDetails/TeamList/
 * AuditLogList/Settings her biri bağımsız bir getDocs sorgusu kurup ham veriyi
 * şemasız cast ediyordu — dördü senkronize kalması gereken dört ayrı
 * implementasyondu (bkz. kod denetimi). taskService/blockerService yalnızca
 * audit_logs'a YAZAR (transaction içinde); okuma tarafı burada toplanır.
 */
function toAuditLog(docSnap: QueryDocumentSnapshot<DocumentData>): AuditLog {
  const raw = { id: docSnap.id, ...docSnap.data() } as AuditLog;
  const parsed = AuditLogSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(`[auditLogService] Şema doğrulama uyarısı (audit_logs/${docSnap.id}):`, parsed.error);
    return raw;
  }
  return parsed.data;
}

export const auditLogService = {
  /** Tek bir göreve ait TÜM denetim kayıtları — sunucu tarafında taskId'ye göre
   *  filtrelenir (bkz. TaskDetails.tsx). */
  async queryTaskLogs(taskId: string): Promise<AuditLog[]> {
    const snapshot = await getDocs(query(collection(db, 'audit_logs'), where('taskId', '==', taskId)));
    const list = snapshot.docs.map(toAuditLog);
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list;
  },

  /** Tek bir personele ait denetim kayıtları — sunucu tarafında changedBy'a göre
   *  filtrelenir (uid VEYA email, çağırana göre farklı biçimde yazılabiliyor).
   *  Önceki hâli son 80 GLOBAL kaydı çekip istemcide filtreliyordu; az işlem
   *  yapan ya da uzun süredir pasif bir personelin geçmişi bu yüzden eksik/boş
   *  görünebiliyordu (bkz. TeamList.tsx, kod denetimi). */
  async queryUserLogs(uid: string, email?: string, max = 200): Promise<AuditLog[]> {
    const identifiers = Array.from(new Set([uid, email].filter(Boolean) as string[]));
    if (identifiers.length === 0) return [];
    const snapshot = await getDocs(query(
      collection(db, 'audit_logs'),
      where('changedBy', 'in', identifiers),
      orderBy('timestamp', 'desc'),
      limit(max)
    ));
    return snapshot.docs.map(toAuditLog);
  },

  /** AuditLogList ekranının aktör/tarih aralığı filtreli, imleçli sayfalama
   *  sorgusu. Filtreler sunucu tarafında uygulanır — yalnızca yüklenmiş sayfada
   *  arama yapmak, henüz getirilmemiş eski kayıtları yanlışlıkla "kayıt yok"
   *  gibi göstererek denetim aramalarını yanıltabilirdi. */
  async fetchFiltered(opts: {
    changedBy?: string;
    fromMs?: number;
    toMs?: number;
    pageSize: number;
    cursor?: QueryDocumentSnapshot<DocumentData> | null;
  }): Promise<{ logs: AuditLog[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean }> {
    const constraints: QueryConstraint[] = [];
    if (opts.changedBy) constraints.push(where('changedBy', '==', opts.changedBy));
    if (opts.fromMs !== undefined) constraints.push(where('timestamp', '>=', opts.fromMs));
    if (opts.toMs !== undefined) constraints.push(where('timestamp', '<=', opts.toMs));
    constraints.push(orderBy('timestamp', 'desc'));
    if (opts.cursor) constraints.push(startAfter(opts.cursor));
    constraints.push(limit(opts.pageSize));

    const snapshot = await getDocs(query(collection(db, 'audit_logs'), ...constraints));
    return {
      logs: snapshot.docs.map(toAuditLog),
      lastDoc: snapshot.docs[snapshot.docs.length - 1] ?? null,
      hasMore: snapshot.docs.length >= opts.pageSize
    };
  },

  /** Tam yedek/arşiv dışa aktarma için audit_logs koleksiyonunun TAMAMINI
   *  imleç (cursor) tabanlı, sabit boyutlu sayfalarla okur — bir yedeğin
   *  eksik veri içermesi kabul edilemez olduğundan limit() ile kısıtlanamaz,
   *  bunun yerine tek seferlik büyük bir istek yerine art arda küçük,
   *  güvenilir istekler yapılır (bkz. Settings.tsx). */
  async fetchAllPaged(pageSize = 500): Promise<Array<{ id: string } & Record<string, unknown>>> {
    const results: Array<{ id: string } & Record<string, unknown>> = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
    for (;;) {
      const constraints: QueryConstraint[] = cursor
        ? [orderBy('timestamp'), startAfter(cursor), limit(pageSize)]
        : [orderBy('timestamp'), limit(pageSize)];
      const snapshot = await getDocs(query(collection(db, 'audit_logs'), ...constraints));
      if (snapshot.empty) break;
      results.push(...snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      if (snapshot.docs.length < pageSize) break;
      cursor = snapshot.docs[snapshot.docs.length - 1] ?? null;
    }
    return results;
  }
};
