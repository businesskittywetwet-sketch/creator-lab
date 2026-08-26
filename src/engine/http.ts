/* Resilient HTTP client for engine workflows: timeouts, retries,     */
/* backoff, and classification of transient vs permanent failures.    */

export class HttpError extends Error {
  status: number;
  retryable: boolean;
  constructor(status: number, url: string, body?: string) {
    super(`HTTP ${status} for ${url}${body ? ` — ${body.slice(0, 160)}` : ""}`);
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

export class NetworkError extends Error {
  retryable = true;
}

export class SourceConfigError extends Error {
  retryable = false;
}

const DEFAULT_UA = "ViboroBot/1.0 (+content-ops; automated entertainment research)";

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const { retries = 2, baseDelayMs = 500, label = "request" } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof HttpError || err instanceof NetworkError
          ? err.retryable
          : true;
      if (!retryable || attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);
      console.warn(
        `[engine] ${label} failed (attempt ${attempt + 1}/${retries + 1}): ${
          err instanceof Error ? err.message : err
        } — retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function doFetch(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": DEFAULT_UA,
        accept: "*/*",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new NetworkError(
      `Network failure for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, url, body);
  }
  return res;
}

export async function fetchText(url: string, init?: RequestInit, timeoutMs?: number) {
  return (await doFetch(url, init, timeoutMs)).text();
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const res = await doFetch(url, init, timeoutMs);
  try {
    return (await res.json()) as T;
  } catch {
    throw new NetworkError(`Invalid JSON from ${url}`);
  }
}
