/**
 * PDF ve CSV Dışa Aktarma Servisi
 * jsPDF + html2canvas (jsPDF'in dahili .html() API'si) kullanır — ücretsiz, client-side
 */
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Task, User } from '../types';
import { STATUS_LABELS, PRIORITY_LABELS } from '../constants';

interface ExportFilter {
  from?: Date;
  to?: Date;
}

function getFilteredTasks(tasks: Task[], filter: ExportFilter): Task[] {
  return tasks.filter(t => {
    if (filter.from && t.createdAt < filter.from.getTime()) return false;
    if (filter.to && t.createdAt > filter.to.getTime()) return false;
    return true;
  });
}

function getUserName(userId: string, users: User[]): string {
  const user = users.find(u => u.uid === userId || u.email === userId);
  return user?.fullName ?? userId.slice(0, 8) + '...';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Marka paleti (bkz. src/index.css — Midnight Slate & Satin Gold)
const OBSIDIAN = '#161513';
const SATIN_GOLD = '#C5A059';
const STATUS_HEX: Record<Task['status'], string> = {
  ASSIGNED: '#64748B',
  PENDING_DELEGATION: '#B48F46',
  IN_PROGRESS: OBSIDIAN,
  BLOCKED: '#DC2626',
  AWAITING_APPROVAL: '#B45309',
  COMPLETED: '#047857',
  CANCELLED: '#94A3B8',
  CRISIS: '#DC2626',
};

/**
 * Görevleri PDF olarak dışa aktar.
 *
 * NOT: jsPDF'in yerleşik özel-font gömme/subsetting mekanizması (addFont +
 * otomatik glyph subset), üretilen font'un cmap/maxp tablolarını tutarsız
 * bırakan bilinen, çözülmemiş bir hataya sahiptir (bkz. jsPDF #3850) — bu da
 * "İ", "ş", "ğ" gibi Türkçe'ye özgü harflerin PDF çıktısında bozuk/eksik
 * görünmesine yol açıyordu. Bunu tamamen atlatmak için rapor içeriği gerçek
 * bir DOM/CSS parçası olarak oluşturulup jsPDF'in `.html()` API'siyle
 * (html2canvas üzerinden, taşıyıcı zaten bir bağımlılık) render ediliyor —
 * metin tarayıcının kendi font motoruyla çizildiği için Türkçe karakterler
 * garanti doğru çıkar. Yalnızca sayfa altbilgisi (yalnızca Latin-1 kapsamında
 * "ö" içerir) jsPDF'in yerleşik "helvetica" fontuyla çiziliyor.
 */
export async function exportTasksToPDF(
  tasks: Task[],
  users: User[],
  filter: ExportFilter = {}
): Promise<void> {
  const filtered = getFilteredTasks(tasks, filter);
  const now = new Date();

  const completed = filtered.filter(t => t.status === 'COMPLETED').length;
  const inProgress = filtered.filter(t => t.status === 'IN_PROGRESS').length;
  const blocked = filtered.filter(t => t.status === 'BLOCKED').length;

  const summaryChips: Array<{ label: string; value: number; color: string }> = [
    { label: 'TOPLAM TALİMAT', value: filtered.length, color: OBSIDIAN },
    { label: 'TAMAMLANAN', value: completed, color: STATUS_HEX.COMPLETED },
    { label: 'İŞLEMDEKİ', value: inProgress, color: STATUS_HEX.IN_PROGRESS },
    { label: 'ENGELLİ', value: blocked, color: STATUS_HEX.BLOCKED },
  ];

  const rangeLabel = (filter.from || filter.to)
    ? `Aralık: ${filter.from ? format(filter.from, 'd MMM yyyy', { locale: tr }) : '—'} — ${filter.to ? format(filter.to, 'd MMM yyyy', { locale: tr }) : '—'}`
    : '';

  const rowsHtml = filtered.map((task, idx) => {
    const title = task.title.length > 60 ? task.title.slice(0, 57) + '...' : task.title;
    return `
      <tr style="background:${idx % 2 === 1 ? '#F9F8F6' : '#FFFFFF'};">
        <td style="padding:7px 8px;color:#96938A;text-align:center;font-variant-numeric:tabular-nums;">${idx + 1}</td>
        <td style="padding:7px 8px;color:#2C2B29;font-weight:500;">${escapeHtml(title)}</td>
        <td style="padding:7px 8px;color:${STATUS_HEX[task.status] ?? '#2C2B29'};font-weight:600;">${escapeHtml(STATUS_LABELS[task.status] ?? task.status)}</td>
        <td style="padding:7px 8px;color:#2C2B29;">${escapeHtml(PRIORITY_LABELS[task.priority] ?? task.priority)}</td>
        <td style="padding:7px 8px;color:#2C2B29;">${escapeHtml(getUserName(task.assigneeId, users))}</td>
        <td style="padding:7px 8px;color:#57544E;font-variant-numeric:tabular-nums;">${format(task.createdAt, 'd MMM yyyy', { locale: tr })}</td>
        <td style="padding:7px 8px;color:#57544E;font-variant-numeric:tabular-nums;">${format(task.deadline, 'd MMM yyyy', { locale: tr })}</td>
        <td style="padding:7px 8px;color:#2C2B29;text-align:center;">${task.parentId ? 'Evet' : 'Hayır'}</td>
      </tr>`;
  }).join('');

  const reportHtml = `
    <div style="width:1360px;font-family:'Inter',sans-serif;background:#FFFFFF;color:#2C2B29;">
      <div style="background:${OBSIDIAN};border-bottom:3px solid ${SATIN_GOLD};padding:22px 28px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="color:${SATIN_GOLD};font-size:26px;font-weight:700;letter-spacing:0.04em;">MAKAM</div>
          <div style="color:#FFFFFF;font-size:13px;margin-top:4px;">Stratejik Yönetim Dizgesi &mdash; Talimat Raporu</div>
          <div style="color:#B8B6B0;font-size:11px;margin-top:2px;">Oluşturma: ${format(now, 'd MMMM yyyy HH:mm', { locale: tr })}</div>
        </div>
        ${rangeLabel ? `<div style="color:#FFFFFF;font-size:11px;">${rangeLabel}</div>` : ''}
      </div>

      <div style="display:flex;gap:12px;padding:20px 28px 4px;">
        ${summaryChips.map(chip => `
          <div style="display:flex;align-items:baseline;gap:8px;padding:9px 16px;border-radius:10px;background:${chip.color}14;">
            <span style="font-size:20px;font-weight:700;color:${chip.color};font-variant-numeric:tabular-nums;">${chip.value}</span>
            <span style="font-size:10px;font-weight:600;letter-spacing:0.12em;color:#726F68;text-transform:uppercase;">${chip.label}</span>
          </div>
        `).join('')}
      </div>

      <div style="padding:16px 28px 28px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:${OBSIDIAN};">
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:center;">#</th>
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:left;">Başlık</th>
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:left;">Durum</th>
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:left;">Öncelik</th>
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:left;">Sorumlu</th>
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:left;">Oluşturulma</th>
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:left;">Bitiş</th>
              <th style="padding:9px 8px;color:${SATIN_GOLD};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;text-align:center;">Alt Görev</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  // NOT: jsPDF'in .html() API'si verilen kaynağı kendi içinde cloneNode ile
  // kopyalayıp kendi -100000px'lik ekran-dışı sarmalayıcısına yerleştirir
  // (html2pdf.js ile aynı, kanıtlanmış yöntem). cloneNode inline style'ları
  // da kopyaladığından, kaynağa `position: fixed` verilirse KLON da bu
  // sarmalayıcının normal akışından kaçıp kendi `left` değerine göre
  // (gerçek sayfa üzerinde) konumlanıyor — bu da jsPDF'in kırptığı alanın
  // boş çıkmasına yol açan asıl sebepti. Çözüm: `container`'a hiçbir
  // konumlandırma stili vermemek (klon jsPDF'in sarmalayıcısı içinde normal
  // akışta kalsın), ekrana yansımasını önlemek için de onu ayrı, konumlu bir
  // `hiddenHost`un içine koymak — cloneNode yalnızca `container`ı kopyaladığı
  // için `hiddenHost`un stilleri klona hiç taşınmıyor.
  const hiddenHost = document.createElement('div');
  hiddenHost.style.position = 'fixed';
  hiddenHost.style.top = '0';
  hiddenHost.style.left = '-99999px';
  document.body.appendChild(hiddenHost);

  const container = document.createElement('div');
  container.innerHTML = reportHtml;
  hiddenHost.appendChild(container);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // jsPDF'in .html() API'si html2canvas'a `scale: width/windowWidth` (burada
  // 277/1360 ≈ 0,2) hesaplayıp iletiyor ki üretilen görüntü tam 277mm'e
  // otursun. Bu oranı ezip sabit bir `scale` versek (ör. yalnızca 2), oturma
  // hesabı bozulup içerik ~10 kat büyük ve sayfalara bölünmüş çıkıyordu; hiç
  // `scale` vermezsek de görüntü ~25 DPI gibi çok düşük çözünürlükte üretilip
  // Türkçe'ye özgü harfler (İ, Ş, Ğ) okunaksız çıkıyordu. Çözüm: aynı oranı
  // korurken bir "kalite çarpanı" ile ölçekliyoruz.
  const PDF_WIDTH_MM = 277;
  const WINDOW_WIDTH_PX = 1360;
  const RASTER_QUALITY_MULTIPLIER = 2;

  try {
    await new Promise<void>((resolve, reject) => {
      doc.html(container, {
        x: 10,
        y: 10,
        width: PDF_WIDTH_MM,
        windowWidth: WINDOW_WIDTH_PX,
        autoPaging: 'text',
        html2canvas: {
          scale: (PDF_WIDTH_MM / WINDOW_WIDTH_PX) * RASTER_QUALITY_MULTIPLIER,
          backgroundColor: '#FFFFFF',
        },
        callback: () => resolve(),
      }).catch(reject);
    });
  } finally {
    document.body.removeChild(hiddenHost);
  }

  // Sayfa altbilgisi — yerleşik helvetica yeterlidir (yalnızca Latin-1
  // kapsamındaki "ö" harfini içerir).
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 147, 138);
    doc.text(
      `MAKAM Stratejik Yönetim — Gizli — Sayfa ${i} / ${pageCount}`,
      297 / 2,
      doc.internal.pageSize.getHeight() - 5,
      { align: 'center' }
    );
  }

  const filename = `makam-rapor-${format(now, 'yyyy-MM-dd-HHmm')}.pdf`;
  doc.save(filename);
}

/**
 * Görevleri CSV olarak dışa aktar
 */
export function exportTasksToCSV(
  tasks: Task[],
  users: User[],
  filter: ExportFilter = {}
): void {
  const filtered = getFilteredTasks(tasks, filter);

  const headers = ['ID', 'Başlık', 'Açıklama', 'Durum', 'Öncelik', 'Sorumlu', 'Oluşturan', 'Oluşturulma', 'Bitiş', 'Alt Görev'];

  const rows = filtered.map(task => [
    task.id,
    `"${task.title.replace(/"/g, '""')}"`,
    `"${(task.description ?? '').replace(/"/g, '""')}"`,
    STATUS_LABELS[task.status] ?? task.status,
    PRIORITY_LABELS[task.priority] ?? task.priority,
    getUserName(task.assigneeId, users),
    getUserName(task.creatorId, users),
    format(task.createdAt, 'yyyy-MM-dd HH:mm'),
    format(task.deadline, 'yyyy-MM-dd'),
    task.parentId ? 'Evet' : 'Hayır',
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `makam-rapor-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
