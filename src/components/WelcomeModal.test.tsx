import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { WelcomeModal } from './WelcomeModal';
import type { User } from '../types';

const staff: User = { uid: 'staff-1', fullName: 'Memur Ali', email: 'staff@makam.com', role: 'Staff' };
const manager: User = { uid: 'mgr-1', fullName: 'Müdür Hanım', email: 'mgr@makam.com', role: 'Manager' };
const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };

describe('WelcomeModal', () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanup();
  });

  it('ilk girişte (localStorage anahtarı yokken) karşılama gösterilir', () => {
    render(<WelcomeModal user={staff} />);
    expect(screen.getByRole('dialog', { name: 'Hoş Geldiniz' })).toBeInTheDocument();
    expect(screen.getByText(/Memur Ali/)).toBeInTheDocument();
  });

  it('"Anladım" ile kapatıldıktan sonra localStorage anahtarı set edilir ve bir sonraki mount\'ta bir daha gösterilmez', async () => {
    const { unmount } = render(<WelcomeModal user={staff} />);
    expect(screen.getByRole('dialog', { name: 'Hoş Geldiniz' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Anladım' }));
    // localStorage anahtarı hemen (senkron) set edilir; Modal'ın kendisi
    // framer-motion çıkış animasyonu bitene kadar DOM'da (opacity: 0) kalır.
    expect(window.localStorage.getItem('makam-onboarding-seen-staff-1')).toBe('1');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Hoş Geldiniz' })).not.toBeInTheDocument();
    });

    unmount();

    // Aynı kullanıcı ile yeniden mount edilince (ör. sayfa yenileme) karşılama
    // bir daha görünmemeli.
    render(<WelcomeModal user={staff} />);
    expect(screen.queryByRole('dialog', { name: 'Hoş Geldiniz' })).not.toBeInTheDocument();
  });

  it('farklı uid\'ler bağımsız çalışır: bir kullanıcının karşılamayı görmesi diğerini etkilemez', () => {
    const { unmount } = render(<WelcomeModal user={staff} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anladım' }));
    unmount();

    // Aynı cihazda oturum açan farklı bir kullanıcı (bkz. AuthenticatedApp.tsx
    // "aynı cihazdaki bir sonraki kullanıcı" senaryosu) karşılamayı yine görür.
    render(<WelcomeModal user={manager} />);
    expect(screen.getByRole('dialog', { name: 'Hoş Geldiniz' })).toBeInTheDocument();
    expect(window.localStorage.getItem('makam-onboarding-seen-staff-1')).toBe('1');
    expect(window.localStorage.getItem('makam-onboarding-seen-mgr-1')).toBeNull();
  });

  it('rol-duyarlı içerik: Admin ve Staff için farklı maddeler gösterilir', () => {
    const { unmount } = render(<WelcomeModal user={admin} />);
    expect(screen.getByText(/Denetim İzleri/)).toBeInTheDocument();
    unmount();

    render(<WelcomeModal user={staff} />);
    expect(screen.getByText(/Süreci Başlat/)).toBeInTheDocument();
    expect(screen.queryByText(/Denetim İzleri/)).not.toBeInTheDocument();
  });

  it('"Kılavuzu İncele" karşılamayı kapatır, mevcut GuideModal\'ı açar ve onboarding\'i de gördü olarak işaretler', async () => {
    render(<WelcomeModal user={staff} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kılavuzu İncele' }));

    expect(window.localStorage.getItem('makam-onboarding-seen-staff-1')).toBe('1');
    expect(screen.getByRole('dialog', { name: 'Kılavuz' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Hoş Geldiniz' })).not.toBeInTheDocument();
    });
  });
});
