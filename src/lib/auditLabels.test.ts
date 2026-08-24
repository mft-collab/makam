import { describe, it, expect } from 'vitest';
import { formatAuditValue } from './auditLabels';
import type { User } from '../types';

const users: User[] = [
  { uid: 'user-1', fullName: 'Ayşe Yılmaz', email: 'ayse@makam.local', role: 'Manager' },
  { uid: 'user-2', fullName: 'Mehmet Kaya', email: 'mehmet@makam.local', role: 'Staff' },
];

describe('formatAuditValue', () => {
  it('tarih alanlarını (deadline/createdAt/updatedAt/completedAt) okunaklı tarihe çevirir, ham epoch göstermez', () => {
    const ms = new Date(2026, 7, 24).getTime();
    for (const field of ['deadline', 'createdAt', 'updatedAt', 'completedAt']) {
      const result = formatAuditValue(field, ms);
      expect(result).not.toBe(String(ms));
      expect(result).not.toMatch(/^\d{10,}$/);
    }
  });

  it('geçersiz/negatif tarih değerinde ham değere düşer ama çökmez', () => {
    expect(() => formatAuditValue('deadline', -1)).not.toThrow();
    expect(() => formatAuditValue('deadline', NaN)).not.toThrow();
  });

  it('assigneeId/coordinatorId alanlarını (uid veya email eşleşmesiyle) kullanıcı adına çözümler', () => {
    expect(formatAuditValue('assigneeId', 'user-1', users)).toBe('Ayşe Yılmaz');
    expect(formatAuditValue('coordinatorId', 'mehmet@makam.local', users)).toBe('Mehmet Kaya');
  });

  it('users verilmezse veya eşleşme bulunamazsa ham (kısaltılmış) UID\'e düşer, çökmez', () => {
    expect(formatAuditValue('assigneeId', 'user-1')).toBe('user-1');
    expect(formatAuditValue('assigneeId', 'unknown-uid-xyz', users)).toBe('unknown-uid-xyz'.slice(0, 20));
  });

  it('checklist/priority/status/deleted alanları için mevcut davranışı korur', () => {
    expect(formatAuditValue('checklist', [{ isCompleted: true }, { isCompleted: false }])).toBe('1/2 tamamlandı');
    expect(formatAuditValue('priority', 'Urgent')).toBe('İvedi');
    expect(formatAuditValue('status', 'IN_PROGRESS')).toBe('İcra Aşamasında');
    expect(formatAuditValue('deleted', true)).toBe('Evet');
  });

  it('null/undefined için "-" döner', () => {
    expect(formatAuditValue('title', null)).toBe('-');
    expect(formatAuditValue('title', undefined)).toBe('-');
  });
});
