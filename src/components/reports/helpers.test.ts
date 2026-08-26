import { describe, it, expect } from 'vitest';
import {
  filterTasksByDateAndDept, computeManagers, buildTasksByAssignee, computeManagerPerformance, getTasksForUser,
} from './helpers';
import type { Task, User } from '../../types';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-08-26T12:00:00');
// Reports.tsx'in varsayılan aralığıyla aynı: son 30 gün.
const rangeStart = new Date(now - 30 * DAY);
const rangeEnd = new Date(now);

const baseTask: Task = {
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'mgr-eski',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: now + 100_000,
  createdAt: now, updatedAt: now, totalPausedTime: 0, lockVersion: 0,
  tags: [], checklist: [], comments: [],
} as Task;

const managerEski: User = { uid: 'mgr-eski', fullName: 'Eski Müdür', email: 'eski@makam.com', role: 'Manager' };
const managerYeni: User = { uid: 'mgr-yeni', fullName: 'Yeni Müdür', email: 'yeni@makam.com', role: 'Manager' };

describe('filterTasksByDateAndDept', () => {
  it('aralıktan önce oluşturulmuş ama hâlâ AÇIK bir görevi kapsama alır (eski davranış: dışarıda bırakıyordu)', () => {
    // 45 gün önce oluşturulmuş, hâlâ IN_PROGRESS — 30 günlük varsayılan
    // pencerenin dışında oluşturulmuş olsa da bugün hâlâ birinin elinde.
    const oldButActive: Task = { ...baseTask, id: 'old-active', createdAt: now - 45 * DAY, updatedAt: now - 2 * DAY, status: 'IN_PROGRESS' };
    const result = filterTasksByDateAndDept([oldButActive], rangeStart, rangeEnd, 'ALL');
    expect(result).toHaveLength(1);
  });

  it('aralıktan önce oluşturulup aralıktan önce SONUÇLANMIŞ (tamamlanmış) bir görevi dışarıda bırakır', () => {
    const oldAndDone: Task = {
      ...baseTask, id: 'old-done', createdAt: now - 60 * DAY, status: 'COMPLETED', completedAt: now - 45 * DAY, updatedAt: now - 45 * DAY,
    };
    const result = filterTasksByDateAndDept([oldAndDone], rangeStart, rangeEnd, 'ALL');
    expect(result).toHaveLength(0);
  });

  it('aralıktan önce oluşturulmuş ama BU aralıkta tamamlanmış bir görevi kapsama alır', () => {
    const oldButCompletedRecently: Task = {
      ...baseTask, id: 'old-completed-recent', createdAt: now - 45 * DAY, status: 'COMPLETED', completedAt: now - 5 * DAY, updatedAt: now - 5 * DAY,
    };
    const result = filterTasksByDateAndDept([oldButCompletedRecently], rangeStart, rangeEnd, 'ALL');
    expect(result).toHaveLength(1);
  });

  it('aralık bitiminden SONRA oluşturulan bir görevi (henüz var olmayan) dışarıda bırakır', () => {
    const future: Task = { ...baseTask, id: 'future', createdAt: now + 10 * DAY };
    const result = filterTasksByDateAndDept([future], rangeStart, rangeEnd, 'ALL');
    expect(result).toHaveLength(0);
  });

  it('birim filtresi hâlâ ayrı ayrı uygulanır', () => {
    const otherDept: Task = { ...baseTask, id: 'other-dept', departmentId: 'Finans' };
    const result = filterTasksByDateAndDept([otherDept], rangeStart, rangeEnd, 'Operasyon');
    expect(result).toHaveLength(0);
  });
});

describe('Yönetici Performans Endeksi — uçtan uca veri akışı', () => {
  it('biri yakın zamanda göreve atanmış, diğeri eski ama hâlâ aktif göreve sahip iki yönetici de "Veri yok" DEĞİL, gerçek verisiyle görünür', () => {
    const tasks: Task[] = [
      // Yeni Müdür: 3 gün önce atanmış, normal senaryo — eskiden de çalışıyordu.
      { ...baseTask, id: 't-yeni', assigneeId: 'mgr-yeni', createdAt: now - 3 * DAY, status: 'IN_PROGRESS' },
      // Eski Müdür: görev 50 gün önce oluşturulmuş (varsayılan 30 günlük
      // pencerenin dışında) ama HÂLÂ aktif — bu yüzden eskiden Yönetici
      // Performans Endeksi'nde "Veri yok" görünüyordu, gerçekte iş yükü var.
      { ...baseTask, id: 't-eski', assigneeId: 'mgr-eski', createdAt: now - 50 * DAY, updatedAt: now - 10 * DAY, status: 'BLOCKED' },
    ];

    const filteredTasks = filterTasksByDateAndDept(tasks, rangeStart, rangeEnd, 'ALL');
    const managers = computeManagers([managerEski, managerYeni], 'ALL');
    const tasksByAssignee = buildTasksByAssignee(filteredTasks);
    const rows = computeManagerPerformance(managers, tasksByAssignee);

    const eskiRow = rows.find(r => r.uid === 'mgr-eski');
    const yeniRow = rows.find(r => r.uid === 'mgr-yeni');

    expect(yeniRow?.hasData).toBe(true);
    expect(yeniRow?.total).toBe(1);
    // Kök neden düzeltmeden önce bu satır hasData:false, total:0 dönüyordu.
    expect(eskiRow?.hasData).toBe(true);
    expect(eskiRow?.total).toBe(1);
  });
});

describe('getTasksForUser', () => {
  it('uid ve email için ayrı ayrı atanmış görevleri birleştirir (temp-uid → gerçek uid geçiş dönemi)', () => {
    const tasksByAssignee = buildTasksByAssignee([
      { ...baseTask, id: 't1', assigneeId: 'real-uid-123' },
      { ...baseTask, id: 't2', assigneeId: 'kisi@makam.com' },
    ]);
    const result = getTasksForUser(tasksByAssignee, { uid: 'real-uid-123', email: 'kisi@makam.com' });
    expect(result.map(t => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('uid === email olan (henüz hiç giriş yapmamış / temp) kullanıcı için tekrar saymaz', () => {
    const tasksByAssignee = buildTasksByAssignee([{ ...baseTask, id: 't1', assigneeId: 'temp@makam.com' }]);
    const result = getTasksForUser(tasksByAssignee, { uid: 'temp@makam.com', email: 'temp@makam.com' });
    expect(result).toHaveLength(1);
  });
});
