import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormModal } from './TaskFormModal';
import type { Task, User } from '../types';

const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const manager: User = { uid: 'mgr-1', fullName: 'Müdür Hanım', email: 'mgr@makam.com', role: 'Manager' };
const staff1: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff1@makam.com', role: 'Staff' };
const staff2: User = { uid: 'staff-2', fullName: 'Memur Veli', email: 'staff2@makam.com', role: 'Staff' };
const allUsers = [admin, manager, staff1, staff2];

const renderForm = (overrides: Partial<React.ComponentProps<typeof TaskFormModal>> = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <TaskFormModal
      users={allUsers}
      currentUser={admin}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSubmit, onClose };
};

const getAssigneeSelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;
const getCoordinatorSelect = () => screen.getAllByRole('combobox')[1] as HTMLSelectElement;
const getPrioritySelect = () => screen.getAllByRole('combobox')[2] as HTMLSelectElement;
const getSubmitButton = () => screen.getByRole('button', { name: /ATAMAYI TAMAMLA|GÜNCELLE/ });

// Native <input type="date"> yerine premium takvim (DatePicker) kullanıldığından
// (bkz. TaskFormModal), "bugün" hücresi aria-current="date" ile işaretlenmiş
// tek gündür — gerçek sistem tarihinden ve ay gezinmesinden bağımsız, tekil bir seçim sağlar.
const pickTodayAsDeadline = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'SLA mühleti' }));
  const dialog = screen.getByRole('dialog', { name: 'SLA mühleti' });
  await user.click(within(dialog).getByRole('button', { current: 'date' }));
};

const fillValidForm = async (user: ReturnType<typeof userEvent.setup>, assigneeId = 'staff-1') => {
  await user.type(screen.getByPlaceholderText('Talimat Başlığı'), 'Test Talimatı');
  await user.type(screen.getByPlaceholderText('İşin detaylarını ve başarı kriterlerini tanımlayın...'), 'Detaylı açıklama');
  await user.selectOptions(getAssigneeSelect(), assigneeId);
  await pickTodayAsDeadline(user);
};

describe('TaskFormModal', () => {
  describe('zod doğrulaması', () => {
    it('zorunlu alanlar boş bırakılıp gönderilirse hata mesajları gösterilir, onSubmit çağrılmaz', async () => {
      const { onSubmit } = renderForm();

      await userEvent.click(getSubmitButton());

      expect(await screen.findByText('Başlık zorunludur.')).toBeInTheDocument();
      expect(screen.getByText('Açıklama zorunludur.')).toBeInTheDocument();
      expect(screen.getByText('Sorumlu seçimi zorunludur.')).toBeInTheDocument();
      expect(screen.getByText('Mühlet seçilmelidir.')).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('tüm alanlar geçerliyse onSubmit doğru veri şekliyle çağrılır', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm();

      await fillValidForm(user, 'staff-1');
      await userEvent.click(getSubmitButton());

      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      const data = onSubmit.mock.calls[0]![0];
      expect(data).toMatchObject({
        title: 'Test Talimatı', description: 'Detaylı açıklama', assigneeId: 'staff-1',
        priority: 'Medium', status: 'ASSIGNED', creatorId: 'admin-1',
      });
      expect(data.deadline).toBeTypeOf('number');
      expect(data.coordinatorId).toBeUndefined();
    });
  });

  describe('rol bazlı sorumlu filtreleme', () => {
    it('Admin: sorumlu listesinde Admin/Manager/Staff hepsi görünür', () => {
      renderForm({ currentUser: admin });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['admin-1', 'mgr-1', 'staff-1', 'staff-2']);
    });

    it('Manager: sorumlu listesinde yalnızca Manager ve Staff görünür (Admin yok)', () => {
      renderForm({ currentUser: manager });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['mgr-1', 'staff-1', 'staff-2']);
    });

    it('Staff: sorumlu listesinde yalnızca Staff görünür', () => {
      renderForm({ currentUser: staff1 });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['staff-1', 'staff-2']);
    });

    it('alt talimat (parentId dolu): rol ne olursa olsun sorumlu listesi sadece Staff\'a indirilir ve uyarı gösterilir', () => {
      renderForm({ currentUser: admin, parentId: 'parent-task-1' });
      const options = Array.from(getAssigneeSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['staff-1', 'staff-2']);
      expect(screen.getByText('Alt talimatlar yalnızca memurlara atanabilir.')).toBeInTheDocument();
    });
  });

  describe('irtibatlı (coordinator) listesi', () => {
    it('Admin rolündeki kullanıcılar irtibatlı listesinde hiç görünmez', () => {
      renderForm();
      const options = Array.from(getCoordinatorSelect().options).map(o => o.value).filter(Boolean);
      expect(options).not.toContain('admin-1');
    });

    it('seçili sorumlu, irtibatlı listesinden otomatik olarak elenir', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.selectOptions(getAssigneeSelect(), 'staff-1');

      const options = Array.from(getCoordinatorSelect().options).map(o => o.value).filter(Boolean);
      expect(options).not.toContain('staff-1');
      expect(options).toContain('staff-2');
      expect(options).toContain('mgr-1');
    });

    it('alt talimatta irtibatlı listesi de sadece Staff ile sınırlanır', () => {
      renderForm({ parentId: 'parent-task-1' });
      const options = Array.from(getCoordinatorSelect().options).map(o => o.value).filter(Boolean);
      expect(options).toEqual(['staff-1', 'staff-2']);
    });
  });

  describe('düzenleme modu (task prop verildiğinde)', () => {
    const existingTask: Task = {
      id: 'task-1', title: 'Mevcut Talimat', description: 'Mevcut açıklama', creatorId: 'admin-1',
      assigneeId: 'staff-1', coordinatorId: 'mgr-1', status: 'IN_PROGRESS', priority: 'High',
      deadline: new Date('2026-03-10').getTime(), createdAt: 1000, updatedAt: 1000,
      totalPausedTime: 0, lockVersion: 2, tags: [],
    } as Task;

    it('alanlar mevcut görev verisiyle önceden doldurulur', () => {
      renderForm({ task: existingTask });
      expect(screen.getByPlaceholderText('Talimat Başlığı')).toHaveValue('Mevcut Talimat');
      expect(screen.getByPlaceholderText('İşin detaylarını ve başarı kriterlerini tanımlayın...')).toHaveValue('Mevcut açıklama');
      expect(getAssigneeSelect()).toHaveValue('staff-1');
      expect(getPrioritySelect()).toHaveValue('High');
    });

    it('gönderimde status/creatorId/createdAt alanları eklenmez (mevcut görev güncellenir, yeniden oluşturulmaz)', async () => {
      const { onSubmit } = renderForm({ task: existingTask });

      await userEvent.click(getSubmitButton());

      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      const data = onSubmit.mock.calls[0]![0];
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('creatorId');
      expect(data).not.toHaveProperty('createdAt');
    });

    it('buton etiketi "GÜNCELLE" olur (yeni kayıtta "ATAMAYI TAMAMLA")', () => {
      renderForm({ task: existingTask });
      expect(screen.getByRole('button', { name: 'GÜNCELLE' })).toBeInTheDocument();
    });

    it('mevcut sorumlunun rolü düzenleyenin izinli listesinde değilse (ör. Manager, Admin\'e atanmış görevi düzenlerken) yine de seçenekte görünür ve uyarı gösterilir', () => {
      // Manager'ın izinli rolleri ['Manager','Staff'] — 'Admin' yok. Eskiden bu
      // durumda mevcut sorumlu <select> seçeneklerinden tamamen düşüyordu (bkz.
      // kod denetimi).
      const taskAssignedToAdmin: Task = { ...existingTask, assigneeId: 'admin-1' };
      renderForm({ task: taskAssignedToAdmin, currentUser: manager });

      expect(getAssigneeSelect()).toHaveValue('admin-1');
      expect(within(getAssigneeSelect()).getByRole('option', { name: 'Müftü Bey' })).toBeInTheDocument();
      expect(screen.getByText(/Mevcut sorumlu \(Müftü Bey\) sizin atayabileceğiniz rol dışında/)).toBeInTheDocument();
    });

    it('mevcut sorumlunun rolü düzenleyenin izinli listesindeyse uyarı gösterilmez', () => {
      renderForm({ task: existingTask, currentUser: manager });
      expect(screen.queryByText(/sizin atayabileceğiniz rol dışında/)).not.toBeInTheDocument();
    });
  });

  it('İPTAL butonuna tıklanınca onClose çağrılır', async () => {
    const { onClose } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'İPTAL' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
