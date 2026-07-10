/**
 * Exponential Backoff Transaction and Mutation retry wrapper for network resiliency.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T>, 
  maxRetries = 3, 
  initialDelay = 500
): Promise<T> {
  let attempt = 0;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(`[Retry Engine] All ${maxRetries} attempts failed. Throwing error.`, error);
        throw error;
      }
      
      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.warn(`[Retry Engine] Attempt ${attempt} failed. Retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
