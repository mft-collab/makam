import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Reports } from './Reports';
import type { Task, User, TaskBlocker } from '../types';

const admin: User = { uid: 'admin-1', fullName: 'Müftü Bey', email: 'admin@makam.com', role: 'Admin' };
const task: Task = {
  id: 'task-1', title: 'Test Talimatı', description: '', creatorId: 'admin-1', assigneeId: 'admin-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: Date.now() + 100000,
  createdAt: Date.now(), updatedAt: Date.now(), totalPausedTime: 0, lockVersion: 0,
  tags: [], checklist: [], comments: [],
};
const users: User[] = [admin];
const blockers: TaskBlocker[] = [];

const getDateFromInput = () => screen.getByLabelText('Rapor başlangıç tarihi') as HTMLInputElement;

describe('Reports — tarih aralığı filtresi', () => {
  it('geçersiz/boş tarih değeri girilince çökmez ve son geçerli değeri korur', () => {
    render(<Reports tasks={[task]} users={users} blockers={blockers} />);
    const input = getDateFromInput();
    const validValue = input.value;
    expect(validValue).not.toBe('');

    // Native <input type="date"> yazım sırasında geçici olarak boş string
    // raporlayabilir (bkz. kod denetimi) — bileşen çökmemeli.
    expect(() => fireEvent.change(input, { target: { value: '' } })).not.toThrow();

    // Geçersiz değer state'e yazılmamalı — input hâlâ son geçerli değeri göstermeli.
    expect(getDateFromInput().value).toBe(validValue);
  });

  it('geçerli bir tarih değeri normal şekilde kabul edilir', () => {
    render(<Reports tasks={[task]} users={users} blockers={blockers} />);
    const input = getDateFromInput();

    fireEvent.change(input, { target: { value: '2026-01-01' } });

    expect(getDateFromInput().value).toBe('2026-01-01');
  });
});
