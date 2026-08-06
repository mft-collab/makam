/**
 * Optimistic Locking ile Çakışma Tespit ve Çözüm Servisi
 * 
 * Makam, görev güncellemelerinde lockVersion kullanır.
 * İki kullanıcı aynı görevi aynı anda düzenlerse, ikincisi
 * "version mismatch" hatası alır ve kullanıcı uyarılır.
 */

export interface ConflictInfo {
  taskId: string;
  taskTitle: string;
  expectedVersion: number;
  serverVersion: number;
}

type ConflictHandler = (info: ConflictInfo) => void;

class ConflictDetectionService {
  private handlers: ConflictHandler[] = [];

  /**
   * Çakışma bildirimi için handler kaydeder.
   * App.tsx veya ilgili bileşenler kullanır.
   */
  subscribe(handler: ConflictHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  /**
   * Firestore güncelleme hatasından çakışma tespiti.
   * taskService.ts içinde çağrılır.
   */
  detectConflict(error: unknown, taskId: string, taskTitle: string, expectedVersion: number, serverVersion?: number): boolean {
    const msg = error instanceof Error ? error.message : String(error);

    // Firestore transaction çakışması veya versiyon uyuşmazlığı — VERSION_MISMATCH
    // formatı taskService.ts'te büyük harfle atılıyor, önceki 'version' (küçük harf)
    // kontrolü hiçbir zaman eşleşmiyordu ve bu bildirim asla tetiklenmiyordu.
    const isConflict =
      msg.includes('VERSION_MISMATCH') ||
      msg.includes('ABORTED') ||
      msg.includes('contention') ||
      msg.includes('lock');

    if (isConflict) {
      this.notify({
        taskId,
        taskTitle,
        expectedVersion,
        serverVersion: serverVersion ?? expectedVersion + 1, // Hata mesajından parse edilemezse tahmini yedek
      });
      return true;
    }
    return false;
  }

  private notify(info: ConflictInfo) {
    console.warn(`[ConflictDetection] Çakışma tespit edildi: görev=${info.taskId}, beklenen versiyon=${info.expectedVersion}`);
    this.handlers.forEach(h => h(info));
  }
}

export const conflictDetectionService = new ConflictDetectionService();
