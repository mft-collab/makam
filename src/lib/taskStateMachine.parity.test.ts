/**
 * Durum makinesi PARİTE testi (P0-3).
 *
 * Neden ayrı bir dosya: `taskStateMachine.test.ts` içindeki
 * "firestore.rules isValidTransition ile birebir aynı..." testi, adının
 * iddia ettiği şeyi YAPMIYORDU — `firestore.rules` dosyasını hiç okumadan
 * yalnızca client tablosunu (VALID_TRANSITIONS) kendi kendine yeniden
 * doğruluyordu. Yani biri gidip SADECE firestore.rules'taki geçiş tablosunu
 * değiştirseydi (ör. COMPLETED'dan çıkışa izin verseydi) o test yeşil kalırdı;
 * "iki taraf senkron" güvencesi sahteydi (bkz. kod denetimi).
 *
 * Bu dosya `firestore.rules`'ı Node'da METİN olarak okur, isValidTransition
 * fonksiyonunun gövdesindeki geçiş tablosunu ayrıştırır ve client tablosuyla
 * GERÇEKTEN karşılaştırır. İki taraf birbirinden saparsa test kırılır.
 *
 * Ayrıştırma bilinçli olarak "pragmatik ama kırılgan olmayan" tutuldu: rules
 * dili tam olarak parse edilmez, yalnızca `oldStatus == 'X' && newStatus in
 * [...]` kalıbı çıkarılır. Kalıbın kendisi değişirse (ör. tablo bambaşka bir
 * biçimde yeniden yazılırsa) aşağıdaki "yapısal bütünlük" testleri devreye
 * girer ve sessiz bir yanlış-yeşil yerine açık bir hata verir.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { VALID_TRANSITIONS } from './taskStateMachine';
import { TaskStatusSchema, type TaskStatus } from '../types';

// Testler jsdom ortamında koştuğundan `import.meta.url` bir http:// URL'idir
// (file:// değil) — dosya yolu Vitest'in kök dizininden (proje kökü) çözülür.
const RULES_PATH = resolve(process.cwd(), 'firestore.rules');
if (!existsSync(RULES_PATH)) {
  throw new Error(`[parity] firestore.rules bulunamadı: ${RULES_PATH}`);
}
const RULES_SOURCE = readFileSync(RULES_PATH, 'utf8');

/** isValidTransition(...) fonksiyonunun gövdesi — diğer kurallardaki
 *  (isValidTaskUpdate'in status enum listesi gibi) benzer kalıpların
 *  yanlışlıkla eşleşmemesi için önce fonksiyon gövdesi izole edilir. */
function extractIsValidTransitionBody(source: string): string {
  const start = source.indexOf('function isValidTransition(');
  if (start === -1) {
    throw new Error('firestore.rules içinde isValidTransition fonksiyonu bulunamadı.');
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('isValidTransition fonksiyonunun gövdesi kapatılmamış.');
}

const BODY = extractIsValidTransitionBody(RULES_SOURCE);

/** Yorum satırlarını at — açıklama yorumlarındaki örnek durum adları
 *  (ör. "// ASSIGNED → IN_PROGRESS, BLOCKED, ...") ayrıştırmaya karışmasın. */
const BODY_CODE = BODY.replace(/\/\/[^\n]*/g, '');

/** `let fromX = oldStatus == 'A' && newStatus in ['B', 'C'];` kalıbını çıkarır. */
function parseRulesTransitions(body: string): Record<string, Set<string>> {
  const table: Record<string, Set<string>> = {};
  const clause = /oldStatus\s*==\s*'([A-Z_]+)'\s*&&\s*newStatus\s+in\s+\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = clause.exec(body)) !== null) {
    const from = match[1]!;
    const targets = match[2]!
      .split(',')
      .map(t => t.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    table[from] ??= new Set<string>();
    targets.forEach(t => table[from]!.add(t));
  }
  return table;
}

/** `let <isim> = ...` ile tanımlanan tüm bağlamalar. */
function parseLetBindings(body: string): string[] {
  return [...body.matchAll(/let\s+([A-Za-z0-9_]+)\s*=/g)].map(m => m[1]!);
}

const RULES_TABLE = parseRulesTransitions(BODY_CODE);
const ALL_STATUSES = TaskStatusSchema.options as readonly TaskStatus[];

describe('firestore.rules ↔ taskStateMachine.ts parite', () => {
  it('ayrıştırıcı, rules dosyasından anlamlı bir geçiş tablosu çıkarabiliyor', () => {
    // Ayrıştırma sessizce boş dönerse aşağıdaki karşılaştırmalar anlamsız
    // biçimde "geçer" — bu test, testin kendi ön koşulunu korur.
    expect(Object.keys(RULES_TABLE).length).toBeGreaterThanOrEqual(6);
    for (const [from, targets] of Object.entries(RULES_TABLE)) {
      expect(ALL_STATUSES).toContain(from as TaskStatus);
      expect(targets.size).toBeGreaterThan(0);
      targets.forEach(t => expect(ALL_STATUSES).toContain(t as TaskStatus));
    }
  });

  it.each(ALL_STATUSES)('%s durumunun hedef kümesi iki tarafta AYNI', (status) => {
    const clientTargets = [...(VALID_TRANSITIONS[status] ?? [])].sort();
    const rulesTargets = [...(RULES_TABLE[status] ?? new Set<string>())].sort();
    expect(rulesTargets).toEqual(clientTargets);
  });

  it('client tablosundaki her durum rules tarafında da ele alınmış (eksik durum yok)', () => {
    const clientActive = ALL_STATUSES.filter(s => (VALID_TRANSITIONS[s] ?? []).length > 0);
    const rulesActive = Object.keys(RULES_TABLE).sort();
    expect(rulesActive).toEqual([...clientActive].sort());
  });

  it('COMPLETED ve CANCELLED rules tarafında da terminaldir (hiçbir çıkış kalıbı yok)', () => {
    expect(RULES_TABLE.COMPLETED).toBeUndefined();
    expect(RULES_TABLE.CANCELLED).toBeUndefined();
    expect(VALID_TRANSITIONS.COMPLETED).toEqual([]);
    expect(VALID_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('rules tarafında oldStatus\'tan BAĞIMSIZ bir CANCELLED kısayolu YOK', () => {
    // Eskiden burada `newStatus == 'CANCELLED'` kısayolu vardı ve COMPLETED bir
    // görevin bile iptal edilmesine izin veriyordu (bkz. kod denetimi +
    // taskStateMachine.ts başlık yorumu). Kısayol geri gelirse yukarıdaki
    // hedef-kümesi karşılaştırması bunu YAKALAYAMAZ (kısayol bir liste değil,
    // ayrı bir eşitlik kontrolüdür) — bu yüzden ayrıca metin üzerinden aranır.
    const shortcut = /newStatus\s*==\s*'[A-Z_]+'/.test(BODY_CODE);
    expect(shortcut).toBe(false);
  });

  it('rules tarafında aynı-duruma-yazma (no-op) izni korunuyor', () => {
    expect(/oldStatus\s*==\s*newStatus/.test(BODY_CODE)).toBe(true);
    // Client tarafındaki karşılığı: isValidTaskTransition'ın `from === to` erken dönüşü.
  });

  it('tanımlanan her `let` bağlaması return ifadesinde GERÇEKTEN kullanılıyor', () => {
    // Bir geçiş listesi eklenip return'e eklenmezse tablo iki tarafta aynı
    // görünür ama rules o geçişe izin vermez — sessiz bir sapma. Bu test onu yakalar.
    const returnMatch = BODY_CODE.match(/return\s+([\s\S]*?);/);
    expect(returnMatch).not.toBeNull();
    const returnExpr = returnMatch![1]!;
    for (const binding of parseLetBindings(BODY_CODE)) {
      expect(returnExpr).toContain(binding);
    }
  });
});

describe('firestore.rules ↔ types.ts durum enum paritesi', () => {
  it('isValidTaskUpdate\'in izin verdiği status listesi TaskStatusSchema ile aynı', () => {
    // Rules'a yeni bir durum eklenmeden types.ts'e eklenirse (veya tersi),
    // o durumdaki her yazma sessizce reddedilir.
    const match = RULES_SOURCE.match(/data\.status\s+in\s+\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const rulesStatuses = match![1]!
      .split(',')
      .map(s => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
      .sort();
    expect(rulesStatuses).toEqual([...ALL_STATUSES].sort());
  });
});
