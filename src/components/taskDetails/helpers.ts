import type { Task, User as UserType, TaskStatus } from '../../types';
import { getRemainingTime } from '../../lib/sla';

/* ── Birincil Aksiyon ─────────────────────────────────────────────────────
   Mevcut duruma ve role göre tek bir birincil durum geçişi. Modal footer'ında
   tüm sekmelerde sabit gösterilir. */
export interface PrimaryAction {
  label: string;
  next: TaskStatus;
  variant: 'gold' | 'success';
  /** Tamamlama ile sonuçlanan geçiş — kanıt formu gösterilir (opsiyonel). */
  collectsEvidence: boolean;
  /** Terminal/geri dönüşü zor geçiş — yerinde onay (confirm-in-place) ister. */
  needsConfirm: boolean;
  /** Butonun ne yaptığını açıklayan kısa ipucu metni. */
  hint: string;
}

export const getPrimaryAction = (task: Task, currentUser: UserType | null): PrimaryAction | null => {
  const isAdmin = currentUser?.role === 'Admin';
  if (task.status === 'ASSIGNED') {
    return { label: 'SÜRECİ BAŞLAT', next: 'IN_PROGRESS', variant: 'gold', collectsEvidence: false, needsConfirm: false, hint: 'Talimatı icraya alır; mühlet sayacı bu andan itibaren işlemeye başlar.' };
  }
  if (task.status === 'PENDING_DELEGATION') {
    return { label: 'DEVRİ KABUL ET VE BAŞLAT', next: 'IN_PROGRESS', variant: 'gold', collectsEvidence: false, needsConfirm: false, hint: 'Devredilen talimatı üstlenir ve doğrudan icraya alır.' };
  }
  if (task.status === 'IN_PROGRESS' || task.status === 'CRISIS') {
    return isAdmin
      ? { label: 'KESİN TAMAMLA', next: 'COMPLETED', variant: 'success', collectsEvidence: true, needsConfirm: true, hint: 'Talimatı doğrudan tamamlanmış sayıp kapatır — onay süreci atlanır, geri alınamaz.' }
      : { label: 'TAMAMLA VE ONAYA SUN', next: 'AWAITING_APPROVAL', variant: 'success', collectsEvidence: true, needsConfirm: false, hint: 'İşi bitirdiğinizi bildirir ve Makam onayına sunar — talimat bu adımda henüz kapanmaz.' };
  }
  if (task.status === 'AWAITING_APPROVAL' && isAdmin) {
    return { label: 'TALİMATI ONAYLA VE KAPAT', next: 'COMPLETED', variant: 'gold', collectsEvidence: true, needsConfirm: true, hint: 'Onay bekleyen talimatı inceleyip kesin olarak kapatır — geri alınamaz.' };
  }
  return null;
};

// #4 - Canlı SLA hesaplama (totalPausedTime ve pausedAt dahil)
export interface TimeLeftResult {
  timeLeftMs: number;
  label: string;
  status: 'paused' | 'expired' | 'warning' | 'safe';
}

export const getTimeLeft = (task: Task, now: number): TimeLeftResult | null => {
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return null;

  // Çekirdek hesaplama (effectiveDeadline = deadline + totalPausedTime, pausedAt
  // varsa referans noktası o ana sabitlenir) src/lib/sla.ts'teki getRemainingTime'dan
  // gelir — burada AYRICA yeniden hesaplanmaz. Bu dosya yalnızca UI'a özgü etiket
  // metnini ve durum sözlüğünü (paused/expired/warning/safe) bunun üzerine bindirir.
  // Eskiden burası aynı mantığı bağımsız olarak yeniden yazıyordu — SLA
  // duraklama hesabında yapılacak bir düzeltme kolayca yalnızca birine
  // uygulanıp diğerini eskimiş bırakabiliyordu (bkz. kod denetimi).
  const { timeLeftMs, status: coreStatus } = getRemainingTime(
    task.deadline,
    task.totalPausedTime || 0,
    task.pausedAt ?? null,
    now
  );

  const absMs = Math.abs(timeLeftMs);
  const absDays = Math.floor(absMs / 86400000);
  const absHours = Math.floor((absMs % 86400000) / 3600000);
  const absMins = Math.floor((absMs % 3600000) / 60000);

  let label: string;
  if (timeLeftMs < 0) {
    label = absDays > 0 ? `${absDays}g ${absHours}s geçti` : absHours > 0 ? `${absHours}s ${absMins}dk geçti` : `${absMins}dk geçti`;
  } else if (absDays > 0) {
    label = `${absDays}g ${absHours}s kaldı`;
  } else if (absHours > 0) {
    label = `${absHours}s ${absMins}dk kaldı`;
  } else {
    label = `${absMins}dk kaldı`;
  }

  const isPaused = coreStatus === 'paused';
  return {
    timeLeftMs,
    label: isPaused ? `${label} (Duraklatıldı)` : label,
    status: isPaused ? 'paused' : timeLeftMs < 0 ? 'expired' : timeLeftMs < 86400000 ? 'warning' : 'safe'
  };
};

export const getSLAColor = (status: string): string => {
  switch (status) {
    case 'expired': return 'text-status-danger';
    case 'warning': return 'text-status-warning';
    case 'paused':  return 'text-text-muted';
    default: return 'text-status-success';
  }
};

export interface ChecklistStats {
  total: number;
  completed: number;
  percent: number;
}

export const computeChecklistStats = (checklist: Task['checklist']): ChecklistStats => {
  const list = checklist || [];
  if (list.length === 0) return { total: 0, completed: 0, percent: 0 };
  const completed = list.filter(item => item.isCompleted).length;
  return {
    total: list.length,
    completed,
    percent: Math.round((completed / list.length) * 100)
  };
};
