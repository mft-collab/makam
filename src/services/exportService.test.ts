import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportTasksToCSV, exportTasksToPDF } from './exportService';
import { STATUS_LABELS, PRIORITY_LABELS } from '../constants';
import type { Task, User } from '../types';

// jsPDF'in gerçek html2canvas render motoru jsdom'da çalışmaz — bu yüzden
// tüm jsPDF sınıfını, çağrıları yakalayan sahte metodlarla değiştiriyoruz.
// html() varsayılan olarak callback'i senkron çağırıp resolve eden bir
// Promise döner (gerçek API .catch() ile zincirlendiği için Promise olmalı).
const {
  htmlMock, saveMock, setPageMock, setFontMock, setFontSizeMock,
  setTextColorMock, textMock, getNumberOfPagesMock, ctorSpy,
} = vi.hoisted(() => ({
  htmlMock: vi.fn(),
  saveMock: vi.fn(),
  setPageMock: vi.fn(),
  setFontMock: vi.fn(),
  setFontSizeMock: vi.fn(),
  setTextColorMock: vi.fn(),
  textMock: vi.fn(),
  getNumberOfPagesMock: vi.fn(() => 1),
  ctorSpy: vi.fn(),
}));

vi.mock('jspdf', () => ({
  default: class MockJsPDF {
    internal = { pageSize: { getHeight: () => 210 } };
    constructor(opts: unknown) { ctorSpy(opts); }
    html = htmlMock;
    save = saveMock;
    setPage = setPageMock;
    setFont = setFontMock;
    setFontSize = setFontSizeMock;
    setTextColor = setTextColorMock;
    text = textMock;
    getNumberOfPages = getNumberOfPagesMock;
  },
}));

// jsdom, Blob içeriğini okumayı (text()/arrayBuffer() senkron değildir) kolay
// hale getirmiyor — bu yüzden global Blob'u, oluşturulduğu parçaları (CSV
// string'i dahil) senkron olarak yakalayan sahte bir sınıfla değiştiriyoruz.
let capturedBlobParts: unknown[] = [];
let capturedBlobOptions: BlobPropertyBag | undefined;

class MockBlob {
  constructor(parts: unknown[], options?: BlobPropertyBag) {
    capturedBlobParts = parts;
    capturedBlobOptions = options;
  }
}

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1', title: 'Basit Talimat', description: 'Açıklama', creatorId: 'creator-1', assigneeId: 'assignee-1',
  status: 'IN_PROGRESS', priority: 'Medium', deadline: new Date('2026-02-01').getTime(),
  createdAt: new Date('2026-01-01').getTime(), updatedAt: Date.now(), totalPausedTime: 0, lockVersion: 0, tags: [],
  ...overrides,
} as Task);

const makeUser = (overrides: Partial<User> = {}): User => ({
  uid: 'assignee-1', fullName: 'Ali Yılmaz', email: 'ali@makam.com', role: 'Staff',
  ...overrides,
});

describe('exportTasksToCSV', () => {
  beforeEach(() => {
    capturedBlobParts = [];
    capturedBlobOptions = undefined;
    vi.stubGlobal('Blob', MockBlob);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() });
    // jsdom blob: linklerine gerçek gezinmeyi desteklemiyor ("Not implemented"
    // konsol gürültüsü üretir) — indirme tetikleyicisini sessizce yut.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const csvOf = (tasks: Task[], users: User[] = [], filter = {}) => {
    exportTasksToCSV(tasks, users, filter);
    return String(capturedBlobParts[0]);
  };

  it('başlık satırı Türkçe sütun adlarını içerir', () => {
    const csv = csvOf([]);
    const headerLine = csv.split('\n')[0]!.replace(/^﻿/, '');
    expect(headerLine).toBe('ID,Başlık,Açıklama,Durum,Öncelik,Sorumlu,Oluşturan,Oluşturulma,Bitiş,Alt Görev');
  });

  it('boş görev listesi çökmeden yalnızca başlık satırını üretir', () => {
    const csv = csvOf([]);
    expect(csv.split('\n')).toHaveLength(1);
  });

  it('durum ve öncelik STATUS_LABELS/PRIORITY_LABELS ile Türkçeleştirilir', () => {
    const task = makeTask({ status: 'BLOCKED', priority: 'Urgent' });
    const csv = csvOf([task]);
    expect(csv).toContain(STATUS_LABELS.BLOCKED);
    expect(csv).toContain(PRIORITY_LABELS.Urgent);
  });

  it('sorumlu ve oluşturan adları users listesinden (uid eşleşmesiyle) çözülür', () => {
    const task = makeTask({ assigneeId: 'assignee-1', creatorId: 'creator-1' });
    const users = [makeUser({ uid: 'assignee-1', fullName: 'Sorumlu Kişi' }), makeUser({ uid: 'creator-1', fullName: 'Oluşturan Kişi' })];
    const csv = csvOf([task], users);
    expect(csv).toContain('Sorumlu Kişi');
    expect(csv).toContain('Oluşturan Kişi');
  });

  it('eşleşen kullanıcı bulunamazsa userId\'nin ilk 8 karakteri + "..." kullanılır', () => {
    const task = makeTask({ assigneeId: 'unknown-user-id-123' });
    const csv = csvOf([task], []);
    expect(csv).toContain('unknown-...');
  });

  it('başlık/açıklama içindeki çift tırnaklar CSV kaçışıyla (") ikiye katlanır', () => {
    const task = makeTask({ title: 'Başlık "alıntı" içeriyor' });
    const csv = csvOf([task]);
    expect(csv).toContain('"Başlık ""alıntı"" içeriyor"');
  });

  it('alt görev (parentId dolu) için "Evet", kök görev için "Hayır" yazılır', () => {
    const sub = makeTask({ id: 'sub-1', parentId: 'task-1' });
    const root = makeTask({ id: 'task-1' });
    const csv = csvOf([sub, root]);
    const lines = csv.split('\n');
    expect(lines.find(l => l.startsWith('sub-1'))).toContain(',Evet');
    expect(lines.find(l => l.startsWith('task-1'))).toContain(',Hayır');
  });

  it('filter.from tarihinden önce oluşturulan görevler dışlanır', () => {
    const early = makeTask({ id: 'early', createdAt: new Date('2025-01-01').getTime() });
    const late = makeTask({ id: 'late', createdAt: new Date('2026-06-01').getTime() });
    const csv = csvOf([early, late], [], { from: new Date('2026-01-01') });
    expect(csv).not.toContain('early');
    expect(csv).toContain('late');
  });

  it('filter.to tarihinden sonra oluşturulan görevler dışlanır', () => {
    const early = makeTask({ id: 'early', createdAt: new Date('2025-01-01').getTime() });
    const late = makeTask({ id: 'late', createdAt: new Date('2026-06-01').getTime() });
    const csv = csvOf([early, late], [], { to: new Date('2026-01-01') });
    expect(csv).toContain('early');
    expect(csv).not.toContain('late');
  });

  it('filter boş obje ise hiçbir görev elenmez', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    const csv = csvOf(tasks, [], {});
    expect(csv).toContain('a');
    expect(csv).toContain('b');
  });

  it('Blob UTF-8 BOM öneki ile ve doğru MIME tipiyle oluşturulur', () => {
    exportTasksToCSV([makeTask()], []);
    expect(String(capturedBlobParts[0])).toMatch(/^﻿/);
    expect(capturedBlobOptions).toMatchObject({ type: 'text/csv;charset=utf-8;' });
  });

  it('indirme linki doğru dosya adı desenini (makam-rapor-YYYY-MM-DD.csv) alır', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    exportTasksToCSV([makeTask()], []);
    const link = appendSpy.mock.calls[0]![0] as HTMLAnchorElement;
    expect(link.download).toMatch(/^makam-rapor-\d{4}-\d{2}-\d{2}\.csv$/);
    appendSpy.mockRestore();
  });

  it('URL.createObjectURL ve revokeObjectURL çağrılır (bellek sızıntısı önlenir)', () => {
    exportTasksToCSV([makeTask()], []);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});

describe('exportTasksToPDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNumberOfPagesMock.mockReturnValue(1);
    htmlMock.mockImplementation((_container: HTMLElement, options: { callback: () => void }) => {
      options.callback();
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getRenderedContainer = (): HTMLElement => htmlMock.mock.calls[0]![0] as HTMLElement;

  it('jsPDF landscape/mm/a4 seçenekleriyle oluşturulur', async () => {
    await exportTasksToPDF([makeTask()], []);
    expect(ctorSpy).toHaveBeenCalledWith({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  });

  it('gizli host render sırasında document.body\'e eklenir, işlem bitince kaldırılır', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    await exportTasksToPDF([makeTask()], []);

    expect(appendSpy).toHaveBeenCalledOnce();
    const hiddenHost = appendSpy.mock.calls[0]![0] as HTMLElement;
    expect(removeSpy).toHaveBeenCalledWith(hiddenHost);
  });

  it('render edilen içerik görev başlığını, Türkçe durum/öncelik etiketini ve sorumlu adını içerir', async () => {
    const task = makeTask({ title: 'Özel Talimat', status: 'BLOCKED', priority: 'Urgent', assigneeId: 'assignee-1' });
    const users = [makeUser({ uid: 'assignee-1', fullName: 'Sorumlu Kişi' })];

    await exportTasksToPDF([task], users);

    const html = getRenderedContainer().innerHTML;
    expect(html).toContain('Özel Talimat');
    expect(html).toContain(STATUS_LABELS.BLOCKED);
    expect(html).toContain(PRIORITY_LABELS.Urgent);
    expect(html).toContain('Sorumlu Kişi');
  });

  it('60 karakterden uzun başlıklar 57 karaktere kırpılıp "..." eklenir', async () => {
    const longTitle = 'A'.repeat(80);
    await exportTasksToPDF([makeTask({ title: longTitle })], []);

    const html = getRenderedContainer().innerHTML;
    expect(html).toContain('A'.repeat(57) + '...');
    expect(html).not.toContain('A'.repeat(58));
  });

  it('60 karakter veya daha kısa başlıklar kırpılmadan olduğu gibi yazılır', async () => {
    const shortTitle = 'A'.repeat(60);
    await exportTasksToPDF([makeTask({ title: shortTitle })], []);

    const html = getRenderedContainer().innerHTML;
    expect(html).toContain(shortTitle);
  });

  it('filter.from/filter.to CSV\'deki gibi görevleri render edilecek listeden eler', async () => {
    const early = makeTask({ id: 'early', title: 'Erken Görev', createdAt: new Date('2025-01-01').getTime() });
    const late = makeTask({ id: 'late', title: 'Geç Görev', createdAt: new Date('2026-06-01').getTime() });

    await exportTasksToPDF([early, late], [], { from: new Date('2026-01-01') });

    const html = getRenderedContainer().innerHTML;
    expect(html).not.toContain('Erken Görev');
    expect(html).toContain('Geç Görev');
  });

  it('sayfa altbilgisi her sayfa için "Sayfa i / N" formatında, helvetica fontuyla yazılır', async () => {
    getNumberOfPagesMock.mockReturnValue(3);

    await exportTasksToPDF([makeTask()], []);

    expect(setPageMock).toHaveBeenNthCalledWith(1, 1);
    expect(setPageMock).toHaveBeenNthCalledWith(2, 2);
    expect(setPageMock).toHaveBeenNthCalledWith(3, 3);
    expect(setFontMock).toHaveBeenCalledWith('helvetica', 'normal');
    expect(textMock).toHaveBeenNthCalledWith(1, expect.stringContaining('Sayfa 1 / 3'), expect.anything(), expect.anything(), expect.anything());
    expect(textMock).toHaveBeenNthCalledWith(3, expect.stringContaining('Sayfa 3 / 3'), expect.anything(), expect.anything(), expect.anything());
  });

  it('doc.save dosya adı deseni (makam-rapor-YYYY-MM-DD-HHmm.pdf) ile çağrılır', async () => {
    await exportTasksToPDF([makeTask()], []);
    expect(saveMock).toHaveBeenCalledWith(expect.stringMatching(/^makam-rapor-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/));
  });

  it('doc.html() reddederse hata dışa fırlatılır, ama gizli host yine de (finally ile) DOM\'dan kaldırılır', async () => {
    const renderError = new Error('html2canvas-render-error');
    htmlMock.mockImplementationOnce(() => Promise.reject(renderError));
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    await expect(exportTasksToPDF([makeTask()], [])).rejects.toThrow('html2canvas-render-error');

    expect(removeSpy).toHaveBeenCalledOnce();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('boş görev listesi çökmeden render edilir (tabloya satır eklenmez)', async () => {
    await expect(exportTasksToPDF([], [])).resolves.toBeUndefined();
    expect(getRenderedContainer().querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
