import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '3001';
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Kimlik doğrulamalı e2e testleri için ayrı config — Firebase Emulator
 * Suite'e karşı çalışır (bkz. package.json `test:e2e:emulator`, ki bu
 * firebase emulators:exec ile emulator'ları ayağa kaldırıp bu config'i
 * çağırır). Ana playwright.config.ts (core.spec.ts — sadece Login ekranı)
 * gerçek Firebase projesine karşı çalışmaya devam eder, buradan etkilenmez.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /authenticated\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT,
      VITE_USE_FIREBASE_EMULATOR: 'true',
    },
  },
});
