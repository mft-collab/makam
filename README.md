# MAKAM

Kurumsal görev, blocker ve SLA takip uygulaması. React 19 + TypeScript + Firebase üzerine kurulu, çevrimdışı çalışabilen (offline-first) bir Progressive Web App.

## Özellikler

- **Görev yönetimi**: Atama, öncelik, durum makinesi (`ASSIGNED → IN_PROGRESS → COMPLETED` vb.), checklist, etiketler, kanıt (evidence) ekleri.
- **SLA/deadline takibi**: İş günü bazlı deadline hesaplama, duraklama (blocked/awaiting-approval) sürelerinin ayrıştırılması.
- **Blocker yönetimi**: Görevleri engelleyen sebeplerin kaydı ve çözümü.
- **Rol tabanlı erişim**: Admin / Manager / Staff, departman bazlı görünürlük — bkz. `firestore.rules`.
- **Denetim kaydı (audit log)**: Görev üzerindeki değişikliklerin izlenmesi.
- **Çevrimdışı destek**: `localStorage` tabanlı mutasyon kuyruğu (`src/lib/offlineQueue.ts`) ve `idb-keyval` ile IndexedDB'ye persist edilen uygulama state'i (`src/store/dataStore.ts`), optimistic locking (`lockVersion`) ile senkronizasyon çakışması tespiti.
- **PWA**: Yüklenebilir uygulama, service worker ile önbellekleme (`vite-plugin-pwa`).
- **Bildirimler**: Firebase Cloud Messaging entegrasyonu.
- **Raporlama**: PDF export (`jspdf`) ve grafik (`recharts`) destekli yönetici raporları.

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Zustand |
| Backend | Firebase (Firestore, Auth, Storage, Cloud Functions, Cloud Messaging, App Check) |
| Test | Vitest (birim), Playwright (e2e), Testing Library |
| CI/CD | GitHub Actions → Firebase Hosting |

Proje şu an **Firebase Spark (ücretsiz) planında** çalışacak şekilde tasarlanmıştır — Cloud Functions ve entegrasyonlar bu sınırı göz önünde bulundurularak seçilmelidir.

## Kurulum

**Gereksinimler:** Node.js 20+

```bash
npm install
```

`.env.example` dosyasını `.env` olarak kopyalayıp Firebase proje bilgilerinizle doldurun:

```bash
cp .env.example .env
```

Client tarafı Firebase yapılandırması (`apiKey`, `projectId` vb.) `firebase-applet-config.json` içinde tutulur ve `.env`'deki `VITE_FIREBASE_*` değişkenleri bunu geçersiz kılabilir. `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL` gibi Admin SDK alanları yalnızca sunucu tarafı (Cloud Functions) için gereklidir ve asla client bundle'ına dahil edilmemelidir.

> Not: Proje şu an yerel bir Firebase Emulator Suite kurulumu içermiyor — geliştirme ortamı doğrudan `.env`'de belirtilen Firebase projesine bağlanır. Gerçek verilerle çalışırken dikkatli olun.

## Geliştirme

```bash
npm run dev        # Geliştirme sunucusunu başlatır (server.js üzerinden)
npm run build       # Production build (dist/)
npm run lint         # TypeScript tip kontrolü (tsc --noEmit)
npm run eslint       # ESLint (kod kalitesi + a11y + Firestore rules kuralları)
npm test             # Vitest birim testleri
npm run test:coverage # Kapsam raporu
```

E2E testleri (Playwright) için:

```bash
npx playwright test
```

## Mimari Notları

- **Offline-first**: Veri değişiklikleri önce yerel kuyruğa (`src/lib/offlineQueue.ts`, `localStorage`) yazılır, bağlantı geldiğinde senkronize edilir. Uygulama state'i (`tasks`/`users`/`blockers`) ayrıca `idb-keyval` ile IndexedDB'ye persist edilir (`src/store/dataStore.ts`) — iki farklı depolama katmanı bilinçli olarak ayrı amaçlara hizmet eder: kuyruk küçük/geçici mutasyon listesidir, state persist ise büyük veri setleri için IndexedDB'nin senkron olmayan, daha yüksek kapasiteli yapısından faydalanır. Çakışan eşzamanlı güncellemeler `lockVersion` alanı üzerinden optimistic locking ile tespit edilir (`VERSION_MISMATCH`).
- **Firestore güvenlik kuralları** (`firestore.rules`): Default-deny, custom claims tabanlı rol kontrolü, görev durum geçişleri için state-machine doğrulaması, alan bazlı (field-level) yazma izinleri.
- **Cloud Functions** (`functions/src`): Görev tetikleyicileri, zamanlanmış denetim (audit) işleri, temizlik (cleanup) görevleri.

## Deploy

`main` branch'ine yapılan push'lar GitHub Actions üzerinden otomatik olarak Firebase Hosting'e deploy edilir (bkz. `.github/workflows/ci.yml`). Pull request'ler için ayrı bir preview channel oluşturulur. Pipeline sırası: güvenlik taraması → lint/test → build → deploy.

## Lisans

Bu yazılım özel (proprietary) lisanslıdır — bkz. [LICENSE](LICENSE). Tüm hakları saklıdır.
