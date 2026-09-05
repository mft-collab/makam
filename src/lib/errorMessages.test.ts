import { describe, it, expect } from 'vitest';
import { humanizeError } from './errorMessages';

describe('humanizeError', () => {
  it('auth/unauthorized-domain için yapılandırma talimatı içeren bir mesaj döndürür', () => {
    const result = humanizeError({ code: 'auth/unauthorized-domain' });
    expect(result.title).toBe('Giriş Domaini Yetkisiz');
    expect(result.type).toBe('warning');
  });

  it('auth/popup-closed-by-user kullanıcıya tekrar deneme mesajı verir, ham SDK metnini sızdırmaz', () => {
    const result = humanizeError({ code: 'auth/popup-closed-by-user', message: 'Firebase: Error (auth/popup-closed-by-user).' });
    expect(result.body).not.toMatch(/Firebase:/);
    expect(result.title).toBe('Giriş İptal Edildi');
  });

  it('permission-denied Türkçe yetki mesajına çevrilir', () => {
    const result = humanizeError(new Error('permission-denied: Missing or insufficient permissions.'));
    expect(result.title).toBe('Yetkiniz Yok');
  });

  it('unavailable geçici bağlantı mesajı üretir', () => {
    const result = humanizeError({ code: 'unavailable' });
    expect(result.title).toBe('Dizgeye Şu An Ulaşılamıyor');
  });

  it('resource-exhausted kota mesajı üretir', () => {
    const result = humanizeError({ code: 'resource-exhausted' });
    expect(result.title).toBe('Sistem Kapasitesi Aşıldı');
    expect(result.type).toBe('danger');
  });

  it('eşlenmemiş hatalarda jenerik ama Türkçe bir mesaja düşer, ham hata metnini toast gövdesine sızdırmaz', () => {
    const rawMessage = 'FirebaseError: some very specific internal SDK detail';
    const result = humanizeError(new Error(rawMessage));
    expect(result.title).toBe('Dizge Hatası');
    expect(result.body).not.toContain(rawMessage);
  });

  it('supportReference verildiğinde mesaja "Destek Referansı" olarak eklenir', () => {
    const result = humanizeError(new Error('bilinmeyen'), 'log-xyz789');
    expect(result.body).toContain('Destek Referansı: log-xyz789');
  });

  it('supportReference verilmediğinde mesajda destek referansı satırı yer almaz', () => {
    const result = humanizeError(new Error('bilinmeyen'));
    expect(result.body).not.toContain('Destek Referansı');
  });
});
