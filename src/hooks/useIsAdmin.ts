import type { User } from '../types';

/**
 * `currentUser?.role === 'Admin'` deseni App.tsx, Settings.tsx, TaskDetails.tsx
 * ve TeamList.tsx'te bağımsız bağımsız tekrarlanıyordu (bkz. kod denetimi) —
 * bu, YALNIZCA client-side UX kısayoludur; gerçek yetki sınırı her zaman
 * olduğu gibi firestore.rules'ta ayrıca ve bağımsız biçimde uygulanır.
 */
export function useIsAdmin(user: User | null | undefined): boolean {
  return user?.role === 'Admin';
}
