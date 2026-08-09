import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logError } from './errorLoggingService';
import * as firebase from '../firebase';

describe('errorLoggingService.logError', () => {
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    (firebase.auth as { currentUser: { uid: string } | null }).currentUser = null;
    vi.mocked(firebase.collection).mockImplementation((_db: any, name: string) => ({ __name: name }) as any);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
  });

  const lastLoggedEntry = () => vi.mocked(firebase.addDoc).mock.calls[0]?.[1] as Record<string, unknown> | undefined;

  it('Error nesnesi verildiğinde message, error.message olur', async () => {
    await logError(new Error('Beklenmeyen hata'), 'manual');
    expect(lastLoggedEntry()).toMatchObject({ message: 'Beklenmeyen hata' });
  });

  it('string verildiğinde message doğrudan o string olur, stack alanı yer almaz', async () => {
    await logError('basit hata metni', 'async');
    const entry = lastLoggedEntry();
    expect(entry).toMatchObject({ message: 'basit hata metni' });
    expect(entry).not.toHaveProperty('stack');
  });

  it('Error/string dışındaki değerler String() ile mesaja çevrilir', async () => {
    await logError({ code: 42 }, 'manual');
    expect(lastLoggedEntry()?.message).toBe(String({ code: 42 }));
  });

  it('stack trace 2000 karakterden uzunsa kırpılır', async () => {
    const err = new Error('uzun');
    err.stack = 'x'.repeat(3000);
    await logError(err, 'ErrorBoundary');
    expect((lastLoggedEntry()?.stack as string).length).toBe(2000);
  });

  it('options.operationType/path/context verildiğinde kayda eklenir', async () => {
    await logError(new Error('x'), 'firestore', { operationType: 'update', path: 'tasks/123', context: { foo: 'bar' } });
    expect(lastLoggedEntry()).toMatchObject({ operationType: 'update', path: 'tasks/123', context: { foo: 'bar' } });
  });

  it('options verilmezse operationType/path/context alanları kayıtta hiç yer almaz (undefined filtrelenir)', async () => {
    await logError(new Error('x'), 'manual');
    const entry = lastLoggedEntry();
    expect(entry).not.toHaveProperty('operationType');
    expect(entry).not.toHaveProperty('path');
    expect(entry).not.toHaveProperty('context');
  });

  it('auth.currentUser doluyken userId kayda eklenir', async () => {
    (firebase.auth as { currentUser: { uid: string } | null }).currentUser = { uid: 'user-42' };
    await logError(new Error('x'), 'manual');
    expect(lastLoggedEntry()).toMatchObject({ userId: 'user-42' });
  });

  it('auth.currentUser null ise userId kayıtta yer almaz', async () => {
    await logError(new Error('x'), 'manual');
    expect(lastLoggedEntry()).not.toHaveProperty('userId');
  });

  it('appVersion her zaman sabit sürüm değeridir', async () => {
    await logError(new Error('x'), 'manual');
    expect(lastLoggedEntry()).toMatchObject({ appVersion: '2.2.0' });
  });

  it('timestamp Date.now() civarında bir sayıdır', async () => {
    const before = Date.now();
    await logError(new Error('x'), 'manual');
    const entry = lastLoggedEntry();
    expect(entry?.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry?.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('userAgent 200 karakterden uzunsa kırpılır', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'A'.repeat(500), configurable: true });
    await logError(new Error('x'), 'manual');
    expect((lastLoggedEntry()?.userAgent as string).length).toBe(200);
  });

  it("addDoc, collection(db, 'error_logs') üzerinde çağrılır", async () => {
    await logError(new Error('x'), 'manual');
    expect(firebase.collection).toHaveBeenCalledWith(firebase.db, 'error_logs');
    expect(firebase.addDoc).toHaveBeenCalledWith({ __name: 'error_logs' }, expect.anything());
  });

  it('addDoc reddedilirse hata yutulur, fonksiyon fırlatmadan (resolve ile) tamamlanır', async () => {
    vi.mocked(firebase.addDoc).mockRejectedValueOnce(new Error('network'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(logError(new Error('x'), 'manual')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });
});
