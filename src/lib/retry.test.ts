import { describe, it, expect } from 'vitest';
import { runWithRetry } from '../lib/retry';

describe('runWithRetry — Exponential Backoff', () => {
  it('ilk denemede başarılı olursa hemen sonuç döner', async () => {
    const result = await runWithRetry(() => Promise.resolve('başarı'));
    expect(result).toBe('başarı');
  });

  it('ikinci denemede başarılı olursa sonuç döner', async () => {
    let attempt = 0;
    const result = await runWithRetry(async () => {
      attempt++;
      if (attempt < 2) throw new Error('geçici hata');
      return 'kurtarıldı';
    }, 3, 0); // delay=0 testleri hızlandırır
    expect(result).toBe('kurtarıldı');
    expect(attempt).toBe(2);
  });

  it('tüm denemeler başarısız olursa hata fırlatır', async () => {
    await expect(
      runWithRetry(() => Promise.reject(new Error('kalıcı hata')), 3, 0)
    ).rejects.toThrow('kalıcı hata');
  });

  it('maxRetries=1 ise sadece 1 deneme yapılır', async () => {
    let callCount = 0;
    await expect(
      runWithRetry(async () => {
        callCount++;
        throw new Error('hep hata');
      }, 1, 0)
    ).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  it('dönen değer herhangi bir tip olabilir', async () => {
    const obj = await runWithRetry(() => Promise.resolve({ id: '123', count: 5 }));
    expect(obj.id).toBe('123');
    expect(obj.count).toBe(5);
  });

  describe('deterministik iş kuralı hataları hiç yeniden denenmez', () => {
    // Eskiden bu hatalar da 3 kez (~1.5sn exponential backoff) denenip
    // sonunda aynı hatayla başarısız oluyordu — retry sonucu asla
    // değiştirmeyeceği için bu, kullanıcının (ör. bir düzenleme çakışması
    // uyarısını görene kadar) anlamsız yere beklemesine yol açıyordu
    // (bkz. kod denetimi).
    it.each([
      'VERSION_MISMATCH: Beklenen Versiyon 2, Sunucu Versiyonu 3',
      "INVALID_TRANSITION: 'COMPLETED' durumundan 'BLOCKED' durumuna geçiş izinli değil.",
      'Admin rolündeki kullanıcı irtibatlı olarak atanamaz.',
      'Alt talimatlar yalnızca Memur rolündeki personele atanabilir.',
      'İzin/mazeret devri yalnızca Müdür rolündeki personele yapılabilir.',
    ])('%s → tek denemede fırlatılır', async (message) => {
      let callCount = 0;
      await expect(
        runWithRetry(async () => { callCount++; throw new Error(message); }, 3, 0)
      ).rejects.toThrow(message);
      expect(callCount).toBe(1);
    });

    it('bilinmeyen/genel bir hata (ör. geçici ağ hatası) yine de maxRetries kadar denenir', async () => {
      let callCount = 0;
      await expect(
        runWithRetry(async () => { callCount++; throw new Error('Network error'); }, 3, 0)
      ).rejects.toThrow('Network error');
      expect(callCount).toBe(3);
    });
  });
});
