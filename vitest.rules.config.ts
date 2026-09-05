import { defineConfig } from 'vitest/config';

/**
 * firestore.rules test matrisi için AYRI bir Vitest yapılandırması.
 *
 * Neden ana `vite.config.ts`'teki `test` bloğuna eklenmedi:
 *  - Ana yapılandırma `environment: 'jsdom'` ve `setupFiles: src/test/setup.ts`
 *    kullanır; o setup dosyası TÜM Firebase modüllerini global olarak mock'lar
 *    (bkz. src/test/setup.ts). Rules testlerinin ise emulator'a GERÇEK bir
 *    bağlantı açması gerekir — mock'lanmış bir SDK ile hiçbir kural
 *    doğrulanamaz.
 *  - Ana `include` deseni yalnızca `src/**` altını kapsar; rules testleri
 *    kaynak ağacına ait değil (bkz. tests/e2e ile aynı ayrım).
 *  - Bu testler emulator olmadan çalışamaz, bu yüzden `npm test`in (CI'daki
 *    hızlı birim test aşaması) parçası OLMAMALIDIR — kendi script'i vardır
 *    (`npm run test:rules`, firebase emulators:exec içinden).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // Rules testleri tek bir paylaşılan emulator örneğine karşı çalışır ve her
    // testten önce clearFirestore() ile veritabanını sıfırlar — paralel dosya
    // çalıştırma bu sıfırlamayı testler arasında yarıştırır.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
