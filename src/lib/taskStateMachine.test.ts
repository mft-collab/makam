import { describe, it, expect } from 'vitest';
import { isValidTaskTransition } from './taskStateMachine';

describe('isValidTaskTransition', () => {
  it('aynı duruma geçiş her zaman izinlidir (no-op)', () => {
    expect(isValidTaskTransition('IN_PROGRESS', 'IN_PROGRESS')).toBe(true);
    expect(isValidTaskTransition('COMPLETED', 'COMPLETED')).toBe(true);
  });

  it('CANCELLED\'a aktif durumlardan geçiş izinlidir', () => {
    expect(isValidTaskTransition('ASSIGNED', 'CANCELLED')).toBe(true);
    expect(isValidTaskTransition('BLOCKED', 'CANCELLED')).toBe(true);
    expect(isValidTaskTransition('CRISIS', 'CANCELLED')).toBe(true);
    expect(isValidTaskTransition('AWAITING_APPROVAL', 'CANCELLED')).toBe(true);
  });

  // NOT: Bu testin adı eskiden "firestore.rules isValidTransition ile birebir
  // aynı..." idi ama bu dosya firestore.rules'ı hiç OKUMUYOR — yalnızca client
  // tablosunun kendi içindeki davranışını doğruluyor. İsim, var olmayan bir
  // senkronizasyon güvencesi vaat ettiği için yanıltıcıydı (bkz. kod denetimi).
  // Gerçek parite doğrulaması artık taskStateMachine.parity.test.ts'te,
  // firestore.rules dosyası ayrıştırılarak yapılıyor.
  it('tablodaki tüm geçerli geçişleri kabul eder', () => {
    expect(isValidTaskTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(isValidTaskTransition('ASSIGNED', 'BLOCKED')).toBe(true);
    expect(isValidTaskTransition('ASSIGNED', 'PENDING_DELEGATION')).toBe(true);
    expect(isValidTaskTransition('PENDING_DELEGATION', 'IN_PROGRESS')).toBe(true);
    expect(isValidTaskTransition('PENDING_DELEGATION', 'BLOCKED')).toBe(true);
    expect(isValidTaskTransition('IN_PROGRESS', 'BLOCKED')).toBe(true);
    expect(isValidTaskTransition('IN_PROGRESS', 'AWAITING_APPROVAL')).toBe(true);
    expect(isValidTaskTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(isValidTaskTransition('IN_PROGRESS', 'CRISIS')).toBe(true);
    expect(isValidTaskTransition('IN_PROGRESS', 'PENDING_DELEGATION')).toBe(true);
    expect(isValidTaskTransition('BLOCKED', 'IN_PROGRESS')).toBe(true);
    expect(isValidTaskTransition('AWAITING_APPROVAL', 'COMPLETED')).toBe(true);
    expect(isValidTaskTransition('AWAITING_APPROVAL', 'IN_PROGRESS')).toBe(true);
    expect(isValidTaskTransition('CRISIS', 'IN_PROGRESS')).toBe(true);
    expect(isValidTaskTransition('CRISIS', 'COMPLETED')).toBe(true);
    expect(isValidTaskTransition('CRISIS', 'AWAITING_APPROVAL')).toBe(true);
  });

  it('tanımsız geçişleri reddeder', () => {
    expect(isValidTaskTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isValidTaskTransition('ASSIGNED', 'COMPLETED')).toBe(false);
    expect(isValidTaskTransition('ASSIGNED', 'AWAITING_APPROVAL')).toBe(false);
    expect(isValidTaskTransition('BLOCKED', 'AWAITING_APPROVAL')).toBe(false);
    expect(isValidTaskTransition('BLOCKED', 'COMPLETED')).toBe(false);
  });

  it('COMPLETED/CANCELLED terminal durumlardır (kendisi hariç hiçbir yere geçemez)', () => {
    // Eskiden burada evrensel bir "her durumdan CANCELLED'a izin ver" kısayolu
    // vardı; bu, COMPLETED bir görevin bile CANCELLED'a çekilmesine izin
    // veriyordu (bkz. kod denetimi). Artık CANCELLED yalnızca aktif durumların
    // kendi listesinde yer alıyor, terminal durumlardan hiçbir yere geçiş yok.
    expect(isValidTaskTransition('COMPLETED', 'CANCELLED')).toBe(false);
    expect(isValidTaskTransition('CANCELLED', 'COMPLETED')).toBe(false);
    expect(isValidTaskTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isValidTaskTransition('CANCELLED', 'IN_PROGRESS')).toBe(false);
  });
});
