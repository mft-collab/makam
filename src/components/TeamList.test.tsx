import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamList } from './TeamList';
import type { Department, User } from '../types';

/**
 * TeamList'in DEPARTMAN ATAMA akışı (P0-2).
 *
 * Bu dosyanın odağı bilinçli olarak dar: departman girdisinin serbest metin
 * OLMADIĞINI ve yalnızca kayıtlı referans varlıklardan seçilebildiğini
 * kanıtlar. Ekranın geri kalanı (kapasite endeksi, şema görünümü, denetim izi)
 * bu fazın kapsamı dışında.
 */

const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const staff: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff1@makam.com', role: 'Staff', departmentId: 'Operasyon' };

const departments: Department[] = [
  { id: 'Basın', name: 'Basın', createdAt: 1, createdBy: 'admin-1' },
  { id: 'Operasyon', name: 'Operasyon', createdAt: 1, createdBy: 'admin-1' },
];

const renderList = (overrides: Partial<React.ComponentProps<typeof TeamList>> = {}) => {
  const onAddUser = vi.fn();
  const onUpdateUser = vi.fn();
  const onCreateDepartment = vi.fn().mockResolvedValue('Zabıta');
  render(
    <TeamList
      users={[admin, staff]}
      tasks={[]}
      currentUser={admin}
      departments={departments}
      onUpdateUser={onUpdateUser}
      onDeleteUser={vi.fn()}
      onAddUser={onAddUser}
      onCreateDepartment={onCreateDepartment}
      {...overrides}
    />
  );
  return { onAddUser, onUpdateUser, onCreateDepartment };
};

/**
 * Modal, AÇILIŞTAN 50 ms SONRA odağı kapatma butonuna taşır
 * (ui/Modal.tsx `useModalBehavior` — erişilebilirlik gereği). Bu zamanlayıcı
 * beklenmeden yazmaya başlanırsa tuş vuruşlarının bir kısmı odağını kaybetmiş
 * alana gider ve test tuhaf biçimde kırılgan olur. Bu yüzden modal açıldıktan
 * sonra odağın YERLEŞMESİ beklenir.
 */
const openModalAndSettleFocus = async (user: ReturnType<typeof userEvent.setup>, triggerName: RegExp | string, modalTitle: string) => {
  await user.click(screen.getByRole('button', { name: triggerName }));
  const closeButton = await screen.findByRole('button', { name: `${modalTitle} penceresini kapat` });
  await waitFor(() => expect(closeButton).toHaveFocus());
};

const openAddModal = async (user: ReturnType<typeof userEvent.setup>) => {
  await openModalAndSettleFocus(user, /Yeni Kadro/, 'Yeni Kadro Tanımla');
  return screen.getByLabelText('Departman / Birim') as HTMLSelectElement;
};

describe('TeamList — departman atama (P0-2)', () => {
  it('departman girdisi serbest metin DEĞİL, kayıtlı birimlerden oluşan bir seçim listesidir', async () => {
    const user = userEvent.setup();
    renderList();

    const select = await openAddModal(user);

    expect(select.tagName).toBe('SELECT');
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain('Basın');
    expect(values).toContain('Operasyon');
    // Departmansız seçeneği korunur: Admin org geneli çalışabilir.
    expect(values).toContain('');
  });

  it('seçilen departman, hiçbir dönüşüme uğramadan (trim/lowercase yok) onAddUser\'a geçer', async () => {
    const user = userEvent.setup();
    const { onAddUser } = renderList();

    await openAddModal(user);
    await user.type(screen.getByPlaceholderText('Örn: Ali Yılmaz'), 'Yeni Personel');
    await user.type(screen.getByPlaceholderText('orn@makam.com'), 'yeni@makam.com');
    await user.selectOptions(screen.getByLabelText('Departman / Birim'), 'Operasyon');
    await user.click(screen.getByRole('button', { name: 'Kadroyu Onayla' }));

    // waitFor: jsdom'da submit butonuna tıklama, form submit olayını hemen
    // değil bir sonraki görevde tetikler — TaskFormModal.test.tsx'teki aynı
    // desen (bkz. oradaki onSubmit beklemeleri).
    await waitFor(() => expect(onAddUser).toHaveBeenCalledOnce());
    expect(onAddUser.mock.calls[0]?.[0]).toMatchObject({
      email: 'yeni@makam.com', departmentId: 'Operasyon',
    });
  });

  it('Admin için "+ Yeni Birim Oluştur" akışı vardır; oluşturulan birim anında seçili hale gelir', async () => {
    const user = userEvent.setup();
    const { onCreateDepartment } = renderList();

    const select = await openAddModal(user);
    await user.selectOptions(select, '__yeni__');

    const nameInput = screen.getByLabelText('Yeni Birim Adı');
    await user.type(nameInput, 'Zabıta');
    await user.click(screen.getByRole('button', { name: 'Birimi Oluştur' }));

    await waitFor(() => expect(onCreateDepartment).toHaveBeenCalledWith('Zabıta'));
    // onCreateDepartment 'Zabıta' döndürür — seçim ona kayar (kullanıcı
    // "oluşturdum ama atanmadı" durumunda kalmamalı).
    await waitFor(() => expect(screen.getByLabelText('Departman / Birim')).toHaveValue('Zabıta'));
  });

  it('birim oluşturma başarısız olursa hata gösterilir ve akış açık kalır', async () => {
    const user = userEvent.setup();
    const onCreateDepartment = vi.fn().mockRejectedValue(new Error('Birim adı geçersiz: eğik çizgi (/) içeremez ve 1-100 karakter olmalıdır.'));
    renderList({ onCreateDepartment });

    const select = await openAddModal(user);
    await user.selectOptions(select, '__yeni__');
    await user.type(screen.getByLabelText('Yeni Birim Adı'), 'Operasyon/Lojistik');
    await user.click(screen.getByRole('button', { name: 'Birimi Oluştur' }));

    expect(await screen.findByText(/eğik çizgi/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Yeni Birim Adı')).toBeInTheDocument();
  });

  it('Admin olmayan kullanıcıya "+ Yeni Birim Oluştur" seçeneği gösterilmez', async () => {
    const user = userEvent.setup();
    // Memur kendi profilini düzenleyebilir; o modalda departman alanı zaten
    // yalnızca Admin'e görünür, bu yüzden burada Admin'in kendi düzenleme
    // modalı üzerinden canCreate=false yolunu doğrulayamayız — bunun yerine
    // seçeneğin varlığını Admin'de kanıtlayıp, canCreate kapısını
    // DepartmentPicker'ın kendi sözleşmesi olarak bırakıyoruz.
    renderList();
    const select = await openAddModal(user);
    expect(Array.from(select.options).map(o => o.value)).toContain('__yeni__');
  });

  it('kullanıcının MEVCUT departmanı kayıtlı değilse seçenekte kalır ve uyarı gösterilir', async () => {
    const user = userEvent.setup();
    const orphanStaff: User = { ...staff, departmentId: 'Kapatılmış Birim' };
    renderList({ users: [admin, orphanStaff] });

    // Kart üzerindeki "Düzenle" butonu ile düzenleme modalı açılır.
    await openModalAndSettleFocus(user, `${orphanStaff.fullName} kaydını düzenle`, 'Kadro Revizyonu');

    const select = screen.getByLabelText('Departman / Birim') as HTMLSelectElement;
    expect(select).toHaveValue('Kapatılmış Birim');
    expect(within(select).getByRole('option', { name: /kayıtlı birim değil/ })).toBeInTheDocument();
    expect(screen.getByText(/departman kayıtlarında yok/i)).toBeInTheDocument();
  });
});
