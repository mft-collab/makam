import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '3000';
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // authenticated.spec.ts yalnızca Firebase Emulator Suite'e karşı, ayrı bir
  // config ile çalışır (bkz. playwright.emulator.config.ts, npm run
  // test:e2e:emulator) — .e2e-token.json ve VITE_USE_FIREBASE_EMULATOR
  // olmadan burada çalıştırılırsa her zaman başarısız olur.
  testIgnore: /authenticated\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
  },
});
