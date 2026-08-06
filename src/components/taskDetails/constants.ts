import type { Task } from '../../types';

export const EVIDENCE_TYPE_OPTIONS: { value: NonNullable<Task['evidenceType']>; label: string }[] = [
  { value: 'Link', label: 'Bağlantı' },
  { value: 'Image', label: 'Görsel' },
  { value: 'PDF', label: 'PDF' },
];

export const MAX_EVIDENCE_FILE_BYTES = 5 * 1024 * 1024; // storage.rules ile aynı sınır
