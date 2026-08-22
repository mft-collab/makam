import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockerList } from './BlockerList';
import type { Task, TaskBlocker, User } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Talimat', description: '', creatorId: 'c1', assigneeId: 'staff-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: Date.now() + 100_000, createdAt: 1000, updatedAt: 1000,
  totalPausedTime: 0, lockVersion: 0, tags: [],
  ...overrides,
} as Task);

const makeBlocker = (overrides: Partial<TaskBlocker> = {}): TaskBlocker => ({
  id: 'blocker-1', taskId: 'task-1', reason: 'Bir sebep', isResolved: false, createdAt: 1000, ...overrides,
});

const staff: User = { uid: 'staff-1', fullName: 'Ali Yılmaz', email: 'ali@makam.com', role: 'Staff' };

const renderList = (overrides: Partial<React.ComponentProps<typeof BlockerList>> = {}) => {
  const onResolve = vi.fn();
  const onEditBlocker = vi.fn();
  const onDeleteBlocker = vi.fn();
  const onViewTask = vi.fn();
  render(
    <BlockerList
      tasks={[]}
      blockers={[]}
      users={[staff]}
      isAdmin={false}
      onResolve={onResolve}
      onEditBlocker={onEditBlocker}
      onDeleteBlocker={onDeleteBlocker}
      onViewTask={onViewTask}
      {...overrides}
    />
  );
  return { onResolve, onEditBlocker, onDeleteBlocker, onViewTask };
};

describe('BlockerList', () => {
  describe('aktif/çözülmüş ayrımı ve sıralama', () => {
    it('çözülmemiş engeller "Aktif Kriz Engelleri" başlığı altında sayılır, çözülenler dışarıda tutulur', () => {
      const task = makeTask();
      renderList({
        tasks: [task],
        blockers: [makeBlocker({ id: 'b1', isResolved: false }), makeBlocker({ id: 'b2', isResolved: true })],
      });

      expect(screen.getByText('1 Aktif Engel')).toBeInTheDocument();
      expect(screen.queryByText('Arşivlenmiş kayıt yok')).not.toBeInTheDocument();
    });

    it('hiç aktif engel yoksa boş durum mesajı gösterilir', () => {
      renderList({ blockers: [] });
      expect(screen.getByText('Aktif engel bulunmuyor')).toBeInTheDocument();
    });

    it('hiç çözülmüş engel yoksa boş durum mesajı gösterilir', () => {
      const task = makeTask();
      renderList({ tasks: [task], blockers: [makeBlocker({ isResolved: false })] });
      expect(screen.getByText('Arşivlenmiş kayıt yok')).toBeInTheDocument();
    });

    it('aktif engeller görev önceliğine göre azalan sırada listelenir (Urgent > Low)', () => {
      const lowTask = makeTask({ id: 'low-task', priority: 'Low' });
      const urgentTask = makeTask({ id: 'urgent-task', priority: 'Urgent' });
      renderList({
        tasks: [lowTask, urgentTask],
        blockers: [
          makeBlocker({ id: 'b-low', taskId: 'low-task', reason: 'Düşük öncelikli engel', createdAt: 2000 }),
          makeBlocker({ id: 'b-urgent', taskId: 'urgent-task', reason: 'İvedi engel', createdAt: 1000 }),
        ],
      });

      const reasons = screen.getAllByText(/engel$/).map(el => el.textContent);
      expect(reasons.indexOf('İvedi engel')).toBeLessThan(reasons.indexOf('Düşük öncelikli engel'));
    });

    it('aynı öncelikte engeller createdAt\'e göre azalan (en yeni önce) sırada listelenir', () => {
      const task = makeTask({ priority: 'Medium' });
      renderList({
        tasks: [task],
        blockers: [
          makeBlocker({ id: 'b-old', reason: 'Eski engel', createdAt: 1000 }),
          makeBlocker({ id: 'b-new', reason: 'Yeni engel', createdAt: 5000 }),
        ],
      });

      const reasons = screen.getAllByText(/engel$/).map(el => el.textContent);
      expect(reasons.indexOf('Yeni engel')).toBeLessThan(reasons.indexOf('Eski engel'));
    });
  });

  describe('rol bazlı aksiyon görünürlüğü', () => {
    it('isAdmin=false: Düzenle/Sil/Çözüldü butonlarının hiçbiri gösterilmez', () => {
      const task = makeTask();
      renderList({ tasks: [task], blockers: [makeBlocker()], isAdmin: false });

      expect(screen.queryByTitle('Düzenle')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Sil')).not.toBeInTheDocument();
      expect(screen.queryByText('Çözüldü')).not.toBeInTheDocument();
    });

    it('isAdmin=true + isSystemAdmin=false (varsayılan): Düzenle ve Çözüldü görünür, Sil görünmez', () => {
      const task = makeTask();
      renderList({ tasks: [task], blockers: [makeBlocker()], isAdmin: true });

      expect(screen.getByTitle('Düzenle')).toBeInTheDocument();
      expect(screen.getByText('Çözüldü')).toBeInTheDocument();
      expect(screen.queryByTitle('Sil')).not.toBeInTheDocument();
    });

    it('isAdmin=true + isSystemAdmin=true: Sil butonu da görünür', () => {
      const task = makeTask();
      renderList({ tasks: [task], blockers: [makeBlocker()], isAdmin: true, isSystemAdmin: true });

      expect(screen.getByTitle('Sil')).toBeInTheDocument();
    });

    it('çözülmüş bir engel için Çözüldü butonu (isAdmin=true olsa da) gösterilmez', () => {
      const task = makeTask();
      renderList({ tasks: [task], blockers: [makeBlocker({ isResolved: true })], isAdmin: true });

      expect(screen.queryByText('Çözüldü')).not.toBeInTheDocument();
    });
  });

  describe('etkileşimler', () => {
    // Bare userEvent.click/type/clear çağrılarının her biri örtük olarak KENDİ
    // userEvent.setup() örneğini oluşturur — ardışık etkileşimlerde (özellikle
    // clear→type→click) pointer/keyboard durumu çağrılar arası taşınmaz.
    // Testing Library v14 dokümantasyonu tek bir paylaşılan `user` örneği
    // kullanmayı önerir (bkz. TaskFormModal.test.tsx'teki aynı desen) — bu,
    // CI'da (yoğun paralel worker yükü altında) gözlenen ama yerelde
    // tekrarlanamayan bir "Düzenle" akışı test kırılganlığını giderir.
    it('karta tıklamak ilgili görev bulunabiliyorsa onViewTask(task) çağırır', async () => {
      const user = userEvent.setup();
      const task = makeTask();
      const { onViewTask } = renderList({ tasks: [task], blockers: [makeBlocker({ reason: 'Tıklanabilir engel' })] });

      await user.click(screen.getByText('Tıklanabilir engel'));

      expect(onViewTask).toHaveBeenCalledWith(task);
    });

    it('"Çözüldü" butonuna tıklamak onResolve\'u çağırır ama karta tıklama (onViewTask) tetiklenmez', async () => {
      const user = userEvent.setup();
      const task = makeTask();
      const { onResolve, onViewTask } = renderList({ tasks: [task], blockers: [makeBlocker({ id: 'blocker-9' })], isAdmin: true });

      await user.click(screen.getByText('Çözüldü'));

      expect(onResolve).toHaveBeenCalledWith('blocker-9');
      expect(onViewTask).not.toHaveBeenCalled();
    });

    it('"Düzenle" akışı: modal sebep ile önceden doldurulur, kaydet onEditBlocker(id, trimmedReason) çağırır ve modalı kapatır', async () => {
      const user = userEvent.setup();
      const task = makeTask();
      const { onEditBlocker } = renderList({
        tasks: [task], blockers: [makeBlocker({ id: 'blocker-9', reason: 'Orijinal sebep' })], isAdmin: true,
      });

      await user.click(screen.getByTitle('Düzenle'));
      const input = await screen.findByDisplayValue('Orijinal sebep');
      // userEvent.clear()/type() (tuş-tuş simülasyon, aralarda gerçek zaman
      // geçiren) CI'de iki kez farklı şekilde kırıldı — ikinci seferinde
      // input tamamen boş kaldı (type() hiç karakter yazmamış gibi). Bu
      // testin amacı klavye mekaniğini değil "düzenlenmiş değer trim'lenip
      // onEditBlocker'a gidiyor mu"yu doğrulamak olduğundan, controlled
      // input'un tek bir senkron change event'iyle doldurulması hem daha
      // belirlenimli hem de bileşenin gerçekten önemsediği tek şeyle
      // (onChange'in aldığı nihai value) birebir eşleşiyor.
      fireEvent.change(input, { target: { value: '  Güncellenmiş sebep  ' } });
      expect(input).toHaveValue('  Güncellenmiş sebep  ');
      await user.click(screen.getByRole('button', { name: 'Kaydet' }));

      await waitFor(() => expect(onEditBlocker).toHaveBeenCalledWith('blocker-9', 'Güncellenmiş sebep'));
      await waitFor(() => expect(screen.queryByText('Engeli Düzenle')).not.toBeInTheDocument());
    });

    it('"Düzenle" akışında İptal, onEditBlocker çağırmadan modalı kapatır', async () => {
      const user = userEvent.setup();
      const task = makeTask();
      const { onEditBlocker } = renderList({ tasks: [task], blockers: [makeBlocker()], isAdmin: true });

      await user.click(screen.getByTitle('Düzenle'));
      await screen.findByText('Engeli Düzenle');
      await user.click(screen.getByRole('button', { name: 'İptal' }));

      expect(onEditBlocker).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText('Engeli Düzenle')).not.toBeInTheDocument());
    });

    it('"Sil" akışı: onay modalında "Sil" onaylanınca onDeleteBlocker(id) çağrılır', async () => {
      const user = userEvent.setup();
      const task = makeTask();
      const { onDeleteBlocker } = renderList({
        tasks: [task], blockers: [makeBlocker({ id: 'blocker-9' })], isAdmin: true, isSystemAdmin: true,
      });

      await user.click(screen.getByTitle('Sil'));
      await screen.findByText('Bu engeli silmek istediğinize emin misiniz?');
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Sil' }));

      expect(onDeleteBlocker).toHaveBeenCalledWith('blocker-9');
    });

    it('"Sil" akışında İptal, onDeleteBlocker çağırmadan modalı kapatır', async () => {
      const user = userEvent.setup();
      const task = makeTask();
      const { onDeleteBlocker } = renderList({
        tasks: [task], blockers: [makeBlocker()], isAdmin: true, isSystemAdmin: true,
      });

      await user.click(screen.getByTitle('Sil'));
      await screen.findByText('Bu engeli silmek istediğinize emin misiniz?');
      await user.click(screen.getByRole('button', { name: 'İptal' }));

      expect(onDeleteBlocker).not.toHaveBeenCalled();
    });
  });
});
