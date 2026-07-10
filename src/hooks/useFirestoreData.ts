import { useState, useEffect } from 'react';
import { 
  collection, 
  doc,
  query, 
  where,
  or,
  orderBy, 
  limit,
  onSnapshot, 
  db 
} from '../firebase';
import { Task, User, TaskBlocker, AuditLog } from '../types';
import { useDataStore } from '../store/dataStore';

export function useFirestoreData(user: User | null, onError: (err: any, type: string, path: string) => void) {
  const { tasks, users, blockers, isHydrated, taskLimit, setTasks, setUsers, setBlockers, setStats } = useDataStore();
  
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

  useEffect(() => {
    if (!uid) return;

    const isAdmin = role === 'Admin';
    const isStaff = role === 'Staff';
    const assignees = Array.from(new Set([uid, email].filter(Boolean) as string[]));

    const tasksQuery = isAdmin
      ? query(
          collection(db, 'tasks'),
          orderBy('updatedAt', 'desc'),
          limit(taskLimit > 500 ? taskLimit : 500)
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
        const list = s.docs.map(d => ({ id: d.id, ...d.data() } as Task));
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setTasks(list);
        setIsLoading(false);
      },
      (e) => { onError(e, 'list', 'tasks'); setIsLoading(false); }
    );

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (s) => {
        const rawUsers = s.docs.map(d => ({ ...d.data(), uid: d.data().uid || d.id } as User));
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

    const blockersQuery = query(
      collection(db, 'blockers'),
      where('isResolved', '==', false),
      limit(100)
    );

    const unsubBlockers = onSnapshot(
      blockersQuery,
      (s) => {
        const all = s.docs.map(d => ({ id: d.id, ...d.data() } as TaskBlocker));
        setBlockers(all);
      },
      (e) => onError(e, 'list', 'blockers')
    );

    const unsubStats = onSnapshot(
      doc(db, 'system', 'stats'),
      (docSnap) => {
        if (docSnap.exists()) {
          setStats(docSnap.data() as any);
        }
      },
      (e) => console.error("Stats read error", e)
    );

    return () => {
      unsubTasks();
      unsubUsers();
      unsubBlockers();
      unsubStats();
    };
  }, [uid, role, email, departmentId, taskLimit, setTasks, setUsers, setBlockers, setStats, onError]);

  return { tasks, users, blockers, isLoading, auditLogs: [] as AuditLog[] };
}
