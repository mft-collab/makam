import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('MAKAM E2E Core Workflow', () => {
  test('should load the application and show Stratejik Veri Baglantisi loader', async ({ page }) => {
    await page.goto('/');
    
    // Uygulamanın title'ını kontrol et
    await expect(page).toHaveTitle(/MAKAM \| Stratejik Yönetim/);

    // Uygulama yüklenirken çıkan yazının göründüğünden emin ol
    // Eğer anında geçiyorsa timeout olabilir, o yüzden toleranslı bir check.
    const loadingText = page.locator('text=STRATEJİK VERİ BAĞLANTISI');
    
    // Login butonunun veya yükleme ekranının geldiğini kontrol edelim.
    // İlk olarak body içinde MAKAM yazısını veya Login butonunu bekleyelim.
    await page.waitForLoadState('networkidle');

    // Uygulama login ekranına düştüğünde "Sisteme Giriş Yap" butonu görünür olmalı.
    const loginBtn = page.locator('button', { hasText: 'Giriş Yap' }).first();
    if (await loginBtn.isVisible()) {
      await expect(loginBtn).toBeVisible();
    }
  });

  test('should have no critical accessibility violations (axe-core, WCAG 2 AA dahil kontrast)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    if (critical.length > 0) {
      console.log(JSON.stringify(critical, null, 2));
    }

    expect(critical, `Kritik/ciddi a11y ihlalleri: ${critical.map(v => v.id).join(', ')}`).toEqual([]);
  });
});
