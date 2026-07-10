/**
 * PDF ve CSV Dışa Aktarma Servisi
 * jsPDF + jspdf-autotable kullanır — ücretsiz, client-side
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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

/**
 * Görevleri PDF olarak dışa aktar
 */
export async function exportTasksToPDF(
  tasks: Task[],
  users: User[],
  filter: ExportFilter = {}
): Promise<void> {
  const filtered = getFilteredTasks(tasks, filter);
  const now = new Date();

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  // Üst bilgi
  doc.setFillColor(22, 21, 19); // #161513
  doc.rect(0, 0, 297, 22, 'F');

  doc.setTextColor(197, 160, 89); // #C5A059 — satin gold
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MAKAM', 14, 14);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Executive Management System — Talimat Raporu', 55, 10);
  doc.text(`Oluşturma: ${format(now, 'd MMMM yyyy HH:mm', { locale: tr })}`, 55, 16);

  if (filter.from || filter.to) {
    const range = `Aralık: ${filter.from ? format(filter.from, 'd MMM yyyy', { locale: tr }) : '—'} — ${filter.to ? format(filter.to, 'd MMM yyyy', { locale: tr }) : '—'}`;
    doc.text(range, 180, 13);
  }

  // Özet istatistikler
  doc.setTextColor(22, 21, 19);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  const completed = filtered.filter(t => t.status === 'COMPLETED').length;
  const inProgress = filtered.filter(t => t.status === 'IN_PROGRESS').length;
  const blocked = filtered.filter(t => t.status === 'BLOCKED').length;

  doc.text(`Toplam: ${filtered.length} talimat`, 14, 30);
  doc.text(`Tamamlanan: ${completed}`, 60, 30);
  doc.text(`İşlemdeki: ${inProgress}`, 100, 30);
  doc.text(`Engelli: ${blocked}`, 140, 30);

  // Tablo
  autoTable(doc, {
    startY: 36,
    head: [['#', 'Başlık', 'Durum', 'Öncelik', 'Sorumlu', 'Oluşturulma', 'Bitiş', 'Alt Görev']],
    body: filtered.map((task, idx) => [
      idx + 1,
      task.title.length > 45 ? task.title.slice(0, 42) + '...' : task.title,
      STATUS_LABELS[task.status] ?? task.status,
      PRIORITY_LABELS[task.priority] ?? task.priority,
      getUserName(task.assigneeId, users),
      format(task.createdAt, 'd MMM yyyy', { locale: tr }),
      format(task.deadline, 'd MMM yyyy', { locale: tr }),
      task.parentId ? 'Evet' : 'Hayır',
    ]),
    styles: {
      fontSize: 8,
      cellPadding: 3,
      font: 'helvetica',
    },
    headStyles: {
      fillColor: [22, 21, 19],
      textColor: [197, 160, 89],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: {
      fillColor: [248, 248, 247],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 70 },
      2: { cellWidth: 28 },
      3: { cellWidth: 20 },
      4: { cellWidth: 35 },
      5: { cellWidth: 24 },
      6: { cellWidth: 24 },
      7: { cellWidth: 16, halign: 'center' },
    },
  });

  // Alt bilgi
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `Makam Executive — Gizli — Sayfa ${i} / ${pageCount}`,
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
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `makam-rapor-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
