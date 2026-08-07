/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['makam-logo.svg', 'makam-logo-192.png', 'makam-logo-512.png', 'favicon.ico', 'robots.txt'],
        manifest: {
          name: 'MAKAM Stratejik Yönetim',
          short_name: 'MAKAM',
          description: 'Makam Harekat ve Stratejik Yönetim Sistemi',
          theme_color: '#0F172A',
          background_color: '#F8F8F7',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          icons: [
            {
              src: 'makam-logo-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'makam-logo-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        // #8 — Workbox offline cache stratejileri
        workbox: {
          globPatterns: mode === 'production' ? ['**/*.{js,css,html,svg}'] : [],
          runtimeCaching: [
            {
              // Firestore/Firebase API → NetworkFirst: canlı veri öncelikli
              urlPattern: /^https:\/\/firestore\.googleapis\.com/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firestore-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 300 },
                networkTimeoutSeconds: 10,
              },
            },
            {
              // Firebase Auth → NetworkFirst
              urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firebase-auth-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 3600 },
              },
            },
            {
              // Google Fonts → CacheFirst: hızlı yükleme
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              // Static JS/CSS chunks → StaleWhileRevalidate
              urlPattern: /\.(js|css)$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-resources',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
          ],
        },
        devOptions: {
          enabled: true
        }
      })
    ],
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // vendor-charts (recharts) ve vendor-pdf (jsPDF) BİLEREK manualChunks'tan
          // çıkarıldı: bu ikisini adlandırılmış chunk olarak zorlamak, yalnızca
          // Dashboard/Reports'un lazy() dynamic import'u üzerinden erişilebilir
          // olmalarına rağmen, Rollup'ın ana giriş dosyasına bu chunk'lardan
          // STATİK import eklemesine yol açıyordu (ölçüldü — network log'da
          // vendor-charts.js login ekranında ~86ms'de "High priority" olarak
          // indiriliyordu, modulePreload/SW precache filtreleriyle önlenemedi).
          // Rollup'ın otomatik chunk bölme mantığı dynamic import sınırına saygı
          // gösteriyor; bu ikisi artık yalnızca Dashboard/Reports chunk'ı içine
          // veya ona özel otomatik bir chunk'a gömülüyor.
          manualChunks: {
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/messaging'],
            'vendor-motion':   ['motion'],
            'vendor-date':     ['date-fns'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/lib/**', 'src/services/**'],
        exclude: ['src/test/**', 'node_modules/**'],
      },
    },
  };
});
