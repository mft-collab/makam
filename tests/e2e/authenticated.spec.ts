import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'fs';

/**
 * Kimlik doğrulamalı e2e testleri — Firebase Emulator Suite'e karşı çalışır.
 * Gerçek Google OAuth popup'ını otomatikleştirmek pratik olmadığından,
 * scripts/seedE2E.ts'in ürettiği bir custom token ile ?e2e_token= üzerinden
 * giriş yapılır (bkz. src/App.tsx'teki emulator-only bypass).
 *
 * Çalıştırma: npm run test:e2e:emulator
 * (firebase emulators:exec, emulator'ları ayağa kaldırıp seed script'ini ve
 * bu test dosyasını sırayla çalıştırır, sonunda emulator'ları kapatır.)
 */

let e2eToken: string;
let seededTaskTitle: string;

test.beforeAll(() => {
  const data = JSON.parse(readFileSync('.e2e-token.json', 'utf-8'));
  e2eToken = data.token;
  seededTaskTitle = data.taskTitle;
});

test.describe('MAKAM E2E — Kimlik Doğrulamalı Akışlar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/?e2e_token=${e2eToken}`);
    // Harekat Merkezi (Dashboard) sekmesinin görünmesini bekle — giriş başarılı demektir
    await expect(page.getByText('Stratejik Sağlık Endeksi')).toBeVisible({ timeout: 15000 });
  });

  test('Admin girişi Harekat Merkezi\'ni yükler', async ({ page }) => {
    await expect(page).toHaveTitle(/MAKAM \| Stratejik Yönetim/);
    await expect(page.getByText('Stratejik Sağlık Endeksi')).toBeVisible();
  });

  test('Talimatlar sekmesi seed edilen görevi gösterir', async ({ page }) => {
    await page.getByRole('button', { name: 'Talimatlar' }).click();
    // Responsive tasarım hem mobil kart hem masaüstü tablo satırını DOM'da
    // tutar (CSS ile birini gizler) — masaüstü test viewport'unda görünür
    // olan tablo satırına özel olarak bak.
    await expect(page.getByRole('table').getByText(seededTaskTitle)).toBeVisible({ timeout: 10000 });
  });

  test('Harekat Merkezi kritik/ciddi a11y ihlali içermemeli', async ({ page }) => {
    // Dashboard'daki panellerin girişte kademeli (staggered) spring animasyonu
    // var (en geç delay 0.42s + yerleşme süresi) — axe taraması animasyon
    // sürerken geçici, yanıltıcı düşük-opaklık kontrast "ihlalleri" yakalamasın
    // diye sabit duruma gelmesini bekliyoruz.
    await page.waitForTimeout(1200);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(critical, `Kritik/ciddi a11y ihlalleri: ${critical.map(v => v.id).join(', ')}`).toEqual([]);
  });
});
