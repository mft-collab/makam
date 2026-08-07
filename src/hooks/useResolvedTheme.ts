import { useEffect, useState } from 'react';

/**
 * index.html'deki FOUC-önleyici script ve App.tsx'teki tema efekti,
 * `system` tercihini çözümleyip document.documentElement'e senkron olarak
 * 'dark'/'light' sınıfını yazıyor — bu hook o tek doğruluk kaynağını okur,
 * kendi matchMedia mantığını tekrarlamaz.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const [resolved, setResolved] = useState<'light' | 'dark'>(
    () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  );

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setResolved(root.classList.contains('dark') ? 'dark' : 'light');
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return resolved;
}
