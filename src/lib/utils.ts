import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Timestamp } from 'firebase/firestore';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimeAgo(timestamp: number | Timestamp, status?: string) {
  const ms = timestamp instanceof Timestamp ? timestamp.toMillis() : timestamp;
  const diff = Date.now() - ms;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (status === 'COMPLETED') {
    if (days > 0) return `${days} Gün Önce İcra Edildi`;
    if (hours > 0) return `${hours} Saat Önce İcra Edildi`;
    return 'Az Önce İcra Edildi';
  }
  
  if (status === 'CANCELLED') {
    if (days > 0) return `${days} Gün Önce Lağvedildi`;
    if (hours > 0) return `${hours} Saat Önce Lağvedildi`;
    return 'Az Önce Lağvedildi';
  }

  if (days > 0) return `${days} Gündür Bekliyor`;
  if (hours > 0) return `${hours} Saattir Bekliyor`;
  return 'Yeni';
}

export function cleanData<T extends object>(obj: T): T {
  const result: any = { ...obj };
  Object.keys(result).forEach(key => {
    if (result[key] === undefined) {
      delete result[key];
    }
  });
  return result;
}
