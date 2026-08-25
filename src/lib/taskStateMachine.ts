import type { TaskStatus } from '../types';

/**
 * Görev durum makinesi — firestore.rules'taki isValidTransition fonksiyonuyla
 * BİREBİR AYNI kurallar (Admin override hariç: rules'ta Admin her geçişi
 * bypass edebilir, ama uygulamadaki hiçbir gerçek akış buna ihtiyaç duymuyor —
 * bkz. taskDetails/helpers.ts getPrimaryAction). Bu, client tarafında ikinci
 * bir savunma hattıdır; ikisini değiştirirken diğerini de güncelleyin
 * (bkz. CLAUDE.md "Görev durum makinesi").
 *
 * COMPLETED ve CANCELLED terminal durumlardır: her ikisinin de listesi
 * kasıtlı olarak boş — CANCELLED, aşağıdaki her aktif durumun kendi
 * listesinde AYRI AYRI hedef olarak yer alıyor (evrensel bir kısayol değil).
 * Eskiden `isValidTaskTransition` içinde `to === 'CANCELLED'` için ayrı bir
 * kısayol vardı; bu, oldStatus'tan bağımsız çalıştığından COMPLETED bir
 * görevin bile CANCELLED'a çekilmesine izin veriyordu (bkz. kod denetimi).
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ASSIGNED: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED', 'PENDING_DELEGATION'],
  PENDING_DELEGATION: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'AWAITING_APPROVAL', 'COMPLETED', 'CANCELLED', 'CRISIS', 'PENDING_DELEGATION'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  AWAITING_APPROVAL: ['COMPLETED', 'IN_PROGRESS', 'CANCELLED'],
  CRISIS: ['IN_PROGRESS', 'CANCELLED', 'COMPLETED', 'AWAITING_APPROVAL'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
