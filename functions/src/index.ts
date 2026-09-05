/**
 * MAKAM Firebase Cloud Functions — Ana Giriş Noktası
 * 
 * Tüm fonksiyon modülleri buradan export edilir.
 * Deploy: firebase deploy --only functions
 */

export { scheduledDailyAudit } from './scheduledAudit';
export { onTaskCreated, onTaskStatusChanged } from './taskTriggers';
export { cleanupOldNotifications } from './cleanup';
export { scheduledStatsReconciliation } from './statsReconciliation';
// Tek seferlik taşıma (P0-1/P0-2). Çalıştırma sırası kritiktir —
// bkz. functions/BACKFILL_RUNBOOK.md.
export { backfillDepartments } from './backfillDepartments';
