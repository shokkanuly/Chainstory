// Shared HTTP Client with rate-limiting, exponential backoff, and AbortSignal

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export async function fetchWithBackoff<T = any>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const {
    timeoutMs = 15000,
    maxRetries = 3,
    retryDelayMs = 1000,
    signal: userSignal,
    ...fetchInit
  } = options;

  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const combinedSignal = userSignal
      ? anySignal([userSignal, controller.signal])
      : controller.signal;

    try {
      const res = await fetch(url, {
        ...fetchInit,
        signal: combinedSignal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxRetries) {
          throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
        }
        const delay = retryDelayMs * Math.pow(2, attempt);
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as T;
      return data;
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError' && userSignal?.aborted) {
        throw err;
      }
      if (attempt === maxRetries) {
        throw err;
      }
      const delay = retryDelayMs * Math.pow(2, attempt);
      await sleep(delay);
      attempt++;
    }
  }

  throw new Error(`Failed after ${maxRetries} retries`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
