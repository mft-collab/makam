// Yedek geri yükleme (restore) akışında kullanılan saf veri dönüştürme
// yardımcıları — Firestore'a yazmadan önce yedek JSON'unu temizler/normalize eder.

export const cleanDataObj = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => cleanDataObj(item));
  const n: any = {};
  Object.keys(obj).forEach(k => { if (obj[k] !== undefined) n[k] = cleanDataObj(obj[k]); });
  return n;
};

export const toTs = (val: any, fb?: number): number => {
  if (val == null) return fb ?? Date.now();
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime() || (fb ?? Date.now());
  if (typeof val === 'object' && 'seconds' in val) return val.seconds * 1000;
  return fb ?? Date.now();
};

export const pick = (obj: any, keys: string[]) => {
  const r: any = {};
  keys.forEach(k => { if (k in obj && obj[k] !== undefined) r[k] = obj[k]; });
  return r;
};
