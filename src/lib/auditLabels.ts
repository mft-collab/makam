// Denetim izi (audit log) alan-bazlı diff görselleştirmesinde kullanılan
// Türkçe etiket haritası. TaskDetails.tsx (görev geçmişi sekmesi) ve
// TeamList.tsx (kullanıcı detay modalı, denetim izi sekmesi) ile paylaşılır.
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  status: 'Durum', title: 'Başlık', description: 'Açıklama',
  assigneeId: 'Sorumlu', coordinatorId: 'İrtibatlı',
  priority: 'Öncelik', deadline: 'Son Tarih', evidence: 'Kanıt',
  deleted: 'Silindi', tags: 'Etiketler', estimatedHours: 'Tahmini Süre'
};
