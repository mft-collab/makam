/**
 * Web Haptic feedback helper utility for iOS / Android tactile response simulation.
 */
export const triggerHaptic = (type: 'light' | 'medium' | 'success' | 'error') => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      switch (type) {
        case 'light':
          navigator.vibrate(8);
          break;
        case 'medium':
          navigator.vibrate(15);
          break;
        case 'success':
          navigator.vibrate([10, 30, 10]);
          break;
        case 'error':
          navigator.vibrate([20, 50, 20]);
          break;
      }
    } catch {
      // Ignore vibration errors if restricted by browser security policies
    }
  }
};
