import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  or,
  orderBy,
  limit,
  onSnapshot,
  db
} from '../firebase';
import { Task, User, TaskBlocker, AuditLog, TaskSchema, UserSchema, TaskBlockerSchema, GlobalStatsSchema } from '../types';
import { useDataStore, type GlobalStats } from '../store/dataStore';
import { logger } from '../lib/logger';

/**
 * Firestore'dan gelen ham veriyi zod şemasıyla doğrular. Şema uyumsuzluğu
 * (ör. bozuk/eksik alan) veriyi listeden düşürmez — yalnızca konsola uyarı
 * yazar — aksi halde tek bir hatalı doküman tüm listeyi görünmez yapardı.
 * Doğrulama başarılıysa şemanın .default(...) doldurduğu alanlarla döner.
 */
export function validateOrPassthrough<T>(schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: unknown } }, raw: T, docId: string, collectionName: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    logger.warn(`[useFirestoreData] Şema doğrulama uyarısı (${collectionName}/${docId}):`, result.error);
    return raw;
  }
  return result.data as T;
}

/**
 * Yerel `tasks` listesinde (taskLimit sınırı, rol bazlı sorgu vb. yüzünden)
 * bulunmayan tek bir görevi tek seferlik okur — App.tsx'teki "CQRS on-demand
 * fetch" bu fonksiyonu kullanır. Aşağıdaki onSnapshot tabanlı listener'la
 * AYNI zod doğrulamasından geçer; aksi halde bu tek yol şemasız ham veriyi
 * doğrudan UI'a (getPrimaryAction gibi iş mantığına) sızdırabilirdi.
 */
export async function fetchTaskById(taskId: string): Promise<Task | null> {
  const snap = await getDoc(doc(db, 'tasks', taskId));
  if (!snap.exists()) return null;
  const raw = { id: snap.id, ...snap.data() } as Task;
  return validateOrPassthrough(TaskSchema, raw, snap.id, 'tasks');
}

export function useFirestoreData(user: User | null, onError: (err: unknown, type: string, path: string) => void) {
  const { tasks, users, blockers, resolvedBlockers, isHydrated, taskLimit, setTasks, setUsers, setBlockers, setResolvedBlockers, setStats, reset } = useDataStore();
  
  // Skeleton is shown if IDB is not yet hydrated and no data exists.
  // Once hydrated, it will use cached data immediately.
  const [isLoading, setIsLoading] = useState(!isHydrated && tasks.length === 0);

  useEffect(() => {
    if (isHydrated) {
      setIsLoading(false);
    }
  }, [isHydrated]);

  const uid = user?.uid;
  const role = user?.role;
  const email = user?.email;
  const departmentId = user?.departmentId;

  // Tasks listener'ı ayrı bir effect'te tutulur çünkü tek başına `taskLimit`e
  // bağlıdır ("Daha Fazla Yükle") — users/blockers/stats bu değere bağlı
  // değil. Tek effect'te birleştirilmiş olsalardı, her "Daha Fazla Yükle"
  // tıklaması bu üç listener'ı da gereksiz yere abonelikten çıkarıp yeniden
  // kurar, ekstra Firestore okuması ve kısa isLoading flicker'ına yol açardı.
  useEffect(() => {
    if (!uid) {
      // Çıkış yapıldığında (uid tanımlıydı → undefined oldu) veya hiç giriş
      // yapılmamışken (uid zaten undefined, reset no-op) çalışır. Önceki
      // kullanıcının görev/kullanıcı/engel verisi hem bellekte hem
      // idb-keyval diskinde kalıp aynı cihazdaki bir sonraki kullanıcıya
      // görünür kalmasın diye (bkz. kod denetimi) — reset yalnızca uid
      // değiştiğinde (dependency array) tetiklenir, her render'da değil.
      reset();
      return;
    }

    const isAdmin = role === 'Admin';
    const isStaff = role === 'Staff';
    const assignees = Array.from(new Set([uid, email].filter(Boolean) as string[]));

    const tasksQuery = isAdmin
      ? query(
          collection(db, 'tasks'),
          orderBy('updatedAt', 'desc'),
          limit(taskLimit)
        )
      : isStaff
        ? query(
            collection(db, 'tasks'),
            where('assigneeId', 'in', assignees.length > 0 ? assignees : ['__none__']),
            limit(taskLimit)
          )
        : departmentId
          ? query(
              collection(db, 'tasks'),
              or(
                where('departmentId', '==', departmentId),
                where('assigneeId', 'in', assignees.length > 0 ? assignees : ['__none__'])
              ),
              limit(taskLimit)
            )
          : query(
              collection(db, 'tasks'),
              where('assigneeId', 'in', assignees.length > 0 ? assignees : ['__none__']),
              limit(taskLimit)
            );

    const unsubTasks = onSnapshot(
      tasksQuery,
      (s) => {
        const list = s.docs.map(d => {
          const raw = { id: d.id, ...d.data() } as Task;
          return validateOrPassthrough(TaskSchema, raw, d.id, 'tasks');
        });
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setTasks(list);
        setIsLoading(false);
      },
      (e) => { onError(e, 'list', 'tasks'); setIsLoading(false); }
    );

    return () => {
      unsubTasks();
    };
  }, [uid, role, email, departmentId, taskLimit, setTasks, onError, reset]);

  useEffect(() => {
    if (!uid) return;

    // users koleksiyonu, tasks (taskLimit) ve blockers (limit(100)) ile
    // tutarsız biçimde hiç sınırlanmıyordu (bkz. kod denetimi) — sınırsız bir
    // sorgu, org büyüdükçe okuma/maliyet profilini öngörülemez hale getirir.
    // 1000 kasıtlı olarak yüksek tutuldu: TeamList'te sayfalama YOK (tüm kadro
    // tek seferde gösteriliyor), bu yüzden gerçekçi bir dağıtımı kesmeyecek
    // kadar geniş bir üst sınır — amaç kotayı korumak, kadroyu budamak değil.
    const usersQuery = query(collection(db, 'users'), limit(1000));

    const unsubUsers = onSnapshot(
      usersQuery,
      (s) => {
        const rawUsers = s.docs.map(d => {
          const raw = { ...d.data(), uid: d.data().uid || d.id } as User;
          return validateOrPassthrough(UserSchema, raw, d.id, 'users');
        });
        const dedupedMap = new Map<string, User>();
        rawUsers.forEach(u => {
          const emailKey = u.email.toLowerCase().trim();
          const existing = dedupedMap.get(emailKey);
          if (!existing) {
            dedupedMap.set(emailKey, u);
          } else {
            const existingIsTemp = existing.uid.includes('@');
            const currentIsTemp = u.uid.includes('@');
            if (existingIsTemp && !currentIsTemp) {
              dedupedMap.set(emailKey, u);
            }
          }
        });
        setUsers(Array.from(dedupedMap.values()));
      },
      (e) => onError(e, 'list', 'users')
    );

    // orderBy eklendi: orderBy olmadan limit(100) uygulanan bir sorguda hangi
    // 100 dokümanın döneceği Firestore tarafından garanti edilmez — 100'den
    // fazla çözülmemiş engel varsa bazıları rastgele/tutarsız biçimde dışarıda
    // kalabilirdi (bkz. kod denetimi, özellikle useSelfHealing bu listeye
    // "aktif engeli yok" kararı için bakıyor). En yeni engeller önceliklidir.
    const blockersQuery = query(
      collection(db, 'blockers'),
      where('isResolved', '==', false),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    const unsubBlockers = onSnapshot(
      blockersQuery,
      (s) => {
        // tasks/users listener'larıyla AYNI zod doğrulama disiplini — eskiden
        // burada doğrulamasız ham cast yapılıyordu (bkz. kod denetimi).
        const all = s.docs.map(d => {
          const raw = { id: d.id, ...d.data() } as TaskBlocker;
          return validateOrPassthrough(TaskBlockerSchema, raw, d.id, 'blockers');
        });
        setBlockers(all);
      },
      (e) => onError(e, 'list', 'blockers')
    );

    // Yukarıdaki blockersQuery YALNIZCA aktif engelleri döndürür (bkz. yukarıdaki
    // yorum) — BlockerList'in "Çözüme Ulaşanlar" paneli bu yüzden hiçbir zaman
    // veri göremiyordu (bkz. kod denetimi). Ayrı, bağımsız bir sorgu: en son
    // ÇÖZÜLEN 50 engel, resolvedAt'e göre en yeniden eskiye. blockerService.ts
    // ve useAppHandlers.ts bir engeli çözerken isResolved/resolvedAt'i HER ZAMAN
    // birlikte yazdığından (bkz. ilgili servisler), bu alana göre sıralamak
    // güvenli. Aktif engel tüketicileri (useSelfHealing, Reports'un "Aktif
    // Darboğaz" KPI'sı) yukarıdaki blockersQuery/blockers alanını kullanmaya
    // devam eder — bu yeni alan yalnızca EKLENİYOR, mevcut davranışı değiştirmiyor.
    const resolvedBlockersQuery = query(
      collection(db, 'blockers'),
      where('isResolved', '==', true),
      orderBy('resolvedAt', 'desc'),
      limit(50)
    );

    const unsubResolvedBlockers = onSnapshot(
      resolvedBlockersQuery,
      (s) => {
        const all = s.docs.map(d => {
          const raw = { id: d.id, ...d.data() } as TaskBlocker;
          return validateOrPassthrough(TaskBlockerSchema, raw, d.id, 'blockers');
        });
        setResolvedBlockers(all);
      },
      (e) => onError(e, 'list', 'blockers')
    );

    const unsubStats = onSnapshot(
      doc(db, 'system', 'stats'),
      (docSnap) => {
        if (docSnap.exists()) {
          const raw = docSnap.data();
          setStats(validateOrPassthrough<GlobalStats>(GlobalStatsSchema, raw as GlobalStats, docSnap.id, 'system/stats'));
        }
      },
      (e) => onError(e, 'list', 'system/stats')
    );

    return () => {
      unsubUsers();
      unsubBlockers();
      unsubResolvedBlockers();
      unsubStats();
    };
  }, [uid, setUsers, setBlockers, setResolvedBlockers, setStats, onError]);

  return { tasks, users, blockers, resolvedBlockers, isLoading, auditLogs: [] as AuditLog[] };
}
