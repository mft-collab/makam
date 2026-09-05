import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskBoard } from './TaskBoard';
import type { Task, User } from '../types';

const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const manager: User = { uid: 'mgr-1', fullName: 'Müdür Hanım', email: 'mgr@makam.com', role: 'Manager', departmentId: 'Operasyon' };
const staff: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff@makam.com', role: 'Staff', departmentId: 'Operasyon' };

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'admin-1', assigneeId: 'staff-1',
  status: 'ASSIGNED', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 0, tags: [],
  ...overrides,
} as Task);

const renderBoard = (overrides: Partial<React.ComponentProps<typeof TaskBoard>> = {}) => {
  const onAddTask = vi.fn();
  const onViewTask = vi.fn();
  render(
    <TaskBoard
      tasks={[]}
      users={[admin, manager, staff]}
      currentUser={admin}
      onAddTask={onAddTask}
      onViewTask={onViewTask}
      {...overrides}
    />
  );
  return { onAddTask, onViewTask };
};

// NOT: TaskBoard aynı anda hem mobil (sm:hidden) hem masaüstü (hidden sm:block)
// boş-durum bloğunu render eder, ikisi de AYNI EmptyState düğümünü kullanır
// (bkz. TaskBoard.tsx emptyStateNode) — jsdom gerçek bir stylesheet
// uygulamadığından medya sorgusuyla gizlenen taraf da DOM'da "görünür" kalır.
// Bu yüzden CTA'lar getAllByRole ile (tekil değil) sorgulanır.
describe('TaskBoard — boş durum aktivasyon CTA\'sı (P2-17)', () => {
  it('hiç görev yoksa ve kullanıcı görev oluşturabiliyorsa (Admin) "İlk Talimatı Oluştur" CTA\'sı gösterilir ve onAddTask\'i tetikler', async () => {
    const user = userEvent.setup();
    const { onAddTask } = renderBoard({ tasks: [], currentUser: admin });

    const ctas = screen.getAllByRole('button', { name: 'İlk Talimatı Oluştur' });
    expect(ctas.length).toBeGreaterThan(0);

    await user.click(ctas[0]);
    expect(onAddTask).toHaveBeenCalledTimes(1);
  });

  it('hiç görev yoksa ve kullanıcı Manager ise "İlk Talimatı Oluştur" CTA\'sı gösterilir', () => {
    renderBoard({ tasks: [], currentUser: manager });
    expect(screen.getAllByRole('button', { name: 'İlk Talimatı Oluştur' }).length).toBeGreaterThan(0);
  });

  it('hiç görev yoksa ama kullanıcı Staff ise CTA gösterilmez (firestore.rules tasks create sadece Admin/Manager\'a izin verir)', () => {
    renderBoard({ tasks: [], currentUser: staff });
    expect(screen.queryByRole('button', { name: 'İlk Talimatı Oluştur' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Henüz talimat bulunmuyor').length).toBeGreaterThan(0);
  });

  it('bir filtre uygulanmışken sonuç boşsa "İlk Talimatı Oluştur" YERİNE "Filtreyi Temizle" gösterilir', async () => {
    const user = userEvent.setup();
    renderBoard({ tasks: [makeTask({ priority: 'Low' })], currentUser: admin });

    await user.selectOptions(screen.getByLabelText('Öncelik filtresi'), 'Urgent');

    expect(screen.queryByRole('button', { name: 'İlk Talimatı Oluştur' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Filtreyi Temizle' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Filtrelerinize uygun talimat bulunamadı').length).toBeGreaterThan(0);
  });

  it('görev listesi doluyken boş durum/CTA hiç render edilmez', () => {
    renderBoard({ tasks: [makeTask()], currentUser: admin });
    expect(screen.queryByRole('button', { name: 'İlk Talimatı Oluştur' })).not.toBeInTheDocument();
    expect(screen.queryByText('Henüz talimat bulunmuyor')).not.toBeInTheDocument();
  });
});
