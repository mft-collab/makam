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
  detectConflict(error: unknown, taskId: string, taskTitle: string, expectedVersion: number): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    
    // Firestore transaction çakışması veya permission denied (version mismatch simülasyonu)
    const isConflict = 
      msg.includes('ABORTED') ||
      msg.includes('contention') ||
      msg.includes('lock') ||
      msg.includes('version');

    if (isConflict) {
      this.notify({
        taskId,
        taskTitle,
        expectedVersion,
        serverVersion: expectedVersion + 1, // Gerçek değer Firestore'dan gelmeli
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
