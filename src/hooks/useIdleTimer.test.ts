/**
 * useIdleTimer testleri (P0-5).
 *
 * Oturum zaman aşımı bir GÜVENLİK kontrolüdür: yanlış çalışması ya oturumu
 * pratikte hiç kapatmaz (eski 24 saatlik eşikte olduğu gibi) ya da kullanıcıyı
 * uyarı göstermeden dışarı atar. Bu yüzden zamanlayıcı davranışı sahte
 * zamanlayıcılarla birim testine bağlanır.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIdleTimer } from './useIdleTimer';
import { DEFAULT_SESSION_TIMEOUT_MS, SESSION_TIMEOUT_WARNING_MS } from '../constants';

// src/test/setup.ts, window.dispatchEvent'i global olarak no-op'a çeviriyor
// (toast/SLA event'leri testleri kirletmesin diye). Bu dosyanın konusu tam da
// gerçek kullanıcı etkinliği event'lerinin sayacı sıfırlaması olduğundan
// orijinal davranış burada geri alınır.
beforeAll(() => {
  (window.dispatchEvent as unknown as { mockRestore?: () => void }).mockRestore?.();
});

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

const fireActivity = async () => {
  await act(async () => {
    window.dispatchEvent(new Event('mousemove'));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIdleTimer', () => {
  it('varsayılan süre 30 dakikadır (eski 24 saatlik eşik değil)', () => {
    expect(DEFAULT_SESSION_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it('süre dolmadan onIdle çağrılmaz, dolduğunda çağrılır', async () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ onIdle, enabled: true }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();

    await advance(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('özel timeoutMs değeri kullanılır (Admin ayarı)', async () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ onIdle, enabled: true, timeoutMs: 5 * 60 * 1000 }));

    await advance(5 * 60 * 1000 - 1);
    expect(onIdle).not.toHaveBeenCalled();
    await advance(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('kapanmadan warningMs kadar önce uyarı durumuna geçer', async () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimer({ onIdle, enabled: true }));

    expect(result.current.isWarning).toBe(false);

    await advance(DEFAULT_SESSION_TIMEOUT_MS - SESSION_TIMEOUT_WARNING_MS - 1);
    expect(result.current.isWarning).toBe(false);

    await advance(1);
    expect(result.current.isWarning).toBe(true);
    expect(result.current.remainingMs).toBe(SESSION_TIMEOUT_WARNING_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('uyarı penceresinde geri sayım saniyede bir azalır', async () => {
    const { result } = renderHook(() => useIdleTimer({ onIdle: vi.fn(), enabled: true }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS - SESSION_TIMEOUT_WARNING_MS);
    expect(result.current.remainingMs).toBe(60_000);

    await advance(1000);
    expect(result.current.remainingMs).toBe(59_000);

    await advance(10_000);
    expect(result.current.remainingMs).toBe(49_000);
  });

  it('kullanıcı etkinliği (uyarı YOKKEN) sayacı sıfırlar', async () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ onIdle, enabled: true }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS - SESSION_TIMEOUT_WARNING_MS - 1000);
    await fireActivity();

    // Sıfırlanmasaydı burada oturum çoktan kapanmış olurdu.
    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();

    await advance(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('UYARI GÖRÜNÜRKEN kullanıcı etkinliği sayacı sıfırlamaz', async () => {
    // Aksi halde modalı okumak için fareyi kıpırdatmak uyarıyı sessizce
    // kapatır ve kullanıcı oturumun uzatıldığını fark etmezdi.
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimer({ onIdle, enabled: true }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS - SESSION_TIMEOUT_WARNING_MS);
    expect(result.current.isWarning).toBe(true);

    await fireActivity();
    expect(result.current.isWarning).toBe(true);

    await advance(SESSION_TIMEOUT_WARNING_MS);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('continueSession uyarıyı kapatır ve süreyi baştan başlatır', async () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimer({ onIdle, enabled: true }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS - SESSION_TIMEOUT_WARNING_MS);
    expect(result.current.isWarning).toBe(true);

    await act(async () => {
      result.current.continueSession();
    });
    expect(result.current.isWarning).toBe(false);
    expect(result.current.remainingMs).toBe(SESSION_TIMEOUT_WARNING_MS);

    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    await advance(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('continueSession sonrası kullanıcı etkinliği yeniden sayacı sıfırlayabilir', async () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimer({ onIdle, enabled: true }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS - SESSION_TIMEOUT_WARNING_MS);
    await act(async () => { result.current.continueSession(); });

    // Uyarı penceresine GİRMEDEN önce etkinlik — sayaç yeniden sıfırlanmalı.
    await advance(DEFAULT_SESSION_TIMEOUT_MS - SESSION_TIMEOUT_WARNING_MS - 1000);
    expect(result.current.isWarning).toBe(false);
    await fireActivity();

    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    await advance(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('enabled=false iken hiç zamanlayıcı çalışmaz', async () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimer({ onIdle, enabled: false }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();
    expect(result.current.isWarning).toBe(false);
  });

  it('enabled false→true olduğunda sayaç sıfırdan başlar', async () => {
    const onIdle = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useIdleTimer({ onIdle, enabled }),
      { initialProps: { enabled: false } }
    );

    await advance(DEFAULT_SESSION_TIMEOUT_MS);
    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => { rerender({ enabled: true }); });
    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    await advance(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('enabled true→false olduğunda bekleyen kapatma iptal edilir', async () => {
    const onIdle = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useIdleTimer({ onIdle, enabled }),
      { initialProps: { enabled: true } }
    );

    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1000);
    await act(async () => { rerender({ enabled: false }); });
    await advance(DEFAULT_SESSION_TIMEOUT_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('unmount sonrası onIdle çağrılmaz (zamanlayıcılar temizlenir)', async () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleTimer({ onIdle, enabled: true }));

    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1000);
    unmount();
    await advance(DEFAULT_SESSION_TIMEOUT_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('warningMs toplam süreden uzunsa uyarı hemen görünür ama kapanma yine timeoutMs\'te olur', async () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimer({ onIdle, enabled: true, timeoutMs: 10_000, warningMs: 60_000 })
    );

    // Uyarı gecikmesi 0'a kırpılır (negatif olamaz) ama yine de bir
    // zamanlayıcı turu gerektirir — senkron olarak değil, ilk tick'te görünür.
    await advance(0);
    expect(result.current.isWarning).toBe(true);
    expect(result.current.remainingMs).toBe(10_000);

    await advance(9_999);
    expect(onIdle).not.toHaveBeenCalled();
    await advance(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('onIdle referansı değişse bile zamanlayıcı yeniden başlatılmaz (en güncel callback çağrılır)', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onIdle }) => useIdleTimer({ onIdle, enabled: true }),
      { initialProps: { onIdle: first } }
    );

    await advance(DEFAULT_SESSION_TIMEOUT_MS - 1000);
    await act(async () => { rerender({ onIdle: second }); });
    await advance(1000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
