import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  limit,
  db
} from '../firebase';
import { runWithRetry } from '../lib/retry';
import { Department, DepartmentSchema } from '../types';
import { validateOrPassthrough } from '../lib/validateOrPassthrough';

/**
 * departments koleksiyonu için TEK okuma/yazma katmanı (auditLogService.ts /
 * userService.ts ile aynı desen).
 *
 * NEDEN VAR: departman eskiden hiçbir yerde varlık olarak tutulmuyordu —
 * TeamList.tsx serbest metin olarak alıyor, firestore.rules ise onu TAM STRING
 * EŞİTLİĞİYLE karşılaştırıyordu (`existing().departmentId == getUserDepartment()`).
 * Tek bir yazım hatası ya yeni bir "hayalet departman" üretiyor ya da bir
 * Müdürü kendi biriminden sessizce koparıyordu (bkz. kod denetimi P0-2).
 *
 * Doküman ID'si = departmanın kendi değeri. Bu yüzden burada bir "id üret"
 * adımı YOKTUR ve olmamalıdır: ID'yi normalize etmek (slug'lamak) mevcut
 * tasks/users kayıtlarındaki string değerlerle eşleşmeyi bozardı.
 */

/** Firestore doküman ID'si olarak KULLANILAMAYACAK departman adları. Bunlar
 *  Firestore'un kendi ID kısıtlarıdır (eğik çizgi yol ayıracıdır; '.'/'..'
 *  ve '__x__' rezervedir) — bir departman adı bunlardan birine uyuyorsa o ad
 *  bu tasarımda hiçbir zaman referans varlığa dönüştürülemez. */
export function isUsableAsDepartmentId(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 100 &&
    !name.includes('/') &&
    name !== '.' &&
    name !== '..' &&
    !/^__.*__$/.test(name)
  );
}

/** Kullanıcı girdisinin tek normalizasyonu: baştan/sondan boşluk kırpma.
 *  Büyük/küçük harf veya aksan normalizasyonu BİLİNÇLİ olarak yapılmaz —
 *  değer aynı zamanda doküman ID'si olduğundan, normalize edilmiş bir ad
 *  mevcut kayıtlardaki ham değerle eşleşmezdi. */
export function normalizeDepartmentName(raw: string): string {
  return raw.trim();
}

function toDepartment(id: string, data: Record<string, unknown>): Department {
  // `name` alanı kuralla ID'ye eşitlenmiştir; yine de eksik/bozuk bir eski
  // kayıtta liste boş bir etiketle görünmesin diye ID varsayılan olarak kullanılır.
  const raw = { id, name: id, ...data } as unknown as Department;
  return validateOrPassthrough(DepartmentSchema, raw, id, 'departments');
}

// Departman sayısı doğası gereği küçüktür; yine de tasks/users/blockers
// listener'larıyla AYNI disiplin gereği (bkz. useFirestoreData.ts — sınırsız
// sorgu, org büyüdükçe okuma profilini öngörülemez kılar) üst sınır konur.
const DEPARTMENT_QUERY_LIMIT = 200;

export const departmentService = {
  /** Canlı departman listesi. Döndürdüğü fonksiyon aboneliği sonlandırır. */
  subscribe(
    onNext: (departments: Department[]) => void,
    onError: (error: unknown) => void
  ): () => void {
    return onSnapshot(
      query(collection(db, 'departments'), limit(DEPARTMENT_QUERY_LIMIT)),
      (snapshot) => {
        const list = snapshot.docs.map(d => toDepartment(d.id, d.data()));
        list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        onNext(list);
      },
      (error) => onError(error)
    );
  },

  /** Tek seferlik okuma — listener kurmanın anlamsız olduğu yerler için
   *  (ör. testler, tek atımlık doğrulamalar). */
  async listAll(): Promise<Department[]> {
    const snapshot = await getDocs(query(collection(db, 'departments'), limit(DEPARTMENT_QUERY_LIMIT)));
    const list = snapshot.docs.map(d => toDepartment(d.id, d.data()));
    list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return list;
  },

  /**
   * Yeni birim oluşturur (yalnızca Admin — firestore.rules bunu ayrıca
   * zorunlu kılar). Aynı adla ikinci kez çağrılması zararsızdır: doküman ID'si
   * adın kendisi olduğundan çağrı idempotenttir, mevcut kaydı aynı şekilde
   * yeniden yazar. `createdAt`'ın da yeniden yazılması kuralın
   * `incoming().createdAt == existing().createdAt` kısıtına takılacağından
   * mevcut değer korunmak zorundadır — bu yüzden var olan bir departman için
   * yazma hiç denenmez.
   */
  async createDepartment(rawName: string, actorId: string, existing: Department[] = []): Promise<string> {
    const name = normalizeDepartmentName(rawName);
    if (!isUsableAsDepartmentId(name)) {
      throw new Error('Birim adı geçersiz: eğik çizgi (/) içeremez ve 1-100 karakter olmalıdır.');
    }
    if (existing.some(d => d.id === name)) {
      // Zaten var — yeniden yazmak createdAt kısıtına takılırdı (yukarı bkz.).
      return name;
    }
    await runWithRetry(async () => {
      await setDoc(doc(db, 'departments', name), {
        name,
        createdAt: Date.now(),
        createdBy: actorId,
      });
    });
    return name;
  }
};
