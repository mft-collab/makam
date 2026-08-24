import { addDays, isWeekend, format } from 'date-fns';
import type { Task } from '../types';
import { logger } from './logger';

export interface SLAConfigEntry {
  value: number;
  unit: 'days' | 'hours';
}

export const DEFAULT_SLA_CONFIG: Record<'Low' | 'Medium' | 'High' | 'Urgent', SLAConfigEntry> = {
  Low: { value: 15, unit: 'days' },
  Medium: { value: 5, unit: 'days' },
  High: { value: 2, unit: 'days' },
  Urgent: { value: 4, unit: 'hours' }, // 4 mesai saati mühlet!
};

// Kurumsal Mesai Tanımları: 09:00 - 18:00 (9 saatlik çalışma periyodu)
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

// Türkiye Resmi Tatilleri (2026 yılı için)
const OFFICIAL_HOLIDAYS_2026 = [
  '2026-01-01', // Yılbaşı
  '2026-04-23', // Ulusal Egemenlik ve Çocuk Bayramı
  '2026-05-01', // Emek ve Dayanışma Günü
  '2026-05-19', // Atatürk'ü Anma, Gençlik ve Spor Bayramı
  '2026-07-15', // Demokrasi ve Milli Birlik Günü
  '2026-08-30', // Zafer Bayramı
  '2026-10-29', // Cumhuriyet Bayramı
  
  // Dini Bayramlar 2026 (Tahmini Hicri-Miladi Takvim)
  // Ramazan Bayramı 2026
  '2026-03-19', // Arife
  '2026-03-20', // 1. Gün
  '2026-03-21', // 2. Gün
  '2026-03-22', // 3. Gün
  
  // Kurban Bayramı 2026
  '2026-05-26', // Arife
  '2026-05-27', // 1. Gün
  '2026-05-28', // 2. Gün
  '2026-05-29', // 3. Gün
  '2026-05-30', // 4. Gün
];

export function isWeekendOrHoliday(date: Date): boolean {
  if (isWeekend(date)) return true;
  // Yerel (TR) güne göre biçimlendirilir — date.toISOString() UTC kullanır ve
  // TR saatiyle (UTC+3) 00:00-02:59 arasındaki bir zaman damgası UTC'de bir
  // önceki güne düşer; bu durumda resmi tatil günleri yanlış sınıflanabilirdi
  // (bkz. kod denetimi). Hafta sonu kontrolü (isWeekend) zaten yerel saati
  // kullandığından, tatil karşılaştırması da aynı zaman dilimiyle yapılmalı.
  const dateStr = format(date, 'yyyy-MM-dd');
  return OFFICIAL_HOLIDAYS_2026.includes(dateStr);
}

/**
 * Belirtilen tarihe hassas mesai saati ekler. Mesai dışı, hafta sonlarını ve resmi tatilleri atlar.
 */
function addBusinessHours(startDate: Date, hours: number): Date {
  let currentDate = new Date(startDate.getTime());
  
  // 1. Başlangıç zamanı mesai dışı, hafta sonu veya tatil ise ilk mesai saatine ayarla
  currentDate = adjustToWorkingHours(currentDate);

  let minutesToAdd = hours * 60;

  while (minutesToAdd > 0) {
    // Bugünün mesai bitim zamanını bul
    const mesaiEndToday = new Date(currentDate.getTime());
    mesaiEndToday.setHours(WORK_END_HOUR, 0, 0, 0);
    
    // Bugünün kalan mesai süresi (dakika)
    const minutesLeftToday = Math.max(0, (mesaiEndToday.getTime() - currentDate.getTime()) / 60000);
    
    if (minutesToAdd <= minutesLeftToday) {
      // Kalan süre bugünkü mesaiye sığıyor
      currentDate = new Date(currentDate.getTime() + minutesToAdd * 60000);
      minutesToAdd = 0;
    } else {
      // Bugünkü mesaiyi aşıyor, bugünü doldur ve yarın mesai başlangıcına devret
      minutesToAdd -= minutesLeftToday;
      currentDate = new Date(mesaiEndToday.getTime());
      
      // Yarın sabah 09:00'a devret
      currentDate = addDays(currentDate, 1);
      currentDate.setHours(WORK_START_HOUR, 0, 0, 0);
      
      // Hafta sonu ve resmi tatilleri atlamak ve mesaiye ayarlamak için düzenle
      currentDate = adjustToWorkingHours(currentDate);
    }
  }

  return currentDate;
}

/**
 * Belirtilen tarihe iş günü ekler. Hafta sonlarını ve resmi tatilleri es geçer.
 */
function addBusinessDays(startDate: Date, days: number): Date {
  let currentDate = new Date(startDate.getTime());
  
  // Mesai dışındaysa mesai başlangıcına çek
  currentDate = adjustToWorkingHours(currentDate);
  
  let daysAdded = 0;
  while (daysAdded < days) {
    currentDate = addDays(currentDate, 1);
    if (!isWeekendOrHoliday(currentDate)) {
      daysAdded++;
    }
  }
  
  return currentDate;
}

/**
 * Zamanı kurumsal çalışma saatlerine, hafta sonlarına ve resmi tatillere göre hizalar.
 */
function adjustToWorkingHours(date: Date): Date {
  let adjusted = new Date(date.getTime());
  
  // Hafta sonu veya tatil ise sonraki ilk iş günü 09:00'a çek
  while (isWeekendOrHoliday(adjusted)) {
    adjusted = addDays(adjusted, 1);
    adjusted.setHours(WORK_START_HOUR, 0, 0, 0);
  }
  
  const hour = adjusted.getHours();
  
  if (hour < WORK_START_HOUR) {
    adjusted.setHours(WORK_START_HOUR, 0, 0, 0);
  } else if (hour >= WORK_END_HOUR) {
    // Mesai bitiminden sonra ise ertesi iş günü 09:00'a devret
    adjusted = addDays(adjusted, 1);
    adjusted.setHours(WORK_START_HOUR, 0, 0, 0);
    return adjustToWorkingHours(adjusted);
  }
  
  return adjusted;
}

/**
 * SLA yapılandırmasına göre tam teslim mühletini hesaplar.
 */
export function calculateDeadline(startDate: Date, config: SLAConfigEntry | number): number {
  if (typeof config === 'number') {
    // Geriye dönük uyumluluk
    return addBusinessDays(startDate, config).getTime();
  }
  
  if (config.unit === 'hours') {
    return addBusinessHours(startDate, config.value).getTime();
  } else {
    return addBusinessDays(startDate, config.value).getTime();
  }
}

export function getRemainingTime(deadline: number, totalPausedTime: number = 0, pausedAt?: number | null, now: number = Date.now()): {
  timeLeftMs: number;
  status: 'normal' | 'near-breach' | 'breached' | 'paused';
} {
  const effectiveDeadline = deadline + totalPausedTime;
  
  if (pausedAt) {
    return { 
      timeLeftMs: effectiveDeadline - pausedAt, 
      status: 'paused' 
    };
  }

  const timeLeftMs = effectiveDeadline - now;
  
  if (timeLeftMs < 0) return { timeLeftMs, status: 'breached' };
  if (timeLeftMs < (24 * 60 * 60 * 1000)) return { timeLeftMs, status: 'near-breach' };
  
  return { timeLeftMs, status: 'normal' };
}

/**
 * Bir görevin efektif mühlet (deadline + totalPausedTime) içinde tamamlanıp
 * tamamlanmadığını belirler. "SLA'ya zamanında tamamlama" oranı hesaplayan
 * TÜM ekranlar (Dashboard, Reports, TeamList, executiveMetrics) TEK bu
 * fonksiyonu kullanmalı — aksi halde aynı görev seti için ekranlar arası
 * çelişkili yüzdeler üretilir (bkz. kod denetimi). totalPausedTime'ın dahil
 * edilmesi, getRemainingTime/effectiveMsToDeadline'daki "efektif mühlet"
 * kavramıyla tutarlıdır: bir görev meşru bir duraklama (BLOCKED/onay
 * bekleme) yüzünden ham mühleti aşmışsa ama duraklama-ayarlı mühlet
 * içinde tamamlanmışsa, zamanında sayılır.
 */
export function isCompletedOnTime(task: Pick<Task, 'status' | 'completedAt' | 'updatedAt' | 'deadline' | 'totalPausedTime'>): boolean {
  if (task.status !== 'COMPLETED') return false;
  const effectiveDeadline = task.deadline + (task.totalPausedTime || 0);
  const completionTime = task.completedAt ?? task.updatedAt;
  return completionTime <= effectiveDeadline;
}

/**
 * Dinamik SLA yapılandırmasını güvenli geri dönüşlerle okur.
 */
export function getSLAConfigForPriority(priority: 'Low' | 'Medium' | 'High' | 'Urgent'): SLAConfigEntry {
  try {
    const stored = localStorage.getItem('makam_sla_config');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed[priority] && typeof parsed[priority].value === 'number') {
        return parsed[priority] as SLAConfigEntry;
      }
      // Geriye dönük uyumluluk: eğer sadece sayı olarak saklanmışsa
      if (parsed && typeof parsed[priority] === 'number') {
        return { value: parsed[priority], unit: 'days' };
      }
    }
  } catch (e) {
    logger.error('Failed to parse SLA config from localstorage:', e);
  }
  return DEFAULT_SLA_CONFIG[priority];
}
