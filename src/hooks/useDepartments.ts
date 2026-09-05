import { useEffect, useState } from 'react';
import { departmentService } from '../services/departmentService';
import type { Department, User } from '../types';

/**
 * departments koleksiyonunun canlı listesi.
 *
 * useFirestoreData.ts'e EKLENMEDİ, ayrı ve küçük tutuldu: o hook'un iki
 * effect'i de dataStore'a (IndexedDB persist) bağlıdır ve tasks/users/blockers
 * gibi büyük, offline'da gerekli veri kümeleri içindir. Departman listesi
 * küçük, nadiren değişen ve türetilebilir bir sözlüktür — kalıcı önbelleğe
 * yazmak için bir gerekçe yok (YAGNI), ayrıca oradaki effect bağımlılıklarına
 * dokunmak "Daha Fazla Yükle" akışındaki listener yeniden-kurulum dengesini
 * gereksizce riske atardı.
 *
 * DİKKAT: AuthenticatedApp.tsx'te ayrıca users/tasks kayıtlarından TÜRETİLEN
 * bir `departments` useMemo'su vardır (AppHeader'ın "Birim Odak Filtresi"ni
 * besler). O, salt-okunur bir filtre olduğundan ve geçmiş kayıtlardaki
 * departmanları da göstermesi gerektiğinden BİLİNÇLİ olarak yerinde bırakıldı;
 * bu hook yalnızca departman ATAMA akışlarını (TeamList, TaskFormModal) besler.
 */
export function useDepartments(
  user: User | null,
  onError: (err: unknown, type: string, path: string) => void
): Department[] {
  const [departments, setDepartments] = useState<Department[]>([]);
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) {
      // Çıkışta önceki kullanıcının listesi bellekte kalmasın (dataStore.reset
      // ile aynı gerekçe, bkz. useFirestoreData.ts).
      setDepartments([]);
      return;
    }
    const unsubscribe = departmentService.subscribe(
      setDepartments,
      (error) => onError(error, 'list', 'departments')
    );
    return () => unsubscribe();
  }, [uid, onError]);

  return departments;
}
