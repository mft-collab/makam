import { describe, it, expect, beforeEach } from 'vitest';
import { calculateDeadline, getRemainingTime, getSLAConfigForPriority, DEFAULT_SLA_CONFIG } from '../lib/sla';

// Sabitleme: Pazartesi 09:00 sabahı (iş günü başı)
const MONDAY_9AM = new Date('2024-01-08T09:00:00').getTime();
// Cuma 17:00
const FRIDAY_5PM = new Date('2024-01-12T17:00:00').getTime();
// Cuma 20:00 (mesai dışı)
const FRIDAY_AFTER_WORK = new Date('2024-01-12T20:00:00').getTime();
// Cumartesi 10:00
const SATURDAY_10AM = new Date('2024-01-13T10:00:00').getTime();

describe('SLA Hesaplama Motoru', () => {
  
  // ─── calculateDeadline ─────────────────────────────────────────────────────

  describe('calculateDeadline — gün bazlı', () => {
    it('Pazartesi 09:00 başlayarak 1 iş günü = Salı 09:00', () => {
      const result = calculateDeadline(new Date(MONDAY_9AM), { value: 1, unit: 'days' });
      const date = new Date(result);
      expect(date.getDay()).toBe(2); // Salı
      expect(date.getHours()).toBe(9);
    });

    it('Cuma 17:00 başlayarak 1 iş günü = Pazartesi 17:00 (hafta sonu atlanır)', () => {
      const result = calculateDeadline(new Date(FRIDAY_5PM), { value: 1, unit: 'days' });
      const date = new Date(result);
      expect(date.getDay()).toBe(1); // Pazartesi
    });

    it('Cumartesi başlayarak 1 iş günü = Salı 09:00 (Pazar+Pazartesi iş günü)', () => {
      const result = calculateDeadline(new Date(SATURDAY_10AM), { value: 1, unit: 'days' });
      const date = new Date(result);
      // Cumartesi → Pazartesi 09:00'a çekilir → +1 iş günü = Salı
      expect(date.getDay()).toBe(2); // Salı
    });

    it('Geriye dönük uyumluluk: sayı geçilirse iş günü olarak hesaplanır', () => {
      const result = calculateDeadline(new Date(MONDAY_9AM), 2);
      const date = new Date(result);
      expect(date.getDay()).toBe(3); // Çarşamba
    });

    it('5 iş günü — hafta sonu içeren: Pazartesi → Pazartesi', () => {
      const result = calculateDeadline(new Date(MONDAY_9AM), { value: 5, unit: 'days' });
      const date = new Date(result);
      expect(date.getDay()).toBe(1); // Ertesi Pazartesi
    });
  });

  describe('calculateDeadline — saat bazlı (Urgent)', () => {
    it('Pazartesi 09:00 + 4 iş saati = Pazartesi 13:00', () => {
      const result = calculateDeadline(new Date(MONDAY_9AM), { value: 4, unit: 'hours' });
      const date = new Date(result);
      expect(date.getDay()).toBe(1); // Pazartesi
      expect(date.getHours()).toBe(13);
      expect(date.getMinutes()).toBe(0);
    });

    it('Pazartesi 16:00 + 4 iş saati = Salı 11:00 (mesai bitimini taşar)', () => {
      const startDate = new Date('2024-01-08T16:00:00');
      const result = calculateDeadline(startDate, { value: 4, unit: 'hours' });
      const date = new Date(result);
      expect(date.getDay()).toBe(2); // Salı
      expect(date.getHours()).toBe(11);
    });

    it('Cuma 17:00 + 4 iş saati = Pazartesi 12:00 (hafta sonu atlanır)', () => {
      const startDate = new Date(FRIDAY_5PM);
      const result = calculateDeadline(startDate, { value: 4, unit: 'hours' });
      const date = new Date(result);
      // Cuma 17:00 → 18:00'a (mesai bitişi) kadar 1 saat + Pazartesi 09:00'dan 3 saat = 12:00
      expect(date.getDay()).toBe(1); // Pazartesi
      expect(date.getHours()).toBe(12);
    });

    it('Mesai dışı başlangıç (20:00) → ertesi gün 09:00\'a çekilip hesaplanır', () => {
      const result = calculateDeadline(new Date(FRIDAY_AFTER_WORK), { value: 2, unit: 'hours' });
      const date = new Date(result);
      // Cuma 20:00 → Pazartesi 09:00'a çekilir → +2 saat = Pazartesi 11:00
      expect(date.getDay()).toBe(1); // Pazartesi
      expect(date.getHours()).toBe(11);
    });
  });

  // ─── getRemainingTime ───────────────────────────────────────────────────────

  describe('getRemainingTime', () => {
    it('deadline gelecekte ve 24 saatten uzaksa: normal', () => {
      const deadline = Date.now() + 48 * 60 * 60 * 1000; // 2 gün sonra
      const result = getRemainingTime(deadline);
      expect(result.status).toBe('normal');
      expect(result.timeLeftMs).toBeGreaterThan(0);
    });

    it('deadline 12 saat kaldıysa: near-breach', () => {
      const deadline = Date.now() + 12 * 60 * 60 * 1000;
      const result = getRemainingTime(deadline);
      expect(result.status).toBe('near-breach');
    });

    it('deadline geçtiyse: breached', () => {
      const deadline = Date.now() - 1000; // 1 saniye önce
      const result = getRemainingTime(deadline);
      expect(result.status).toBe('breached');
      expect(result.timeLeftMs).toBeLessThan(0);
    });

    it('pausedAt varsa: paused durumu ve o andaki kalan süre', () => {
      const deadline = Date.now() + 48 * 60 * 60 * 1000;
      const pausedAt = Date.now() - 5000; // 5 saniye önce duraklatıldı
      const result = getRemainingTime(deadline, 0, pausedAt);
      expect(result.status).toBe('paused');
    });

    it('totalPausedTime hesaba katılır', () => {
      const baseDeadline = Date.now() - 1000; // Normal bakışta geçmiş
      const pausedTime = 2 * 60 * 60 * 1000; // 2 saat duraklatıldı
      const result = getRemainingTime(baseDeadline, pausedTime);
      // effectiveDeadline = baseDeadline + pausedTime → gelecekte
      expect(result.status).toBe('near-breach'); // 2 saati aşmıyor ama geçmiyor
      expect(result.timeLeftMs).toBeGreaterThan(0);
    });
  });

  // ─── getSLAConfigForPriority ────────────────────────────────────────────────

  describe('getSLAConfigForPriority', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('localStorage boşken default config döner', () => {
      const config = getSLAConfigForPriority('Urgent');
      expect(config).toEqual(DEFAULT_SLA_CONFIG['Urgent']);
    });

    it('localStorage\'dan yeni format okunur', () => {
      const custom = { Urgent: { value: 2, unit: 'hours' } };
      localStorage.setItem('makam_sla_config', JSON.stringify(custom));
      const config = getSLAConfigForPriority('Urgent');
      expect(config.value).toBe(2);
      expect(config.unit).toBe('hours');
    });

    it('localStorage\'dan eski format (sayı) okunur — geriye dönük uyumluluk', () => {
      const legacyFormat = { Low: 10, Medium: 3, High: 1, Urgent: 0.5 };
      localStorage.setItem('makam_sla_config', JSON.stringify(legacyFormat));
      const config = getSLAConfigForPriority('Low');
      expect(config.value).toBe(10);
      expect(config.unit).toBe('days');
    });

    it('localStorage bozuksa default\'a düşer', () => {
      localStorage.setItem('makam_sla_config', '{ invalid json }}}');
      const config = getSLAConfigForPriority('High');
      expect(config).toEqual(DEFAULT_SLA_CONFIG['High']);
    });
  });

  describe('calculateDeadline — resmi tatil atlama (Türkiye 2026)', () => {
    it('2025-12-31 Çarşamba 17:00 + 1 iş günü = 2026-01-02 Cuma 17:00 (Yılbaşı tatili atlanır)', () => {
      const start = new Date('2025-12-31T17:00:00');
      const result = calculateDeadline(start, { value: 1, unit: 'days' });
      const date = new Date(result);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(0); // Ocak (0)
      expect(date.getDate()).toBe(2);  // 2 Ocak Cuma
      expect(date.getHours()).toBe(17);
    });

    it('2026-04-22 Çarşamba 16:00 + 4 iş saati = 2026-04-24 Cuma 11:00 (23 Nisan tatili atlanır)', () => {
      const start = new Date('2026-04-22T16:00:00');
      const result = calculateDeadline(start, { value: 4, unit: 'hours' });
      const date = new Date(result);
      // Çarşamba 16:00 -> 18:00 (2 saat)
      // Perşembe (23 Nisan) -> Komple tatil (atlanır)
      // Cuma 09:00 -> 11:00 (2 saat) -> Toplam 4 saat
      expect(date.getDate()).toBe(24); // 24 Nisan Cuma
      expect(date.getHours()).toBe(11);
    });
  });
});
