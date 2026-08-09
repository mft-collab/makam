import { describe, it, expect } from 'vitest';
import { getPrimaryAction, getTimeLeft, getSLAColor, computeChecklistStats } from './helpers';
import type { Task, User } from '../../types';

const baseTask: Task = {
  id: 'task-1', title: 'Test Talimatı', description: '', creatorId: 'creator-1', assigneeId: 'assignee-1',
  status: 'ASSIGNED', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: Date.now(), updatedAt: Date.now(),
  totalPausedTime: 0, lockVersion: 0, tags: [],
} as Task;

const admin: User = { uid: 'admin-1', fullName: 'Yönetici', email: 'admin@makam.com', role: 'Admin' };
const staff: User = { uid: 'staff-1', fullName: 'Memur', email: 'staff@makam.com', role: 'Staff' };
const manager: User = { uid: 'mgr-1', fullName: 'Müdür', email: 'mgr@makam.com', role: 'Manager' };

describe('getPrimaryAction', () => {
  it('ASSIGNED durumunda role bakılmaksızın SÜRECİ BAŞLAT döner', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'ASSIGNED' }, staff);
    expect(action).toMatchObject({ label: 'SÜRECİ BAŞLAT', next: 'IN_PROGRESS', collectsEvidence: false, needsConfirm: false });
  });

  it('PENDING_DELEGATION durumunda role bakılmaksızın DEVRİ KABUL ET VE BAŞLAT döner', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'PENDING_DELEGATION' }, manager);
    expect(action).toMatchObject({ label: 'DEVRİ KABUL ET VE BAŞLAT', next: 'IN_PROGRESS' });
  });

  it('IN_PROGRESS + Admin-olmayan → TAMAMLA VE ONAYA SUN (AWAITING_APPROVAL, onay gerektirmez)', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'IN_PROGRESS' }, staff);
    expect(action).toMatchObject({ label: 'TAMAMLA VE ONAYA SUN', next: 'AWAITING_APPROVAL', collectsEvidence: true, needsConfirm: false });
  });

  it('IN_PROGRESS + Manager (Admin değil) → TAMAMLA VE ONAYA SUN', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'IN_PROGRESS' }, manager);
    expect(action?.label).toBe('TAMAMLA VE ONAYA SUN');
  });

  it('IN_PROGRESS + Admin → KESİN TAMAMLA (COMPLETED, onay atlanır)', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'IN_PROGRESS' }, admin);
    expect(action).toMatchObject({ label: 'KESİN TAMAMLA', next: 'COMPLETED', collectsEvidence: true, needsConfirm: true });
  });

  it('CRISIS durumu IN_PROGRESS ile aynı aksiyon setini kullanır (Admin-olmayan)', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'CRISIS' }, staff);
    expect(action?.label).toBe('TAMAMLA VE ONAYA SUN');
  });

  it('CRISIS durumu IN_PROGRESS ile aynı aksiyon setini kullanır (Admin)', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'CRISIS' }, admin);
    expect(action?.label).toBe('KESİN TAMAMLA');
  });

  it('AWAITING_APPROVAL + Admin → TALİMATI ONAYLA VE KAPAT', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'AWAITING_APPROVAL' }, admin);
    expect(action).toMatchObject({ label: 'TALİMATI ONAYLA VE KAPAT', next: 'COMPLETED', needsConfirm: true });
  });

  it('AWAITING_APPROVAL + Admin-olmayan → null (onay bekleyen görev için aksiyon yok)', () => {
    expect(getPrimaryAction({ ...baseTask, status: 'AWAITING_APPROVAL' }, staff)).toBeNull();
    expect(getPrimaryAction({ ...baseTask, status: 'AWAITING_APPROVAL' }, manager)).toBeNull();
  });

  it('COMPLETED durumunda null döner (terminal durum)', () => {
    expect(getPrimaryAction({ ...baseTask, status: 'COMPLETED' }, admin)).toBeNull();
  });

  it('CANCELLED durumunda null döner (terminal durum)', () => {
    expect(getPrimaryAction({ ...baseTask, status: 'CANCELLED' }, admin)).toBeNull();
  });

  it('BLOCKED durumunda null döner (bu ekranda birincil aksiyon gösterilmez)', () => {
    expect(getPrimaryAction({ ...baseTask, status: 'BLOCKED' }, admin)).toBeNull();
  });

  it('currentUser null olduğunda Admin-özel dallar tetiklenmez (Admin-olmayan davranışı uygulanır)', () => {
    const action = getPrimaryAction({ ...baseTask, status: 'IN_PROGRESS' }, null);
    expect(action?.label).toBe('TAMAMLA VE ONAYA SUN');
  });
});

describe('getTimeLeft', () => {
  const now = Date.now();

  it('COMPLETED görevler için null döner', () => {
    expect(getTimeLeft({ ...baseTask, status: 'COMPLETED' }, now)).toBeNull();
  });

  it('CANCELLED görevler için null döner', () => {
    expect(getTimeLeft({ ...baseTask, status: 'CANCELLED' }, now)).toBeNull();
  });

  it('mühlet henüz geçmemişse status "safe" veya "warning" olur, timeLeftMs pozitiftir', () => {
    const result = getTimeLeft({ ...baseTask, status: 'IN_PROGRESS', deadline: now + 2 * 86400000 }, now);
    expect(result?.timeLeftMs).toBeGreaterThan(0);
    expect(result?.status).toBe('safe');
  });

  it('mühlete 24 saatten az kaldığında status "warning" olur', () => {
    const result = getTimeLeft({ ...baseTask, status: 'IN_PROGRESS', deadline: now + 5 * 3600000 }, now);
    expect(result?.status).toBe('warning');
  });

  it('mühlet geçmişse status "expired" olur, timeLeftMs negatiftir, etiket "geçti" içerir', () => {
    const result = getTimeLeft({ ...baseTask, status: 'IN_PROGRESS', deadline: now - 3600000 }, now);
    expect(result?.timeLeftMs).toBeLessThan(0);
    expect(result?.status).toBe('expired');
    expect(result?.label).toContain('geçti');
  });

  it('görev duraklatılmışsa (pausedAt dolu) status "paused" olur ve etikete "(Duraklatıldı)" eklenir', () => {
    const result = getTimeLeft({ ...baseTask, status: 'BLOCKED', deadline: now + 86400000, pausedAt: now - 1000 }, now);
    expect(result?.status).toBe('paused');
    expect(result?.label).toContain('(Duraklatıldı)');
  });

  it('totalPausedTime efektif deadline\'ı ileri kaydırır', () => {
    const withoutPause = getTimeLeft({ ...baseTask, status: 'IN_PROGRESS', deadline: now + 1000, totalPausedTime: 0 }, now);
    const withPause = getTimeLeft({ ...baseTask, status: 'IN_PROGRESS', deadline: now + 1000, totalPausedTime: 3600000 }, now);
    expect(withPause!.timeLeftMs).toBeGreaterThan(withoutPause!.timeLeftMs);
  });
});

describe('getSLAColor', () => {
  it('her SLA durumu için doğru Tailwind rengini döner', () => {
    expect(getSLAColor('expired')).toBe('text-status-danger');
    expect(getSLAColor('warning')).toBe('text-status-warning');
    expect(getSLAColor('paused')).toBe('text-text-muted');
    expect(getSLAColor('safe')).toBe('text-status-success');
    expect(getSLAColor('unknown-status')).toBe('text-status-success');
  });
});

describe('computeChecklistStats', () => {
  it('boş veya undefined liste için total/completed/percent hepsi 0 döner', () => {
    expect(computeChecklistStats(undefined)).toEqual({ total: 0, completed: 0, percent: 0 });
    expect(computeChecklistStats([])).toEqual({ total: 0, completed: 0, percent: 0 });
  });

  it('tamamlanan öge sayısını doğru sayar', () => {
    const stats = computeChecklistStats([
      { id: '1', text: 'a', isCompleted: true },
      { id: '2', text: 'b', isCompleted: false },
      { id: '3', text: 'c', isCompleted: true },
    ]);
    expect(stats).toEqual({ total: 3, completed: 2, percent: 67 });
  });

  it('tamamlanma yüzdesini en yakın tam sayıya yuvarlar', () => {
    const stats = computeChecklistStats([
      { id: '1', text: 'a', isCompleted: true },
      { id: '2', text: 'b', isCompleted: false },
      { id: '3', text: 'c', isCompleted: false },
    ]);
    expect(stats.percent).toBe(33);
  });
});
