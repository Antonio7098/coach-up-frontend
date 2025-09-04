// Retry utility for API calls with exponential backoff
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
  endpoint?: string; // For metrics
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    shouldRetry = defaultShouldRetry,
    endpoint = url.split('/').pop() || 'unknown'
  } = retryOptions;

  const method = options.method || 'GET';
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();

    try {
      const response = await fetch(url, options);
      const attemptDuration = Date.now() - attemptStart;

      // Success - return the response
      if (response.ok) {
        return response;
      }

      // Check if we should retry based on status
      if (shouldRetry({ status: response.status, response }, attempt)) {
        if (attempt < maxAttempts) {
          const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          try {
            console.warn(`[retry] Attempt ${attempt} failed (${response.status}), retrying in ${delay}ms: ${url}`);
          } catch {}
          await sleep(delay);
          continue;
        }
      }

      // Don't retry or max attempts reached
      return response;

    } catch (error) {
      lastError = error;

      // Network errors - always retry unless max attempts reached
      if (attempt < maxAttempts && isNetworkError(error)) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        try {
          console.warn(`[retry] Attempt ${attempt} network error, retrying in ${delay}ms: ${url}`, error);
        } catch {}
        await sleep(delay);
        continue;
      }

      // Max attempts reached or non-retryable error
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error('Max retry attempts exceeded');
}

function defaultShouldRetry(error: any, attempt: number): boolean {
  // Retry on 404 (temporary routing issues), 5xx server errors, and rate limiting
  if (error.status) {
    return error.status === 404 || error.status >= 500 || error.status === 429;
  }
  return false;
}

function isNetworkError(error: any): boolean {
  // Check for common network error patterns
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('fetch') ||
         message.includes('network') ||
         message.includes('timeout') ||
         message.includes('econn') ||
         message.includes('enotfound') ||
         error instanceof TypeError; // fetch network errors are TypeErrors
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
