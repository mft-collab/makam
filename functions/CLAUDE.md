# Cloud Functions (functions/)

`functions/` kök projeden bağımsız, ayrı bir npm paketidir (`makam-functions`, kendi `npm install`/`npm run build` gerektirir; `firebase-functions/v1` API'si kullanılır). Kök `CLAUDE.md`'deki ana `src/` derlemesine dahil değildir. Deploy CI/CD pipeline'ının dışındadır — `.github/workflows/ci.yml` yalnızca `hosting`/`firestore:rules,indexes` deploy eder, fonksiyonlar her zaman elle deploy edilir: `cd functions && npm run deploy` (`firebase deploy --only functions`).

**⚠️ Proje şu an Spark (ücretsiz) planda — `npm run deploy` bugün itibarıyla ÇALIŞMAZ.** `firebase deploy --only functions...` teorik değil, GERÇEKTEN Blaze (kullandıkça öde) planı ister; Spark'ta `artifactregistry.googleapis.com`/`cloudbuild.googleapis.com` etkinleştirilemediğinden deploy `Error: Your project ... must be on the Blaze plan` ile başarısız olur (bkz. P0-1/P0-2 departman taşıması sırasında doğrulandı, 2026-09-05 — projede o tarih itibarıyla TEK bir fonksiyon bile deploy edilmiş değildi). Blaze'e geçmeden önce fonksiyon deploy etmeyi denemeyin; kullanıcıya önce `https://console.firebase.google.com/project/<PROJECT_ID>/usage/details` üzerinden yükseltmesi gerektiğini söyleyin — bu bir faturalandırma kararıdır, sizin adınıza yapamazsınız.

```bash
npm run build   # tsc -> lib/
npm run serve   # build + firebase emulators:start --only functions
npm run shell   # build + firebase functions:shell
npm run deploy  # firebase deploy --only functions
npm run logs    # firebase functions:log
```

Bu klasörün kendi test altyapısı yok; doğruluk emulator/canlı log ile doğrulanır. **Tek istisna** `departmentBackfillCore.ts`'tir: mantığı kök projedeki `tests/emulator/backfillDepartments.test.ts` tarafından gerçek Firestore emulator'ına karşı test edilir (`npm run test:rules` ile koşar). Bu ancak o dosya **`firebase-functions` ithal etmediği** için mümkün — kök `tsconfig.json` `functions/**`'ı hariç tutsa da import edilen dosyalar programa dahil edildiğinden, `firebase-functions` içeren bir modülü kök projeden import etmek CI'da (yalnızca kök `node_modules` kurulu) `tsc --noEmit`'i kırar. Aynı deseni tekrarlamak isterseniz: saf mantığı `firebase-admin`'e bağlı ayrı bir dosyaya, callable/trigger sarmalayıcısını yanına koyun.

`firebase-functions/v1` (v2 değil) API'si kullanılır; yeni fonksiyon eklerken mevcut dosyalardaki `functions.region('europe-west1').pubsub/firestore...` deseninden sapmayın.

## `src/index.ts` — tüm export'lar burada toplanır

```
scheduledDailyAudit          (scheduledAudit.ts)
onTaskCreated, onTaskStatusChanged  (taskTriggers.ts)
cleanupOldNotifications       (cleanup.ts)
scheduledStatsReconciliation  (statsReconciliation.ts)
backfillDepartments           (backfillDepartments.ts — tek seferlik taşıma)
```

## `scheduledAudit.ts` — atıl görev denetimi (her gün 08:00 Europe/Istanbul)

24 saattir güncellenmemiş, `COMPLETED`/`CANCELLED`/`CRISIS` dışındaki görevleri `CRISIS`'e alır ve Admin/Manager rolündeki kullanıcılara bildirim yazar. Bilinçli tasarım noktaları:

- **Sayfalama imleci** (`system/auditCursor`): koleksiyon `MAX_TASKS_PER_RUN` (500) üzerindeyse kalan görevler ertesi günkü koşuya devredilir — tek seferde tüm koleksiyonu taramaya çalışıp Spark kotasını zorlamaz. Sorgu `orderBy('status').orderBy(documentId())` kullanır çünkü Firestore, `not-in` eşitsizlik filtresiyle aynı alanda `orderBy` zorunlu kılar; `documentId()` ikincil sıralama koşular arası determinizm sağlar.
- **`taskStateMachine`'den kasıtlı sapma**: client/`firestore.rules`'taki `isValidTransition` yalnızca `IN_PROGRESS→CRISIS`'e izin verir; bu fonksiyon (Admin SDK ile rules'ı bypass ederek) `BLOCKED`/`AWAITING_APPROVAL`/`PENDING_DELEGATION`'dan da doğrudan `CRISIS`'e geçebilir — bilinçli, yalnızca sistem tetiklemeli bir istisna. UI/client bunu asla manuel tetikleyemez.
- **`pausedAt`/`totalPausedTime` senkronu**: `src/services/taskService.ts` (`transitionTaskInTransaction`) ile AYNI kuralı burada da uygular — atlanırsa SLA sayacı (`src/lib/sla.ts`) görev ilerlese bile sonsuza dek "duraklatıldı" görünür.
- Zaten `CRISIS`'te olan görevler filtrelenir — aksi halde her gün anlamsız `CRISIS→CRISIS` audit kaydı ve gereksiz `lockVersion` artışı (sahte `VERSION_MISMATCH`'e yol açabilir).
- Batch'ler 450 işlemde bölünür (Firestore'un 500 limiti altında güvenlik payı) — hem görev güncellemeleri hem bildirim yazımı için ayrı ayrı.

## `taskTriggers.ts` — `onTaskCreated` / `onTaskStatusChanged`

`resolveUid()`: `assigneeId`/`coordinatorId` bazen UID bazen (ilk kez giriş yapmamış davetli için) e-posta string'i olabilir — bu fonksiyon e-postayı `users` koleksiyonundan gerçek UID'ye çözer. Yeni bir trigger'da bu alanlara yazarken/okurken önce `resolveUid` kullanmayı düşünün.

`completedTaskCount` güncellemesi bildirim batch'inden **kasıtlı olarak ayrı**, kendi `try/catch`'inde: `resolveUid` başarısız olursa veya hedef `users/{id}` yoksa bildirim yazımını iptal etmesin diye. Admin bir görevi `COMPLETED→IN_PROGRESS` şeklinde yeniden açabildiğinden (`isValidTransition` override'ı), sayaç hem artış hem azalış yönünde güncellenir — tek yönlü increment çift sayıma yol açar.

## `cleanup.ts` — haftalık temizlik (her Pazar 02:00 Europe/Istanbul)

30 günden eski okunmuş bildirimleri ve 90 günden eski `system_logs` kayıtlarını siler. `deleteOldDocs()` ortak silme yardımcısıdır — yeni bir TTL'li koleksiyon eklerken bunu kullanın, döngüyü kopyalamayın. `MAX_BATCHES_PER_COLLECTION` (20×500) üst sınırı `scheduledAudit.ts`'teki imleç korumasıyla aynı mühendislik yaklaşımı: sınır aşılırsa kalan kayıtlar bir sonraki haftalık koşuya gecikir, hiçbir zaman kalıcı olarak atlanmaz.

## `statsReconciliation.ts` — günlük mutabakat (her gün 03:30 Europe/Istanbul)

`system/stats`'teki `totalTasks`/`status_X` sayaçları client (`taskService.ts`) ve `scheduledAudit.ts` tarafından birbirinden bağımsız `increment()`/`decrement()` ile güncellenir (tek atomik yazım yok) — bu fonksiyon Firestore `count()` agregasyon sorgularıyla (ucuz, doküman sayısından bağımsız maliyetli) gerçek durumu yeniden hesaplayıp sapma varsa `system/stats`'i **tamamen üzerine yazar** (increment değil, `set` + `merge:true`). Kasıtlı olarak `scheduledDailyAudit`'in 08:00 koşusundan farklı saatte çalışır ki aynı dokümana çakışan yazımlar azalsın. `TASK_STATUSES` dizisi `src/types.ts`'teki `TaskStatusSchema` (zod) ile **aynı liste** olmalı — ayrı bir TS projesi olduğundan burada düz dizi olarak tekrarlanır; yeni bir durum eklerken iki tarafı da güncelleyin.

## `backfillDepartments.ts` + `departmentBackfillCore.ts` — tek seferlik departman taşıması

Admin-only callable (P0-1/P0-2). (a) `users`+`tasks` içindeki tüm distinct `departmentId` değerleri için eksik `departments/{value}` dokümanlarını oluşturur, (b) departmanı eksik/null/boş olan her görevi **sorumlusunun** güncel departmanıyla doldurur; sorumlu da departmansızsa `Genel` birimine düşürür. Bilinçli tasarım noktaları:

- **Çalıştırma sırası kritiktir** — `tasks` okuma kuralındaki eski "departmanı yoksa serbest" fallback'leri kaldırılmadan ÖNCE koşmalıdır, aksi halde departmansız görevler sorumlusu dışında herkes için görünmez olur. Tam adım listesi, doğrulama script'i ve geri alma: **`BACKFILL_RUNBOOK.md`**.
- **İdempotent**: var olan departman dokümanı yeniden yazılmaz (kuraldaki `createdAt` değişmezliği zaten reddederdi), departmanı dolu görev güncellenmez.
- **`updatedAt`/`lockVersion`'a dokunmaz**: bu bir veri taşımasıdır, kullanıcı eylemi değil. `updatedAt` ilerletmek `scheduledAudit`'in "24 saattir atıl" denetimini sıfırlar ve listelerde gerçek aktiviteyi gizler; `lockVersion` artırmak açık istemcilerde sahte `VERSION_MISMATCH` üretir.
- **Varsayılan birimin ID'si ve `name`'i aynıdır (`Genel`)**: `firestore.rules` `isValidDepartment`, `name == doküman ID` eşitliğini zorunlu kılar. Admin SDK rules'ı bypass ettiğinden `genel`/`Genel` gibi sapmış bir doküman yazılabilirdi — ama bu, taşımanın kapattığı ad/değer sapmasını yeniden üretir ve dokümanı istemciden kalıcı olarak güncellenemez kılardı.
- `assigneeId` bazen UID bazen e-posta taşıdığından (bkz. `taskTriggers.ts` `resolveUid`) kullanıcı haritası **her iki anahtarla** kurulur — görev başına ayrı sorgu yapmamak için (Spark okuma kotası).
- Doküman ID'si olamayacak departman adları (`/`, `.`/`..`, `__x__`) atlanır ve sonuçta `skippedInvalidDepartmentNames` olarak raporlanır; elle düzeltilmeleri gerekir.

### Spark planda (deploy imkânsızken) elle çalıştırma deneyimi (2026-09-05)

`BACKFILL_RUNBOOK.md`'nin "Yöntem A — `firebase functions:shell`" önerisi **pratikte iki noktada tıkandı** ve gerçek üretimde şu şekilde aşıldı — aynı durumla (Admin-only bir callable'ı Spark planda, servis hesabı anahtarı oluşturma organizasyon politikasıyla engellenmişken elle tetikleme ihtiyacı) tekrar karşılaşırsanız buradan devam edin:

1. **`firebase functions:shell`, callable fonksiyonlarda `context.auth`'u SİMÜLE EDEMEZ** — bu Firebase'in resmi dokümantasyonunda açıkça belirtilir ("Emulation of context.auth is currently unavailable"). `backfillDepartments({}, { auth: { uid: 'x', token: { admin: true } } })` gibi bir çağrı bu yüzden ya `Request body is missing data` (yanlış sözdizimi denemesi) ya da `assertCallerIsAdmin`'in `unauthenticated` reddiyle sonuçlanır — sözdizimini düzeltmek FARK ETMEZ, ikinci argüman hiçbir zaman `context.auth`'a dönüşmez. **Admin-only bir callable'ı `functions:shell` üzerinden elle test etmeyi/tetiklemeyi DENEMEYİN.**
2. Bunun yerine, callable sarmalayıcıyı tamamen atlayıp **saf mantığı** (`departmentBackfillCore.ts` — tam olarak bu yüzden `firebase-functions`'tan bağımsız tutuluyor, bkz. yukarısı) doğrudan çağıran, tek seferlik bir `.mjs` script'i yazıp production'a karşı çalıştırıp SİLİN (repoya commit etmeyin — bu bir operasyon script'i, kod tabanının parçası değil).
3. **Kimlik bilgisi**: servis hesabı anahtarı (`GOOGLE_APPLICATION_CREDENTIALS`) oluşturma bir organizasyon politikasıyla engellenmiş olabilir ("Key creation is not allowed on this service account"). Bu durumda `gcloud auth application-default login` da kuruluysa bir seçenektir, ama kurulu değilse: `firebase login` yapan kullanıcının OAuth refresh token'ı zaten firebase-tools tarafından ADC formatına çevrilip **otomatik olarak** şuraya yazılır: `%APPDATA%\firebase\<eposta>_application_default_credentials.json` (Windows) / `~/.config/firebase/<eposta>_application_default_credentials.json` (bkz. firebase-tools kaynağı `lib/defaultCredentials.js`, `getCredentialPathAsync`) — bu dosya `functions:shell`/`emulators:exec` gibi production'a dokunan herhangi bir komut ÇALIŞTIĞINDA kendiliğinden oluşur. Script'inizde `process.env.GOOGLE_APPLICATION_CREDENTIALS` ile bu dosyayı işaret edip `admin.initializeApp({ credential: applicationDefault(), projectId: '<PROJECT_ID>' })` kullanmak, servis hesabı anahtarına hiç ihtiyaç duymadan gerçek Admin SDK erişimi sağlar (kullanıcının kendi OAuth kimliğiyle, `cloud-platform` scope'u yeterli).
4. İşiniz bitince bu dosyayı silin (`rm "$APPDATA/firebase/<eposta>_application_default_credentials.json"`) ve isteğe bağlı olarak `firebase logout` ile CLI oturumunu kapatın — bu, servis hesabı anahtarından farklı olarak kullanıcının KİŞİSEL Google hesap kimliğidir, gereksiz yere diskte açık kalmamalı.
5. Her elle production yazımından sonra AYNI `BACKFILL_RUNBOOK.md` Adım 3'teki salt-okunur doğrulama script'ini (yine bu ADC yöntemiyle) çalıştırıp gerçekten sıfır sorunlu kayıt kaldığını teyit edin — script çıktısını commit/log olarak saklamaya gerek yok, ama kullanıcıya sonucu (rakamlarla) raporlayın.

## Model Seçimi (Claude Pro — verimli kullanım)

Bu klasördeki her fonksiyon Admin SDK ile `firestore.rules`'ı bypass ediyor ve zamanlanmış/tetiklenmeli olarak canlıda kendi başına çalışıyor — kök `CLAUDE.md`'deki genel eşikten daha düşük bir eşikle Opus'a geç (`/model opus` veya Agent çağrısında `model: "opus"`):

- **Riskli kod**: dört fonksiyonun hepsi (`scheduledAudit.ts`, `taskTriggers.ts`, `cleanup.ts`, `statsReconciliation.ts`) — özellikle state-machine istisnası (`scheduledAudit.ts`), dual-write sayaç senkronu (`statsReconciliation.ts`) ve hard-delete (`cleanup.ts`).
- **Planlama**: yeni bir zamanlanmış fonksiyon veya trigger eklerken (client'taki karşılığıyla, varsa `firestore.rules`'taki kısıtla tutarlılığını baştan tasarlamak gerekir).
- **Doğrulama**: bu dosyalardan birine dokunduktan sonra `npm run build` hatasız geçse bile ikinci bir gözle geçir — test yok, tek güvenlik ağı emulator/canlı log ve kod incelemesi. Deploy elle yapıldığından (`npm run deploy`), deploy komutunu çalıştırmadan önce mutlaka onay al.
