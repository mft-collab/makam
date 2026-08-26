import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerformanceRow } from './subcomponents';
import type { UserPerformanceProfile } from '../../lib/executiveMetrics';

const baseProfile: UserPerformanceProfile = {
  user: { uid: 'u1', fullName: 'Ali Yılmaz', email: 'ali@makam.com', role: 'Staff' },
  activeCount: 2, completedCount: 0, overdueCount: 0, blockedCount: 0, reviewCount: 0,
  onTimeCompletionRate: 100, loadScore: 20,
};

describe('PerformanceRow — Kadro Yük Matrisi pili SLA\'yı da yansıtır', () => {
  it('düşük yük + hiç tamamlanmış görevi yok (varsayılan SLA %100) → yeşil kalır, sahte alarm YOK', () => {
    const { container } = render(<PerformanceRow profile={baseProfile} />);
    expect(container.querySelector('.text-status-success')).toBeTruthy();
    expect(container.querySelector('.text-status-danger')).toBeFalsy();
  });

  it('düşük yük AMA en az bir tamamlanmış görev ve SLA %50 altı → pil kırmızıya döner (eskiden yalnızca loadScore\'a bakıp yeşil kalıyordu)', () => {
    const profile: UserPerformanceProfile = { ...baseProfile, completedCount: 4, onTimeCompletionRate: 0, loadScore: 20 };
    const { container } = render(<PerformanceRow profile={profile} />);
    expect(container.querySelector('.text-status-danger')).toBeTruthy();
    expect(screen.getByText('SLA %0')).toHaveClass('text-status-danger');
  });

  it('yüksek yük (loadScore >= 75) hâlâ kırmızı tetikler — SLA sinyali olmasa bile', () => {
    const profile: UserPerformanceProfile = { ...baseProfile, loadScore: 80 };
    const { container } = render(<PerformanceRow profile={profile} />);
    expect(container.querySelector('.text-status-danger')).toBeTruthy();
  });
});
