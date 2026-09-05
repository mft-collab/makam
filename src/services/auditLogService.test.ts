import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as firebase from '../firebase';
import { auditLogService } from './auditLogService';

// Bu katmanın SÖZLEŞMESİ, hangi filtrenin SUNUCUDA (Firestore `where`) hangi
// filtrenin istemcide uygulandığıdır — kurulan sorgu kısıtlarını doğrulamak
// bu yüzden gerçek veri döndürmekten daha anlamlıdır (bkz. kod denetimi
// P2-22: tip filtresi tek başına istemcide kalmıştı).

const emptySnapshot = { docs: [] } as unknown as Awaited<ReturnType<typeof firebase.getDocs>>;

describe('auditLogService.fetchFiltered — sunucu tarafı filtre kısıtları', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firebase.getDocs).mockResolvedValue(emptySnapshot);
    // where(), kurulan kısıtı test edilebilir kılmak için argümanlarını
    // olduğu gibi taşıyan bir nesneye çevrilir.
    vi.mocked(firebase.where).mockImplementation(
      (field, op, value) => ({ field, op, value }) as unknown as ReturnType<typeof firebase.where>
    );
  });

  const constraintsOf = () =>
    vi.mocked(firebase.query).mock.calls[0]!.slice(1) as unknown as Array<{ field?: string; op?: string; value?: unknown }>;

  it('logType verilirse where(\'logType\', \'==\') kısıtı eklenir', async () => {
    await auditLogService.fetchFiltered({ logType: 'STATUS', pageSize: 15 });

    expect(constraintsOf()).toContainEqual({ field: 'logType', op: '==', value: 'STATUS' });
  });

  it('logType verilmezse ("Tüm İşlemler") logType kısıtı HİÇ eklenmez', async () => {
    // Aksi halde 'ALL' seçiliyken bile bir eşitlik kısıtı kurulur ve logType
    // alanı olmayan TÜM eski kayıtlar sonuçtan düşerdi.
    await auditLogService.fetchFiltered({ pageSize: 15 });

    expect(constraintsOf().some(c => c?.field === 'logType')).toBe(false);
  });

  it('logType, mevcut aktör/tarih kısıtlarıyla BİRLİKTE uygulanır', async () => {
    // Üçü aynı sorguda birleşebilmeli — bu kombinasyon
    // firestore.indexes.json'daki (changedBy, logType, timestamp) bileşik
    // indeksini gerektirir; indeks olmadan sorgu çalışma anında
    // FAILED_PRECONDITION ile düşer.
    await auditLogService.fetchFiltered({
      changedBy: 'user-1', logType: 'FIELD', fromMs: 1000, toMs: 2000, pageSize: 15,
    });

    const constraints = constraintsOf();
    expect(constraints).toContainEqual({ field: 'changedBy', op: '==', value: 'user-1' });
    expect(constraints).toContainEqual({ field: 'logType', op: '==', value: 'FIELD' });
    expect(constraints).toContainEqual({ field: 'timestamp', op: '>=', value: 1000 });
    expect(constraints).toContainEqual({ field: 'timestamp', op: '<=', value: 2000 });
  });
});
