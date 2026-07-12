/**
 * logger — Geliştirme ortamına özel, prod build'de sessiz kalan konsol sarmalayıcısı.
 *
 * `debug`/`info` yalnızca `import.meta.env.DEV` true iken konsola yazar (Vite
 * production build'inde tree-shake ile tamamen elenir). `warn`/`error` gerçek
 * sorunlara işaret ettiği ve destek/debug sürecinde faydalı olduğu için
 * ortamdan bağımsız her zaman yazar — ciddi hatalar ayrıca `errorLoggingService`
 * ile Firestore'a da kaydedilir.
 */
const isDev = import.meta.env.DEV;

export const logger = {
  debug(...args: unknown[]) {
    if (isDev) console.log(...args);
  },
  info(...args: unknown[]) {
    if (isDev) console.info(...args);
  },
  warn(...args: unknown[]) {
    console.warn(...args);
  },
  error(...args: unknown[]) {
    console.error(...args);
  },
};
