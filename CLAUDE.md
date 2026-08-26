# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje

MAKAM — kurumsal görev/blocker/SLA takip uygulaması. React 19 + TypeScript + Firebase üzerine kurulu, offline-first bir PWA. Firebase **Spark (ücretsiz) plan**ın kullanım kotaları (Firestore okuma/yazma, depolama, bant genişliği) göz önünde bulundurularak tasarlanmıştır — yeni entegrasyonlar bu kotalarla uyumlu olmalı. Not: Cloud Functions'ın kendisi (arka plan tetikleyicileri dahil) Firebase/GCP tarafında teknik olarak faturalandırmalı bir hesap (Blaze) gerektirir; buradaki "Spark" vurgusu "Blaze'de ama Spark'ın ücretsiz kota sınırları içinde kalınacak şekilde tasarlanmış" anlamına gelir (bkz. `functions/src/`'teki sayfalama/toplu-işlem korumaları).

## Komutlar

```bash
npm run dev                  # server.js üzerinden dev sunucusu (gerçek Firebase projesine bağlanır — dikkatli olun)
npm run build                # production build (dist/)
npm run lint                 # tsc --noEmit
npm run eslint                # ESLint (kod kalitesi + a11y + Firestore rules kuralları)
npm test                     # vitest run
npm run test:watch           # vitest (watch modu)
npm run test:coverage        # kapsam raporu (v8) — src/lib, src/services kapsar
npx vitest run <path>        # tek test dosyası
npx vitest run -t "<isim>"   # isme göre tek test
npm run size                  # bundle boyutu bütçesi (size-limit)
npm run lighthouse            # lhci autorun — a11y/best-practices/SEO gate, perf şimdilik warn
```

E2E (Playwright):
- `npx playwright test` → `tests/e2e/core.spec.ts`, gerçek Firebase projesine karşı, yalnızca kimlik doğrulama gerektirmeyen Login ekranını (yükleme + a11y) kapsar.
- `npm run test:e2e:emulator` → Firebase Emulator Suite'i (Auth+Firestore) ayağa kaldırır, `scripts/seedE2E.ts` ile test verisi tohumlar, `tests/e2e/authenticated.spec.ts`'i çalıştırır, sonunda emulator'ları kapatır. Gerçek projeye dokunmaz. Gerektirir: Java 11+. Kimlik doğrulama, `src/App.tsx`'teki `isUsingFirebaseEmulator` bypass'ı ile custom auth token üzerinden yapılır — yalnızca `vite dev` + `VITE_USE_FIREBASE_EMULATOR=true` ile aktiftir, prod build'de asla çalışmaz.

CI (`.github/workflows/ci.yml`) sırası: `security` (gitleaks + `npm audit --audit-level=critical`) → `quality` (lint + eslint + test) → `build` → `performance` (size + lighthouse) → `deploy`/`preview`. Notlar: `deploy` işi yalnızca `firebase deploy --only hosting` çalıştırır — Cloud Functions deploy'u bu pipeline'ın dışındadır (manuel: `cd functions && npm run deploy`). Emulator tabanlı authenticated e2e testleri (`test:e2e:emulator`) ayrı bir workflow'da (`.github/workflows/e2e.yml`) çalışır ve `deploy` işini engellemez.

## Mimari

**Katmanlar**: `src/components` (UI, route'lar `App.tsx`'te `lazy()` ile yükleniyor) → `src/services` (Firestore CRUD + iş mantığı) → `src/store` (Zustand) → Firebase (`src/firebase.ts`). `src/services/useAppHandlers.ts` App seviyesindeki tüm CRUD/durum-geçiş handler'larını tek merkezde toplayan hook'tur — yeni bir görev aksiyonu eklerken önce buraya bakın.

**İki store, iki amaç** (ikisini birbirine karıştırmayın):
- `src/store/dataStore.ts` — sunucudan gelen veri (`tasks`/`users`/`blockers`/`stats`), `idb-keyval` ile IndexedDB'ye persist edilir. `hasLiveData` bayrağı, IDB rehydration'ın (async, yavaş olabilir) Firestore'dan çoktan gelmiş taze `onSnapshot` verisini bayat önbellekle ezmesini engeller (`mergeDataState`).
- `src/store/uiStore.ts` — ekran/UI durumu (aktif tab, modal'lar, toast'lar, filtreler).

**Offline-first**: Mutasyonlar önce `src/lib/offlineQueue.ts` (`localStorage` tabanlı kuyruk) üzerinden kaydedilir, bağlantı geldiğinde senkronize edilir. Kuyruk (küçük/geçici mutasyon listesi) ile `dataStore`'un IndexedDB persist'i (büyük state) bilinçli olarak ayrı katmanlardır. Eşzamanlı çakışan güncellemeler `lockVersion` alanı ile optimistic locking olarak tespit edilir (`VERSION_MISMATCH`, bkz. `src/services/conflictDetectionService.ts`).

**Görev durum makinesi** (`TaskStatus`, bkz. `firestore.rules` `isValidTransition`): `ASSIGNED → IN_PROGRESS | BLOCKED | CANCELLED | PENDING_DELEGATION`, `PENDING_DELEGATION → IN_PROGRESS | BLOCKED | CANCELLED`, `IN_PROGRESS → BLOCKED | AWAITING_APPROVAL | COMPLETED | CANCELLED | CRISIS | PENDING_DELEGATION`, `BLOCKED → IN_PROGRESS | CANCELLED`, `AWAITING_APPROVAL → COMPLETED | IN_PROGRESS | CANCELLED`, `CRISIS → IN_PROGRESS | CANCELLED | COMPLETED | AWAITING_APPROVAL`. `COMPLETED` ve `CANCELLED` terminaldir (kendilerinden çıkış yok, `sameStatus` no-op'u hariç) — `CANCELLED` hedefi her aktif durumun kendi listesinde ayrı ayrı yer alır, evrensel bir kısayol olarak DEĞİL (bkz. kod denetimi: eskiden böyle bir kısayol vardı ve COMPLETED bir görevin bile iptal edilebilmesine yol açıyordu). Geçiş kuralları hem client (`src/lib/taskStateMachine.ts` → `transitionTaskInTransaction`, bkz. `taskService.ts`) hem de Firestore Rules'ta ayrı ayrı uygulanır — birini değiştirirken diğerini de güncelleyin. İstisna: `functions/src/scheduledAudit.ts`, atıl-görev denetiminde Admin SDK ile (rules'ı bypass ederek) bu tablonun dışındaki durumlardan da (BLOCKED/AWAITING_APPROVAL/PENDING_DELEGATION) doğrudan `CRISIS`'e geçiş yapabilir — bilinçli, yalnızca sistem tetiklemeli bir istisnadır, client hiçbir zaman bunu manuel tetikleyemez. Ayrıca `firestore.rules`'ta insan `Admin` rolü `isValidTransition(...) || isAdmin()` ile HER geçişi override edebilir — bu, yukarıdaki `scheduledAudit.ts` istisnasından farklı, ikinci ve ayrı bir istisnadır.

**Firestore güvenlik kuralları** (`firestore.rules`): default-deny, custom claims tabanlı rol kontrolü (Admin/Manager/Staff), departman bazlı görünürlük, alan bazlı (field-level) yazma izinleri ve yukarıdaki state-machine doğrulaması burada da ayrıca uygulanır. `@firebase/eslint-plugin-security-rules` bu dosyayı `npm run eslint` kapsamında lint eder.

**Cloud Functions** (`functions/src/`): `taskTriggers.ts` (görev tetikleyicileri), `scheduledAudit.ts` (zamanlanmış denetim), `cleanup.ts` (temizlik). Ana `src/` derlemesine dahil değildir, ayrı bir TS projesidir.

**SLA/deadline hesaplama** (`src/lib/sla.ts`): iş günü bazlı deadline hesaplama; `BLOCKED`/`AWAITING_APPROVAL` gibi duraklama durumlarında geçen süre deadline hesabından ayrıştırılır.

**Vite build** (`vite.config.ts`): `recharts` ve `jspdf` bilinçli olarak `manualChunks`'a değil, `chunkFileNames` üzerinden isimlendirilmiş dinamik chunk'lara yönlendiriliyor — bunları `manualChunks`'a koymak Rollup'ın ana giriş dosyasına statik import eklemesine yol açıyordu (Dashboard/Reports'un `lazy()` sınırını bozuyordu). Bu chunk isimlendirme mantığını değiştirirken `.size-limit.json`'daki glob'ların hâlâ eşleştiğini doğrulayın.

**`server.js`**: `npm run dev`/`start` doğrudan `vite` yerine bunu kullanır — dev modda Vite'ı middleware olarak express'e bağlar, prod modda `dist/`'i statik servis eder + SPA fallback yapar. Ayrıca `/api/health` endpoint'i sağlar.

**Config**: Client Firebase config (`apiKey`, `projectId` vb.) `firebase-applet-config.json`'da tutulur; `.env`'deki `VITE_FIREBASE_*` değişkenleri bunu override edebilir. `FIREBASE_PRIVATE_KEY`/`FIREBASE_CLIENT_EMAIL` gibi Admin SDK alanları yalnızca server-side (Cloud Functions) içindir, client bundle'a asla dahil edilmemeli.

**Test ortamı**: Vitest + jsdom + Testing Library, `src/test/setup.ts` Firebase modüllerini global olarak mock'lar (gerçek bağlantı gerekmez). Path alias: `@/*` → proje kökü (`tsconfig.json`/`vite.config.ts`).
