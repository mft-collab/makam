/**
 * OfflineBanner — Çevrimdışı mod ve bekleyen kuyruk sayısını gösterir.
 * Sıfır state'te render edilmez (null).
 */
import React from 'react';

interface Props {
  isOffline: boolean;
  queueLength: number;
}

export function OfflineBanner({ isOffline, queueLength }: Props) {
  if (!isOffline && queueLength === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={
        isOffline
          ? 'Çevrimdışı mod aktif'
          : `${queueLength} değişiklik senkronize ediliyor`
      }
      className="bg-executive-gold/10 border-b border-executive-gold/20 py-2.5 px-6
                 flex items-center justify-between z-[200] relative backdrop-blur-md"
    >
      <div className="flex items-center gap-3.5 mx-auto max-w-[1440px] w-full">
        <span
          className="w-2 h-2 rounded-full bg-executive-gold animate-ping flex-shrink-0"
          aria-hidden="true"
        />
        <span className="text-[10px] font-medium text-executive-gold uppercase tracking-[0.25em] font-sans">
          {isOffline
            ? 'Çevrimdışı Mod — Resmî Kayıtlar Lokal Sıraya Alındı'
            : `${queueLength} Adet Değişiklik Sıraya Alındı, Senkronize Ediliyor...`}
        </span>
      </div>
    </div>
  );
}
