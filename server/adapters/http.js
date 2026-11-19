// server/adapters/http.js
// Shared resilient HTTP helper for data-source adapters.
// Zero dependencies: Node built-ins + global fetch only.
//
// Design goals:
//  - Never throw for expected failure modes (network errors, timeouts, HTTP
//    errors, open circuit, aborted signal): always return a structured result.
//  - Hard per-attempt timeout via AbortController.
//  - Bounded exponential backoff with jitter on network errors and 429/5xx;
//    Retry-After (seconds or HTTP-date) is respected when present.
//  - 4xx other than 429 is never retried (and does not trip the breaker:
//    a client error is not a source outage).
//  - Per-source circuit breaker: opens after N consecutive failures, rejects
//    fast during cooldown, then allows a single half-open probe.
//  - Identical in-flight URLs are coalesced into one network request.
//  - Optional per-origin rate limiting (minimum interval between starts).

const MAX_BACKOFF_MS = 30_000; // upper bound for computed backoff
const MAX_RETRY_AFTER_MS = 60_000; // sanity cap for server-sent Retry-After

/** Parse JSON without throwing. Returns null for any invalid/empty input. */
export function parseJsonSafe(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Promise-based sleep (real timers; tests keep intervals small). */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a rate limiter enforcing a minimum interval between acquisitions.
 * `now` is injectable for deterministic tests of the scheduling math.
 */
export function createRateLimiter({ minIntervalMs = 250, now = Date.now } = {}) {
  let nextSlot = 0; // earliest timestamp (ms) at which the next request may start
  return {
    /** Resolves when a slot is available; reserves the slot immediately. */
    async acquire() {
      const t = now();
      const waitMs = Math.max(0, nextSlot - t);
      nextSlot = Math.max(t, nextSlot) + minIntervalMs;
      if (waitMs > 0) await sleep(waitMs);
    },
    /** Test/introspection helper: ms until the next free slot (0 if free). */
    msUntilFree() {
      return Math.max(0, nextSlot - now());
    },
  };
}

/**
 * Create a circuit breaker.
 * States: closed -> open (after failureThreshold consecutive failures)
 *         open -> half-open (one probe allowed after cooldownMs)
 *         half-open -> closed on probe success, open again on probe failure.
 * `now` is injectable so tests can advance time without waiting.
 */
export function createCircuitBreaker({ failureThreshold = 3, cooldownMs = 60_000, now = Date.now } = {}) {
  let state = 'closed';
  let consecutiveFailures = 0;
  let openedAt = 0;
  let probeInFlight = false;

  return {
    get state() {
      // Report half-open once cooldown elapsed, even before the probe is taken.
      if (state === 'open' && now() - openedAt >= cooldownMs) return 'half-open';
      return state;
    },
    /** True if a request may proceed right now. */
    allowRequest() {
      if (state === 'closed') return true;
      if (now() - openedAt >= cooldownMs) {
        if (!probeInFlight) {
          probeInFlight = true; // only ONE half-open probe at a time
          return true;
        }
        return false;
      }
      return false; // still cooling down: reject fast
    },
    recordSuccess() {
      state = 'closed';
      consecutiveFailures = 0;
      probeInFlight = false;
    },
    recordFailure() {
      if (probeInFlight) {
        // Half-open probe failed: reopen and restart the cooldown.
        state = 'open';
        openedAt = now();
        probeInFlight = false;
        consecutiveFailures = failureThreshold;
        return;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= failureThreshold) {
        state = 'open';
        openedAt = now();
      }
    },
  };
}

// --- module-level shared state -------------------------------------------

// In-flight request coalescing: url -> Promise<result>.
const inFlight = new Map();
// Per-origin rate limiters: origin -> { limiter, minIntervalMs }.
const originLimiters = new Map();

function getOriginLimiter(url, minIntervalMs) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = url; // unparseable URL: key on the raw string
  }
  let entry = originLimiters.get(origin);
  if (!entry || entry.minIntervalMs !== minIntervalMs) {
    entry = { limiter: createRateLimiter({ minIntervalMs }), minIntervalMs };
    originLimiters.set(origin, entry);
  }
  return entry.limiter;
}

/** Parse Retry-After (delta-seconds or HTTP-date) into ms; null if absent/bad. */
function retryAfterMs(headers, now) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  if (raw == null || raw === '') return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, Math.min(secs * 1000, MAX_RETRY_AFTER_MS));
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, Math.min(dateMs - now(), MAX_RETRY_AFTER_MS));
  return null;
}

/** Exponential backoff with +/-25% jitter, bounded. */
function backoffDelay(attemptIndex, backoffMs) {
  const base = Math.min(backoffMs * 2 ** attemptIndex, MAX_BACKOFF_MS);
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(base * jitter);
}

function failureResult({ status = 0, body = '', error, attempts, startedAt, now }) {
  return {
    ok: false,
    status,
    body,
    json: parseJsonSafe(body),
    error,
    attempts,
    durationMs: Math.max(0, now() - startedAt),
  };
}

/**
 * Fetch a URL with timeout, retries, backoff, circuit breaking, rate limiting
 * and in-flight coalescing. Never throws for expected failure modes.
 *
 * Returns { ok, status, body, json, error, attempts, durationMs }:
 *  - ok: true only for a 2xx response whose body was read successfully
 *  - status: HTTP status (0 for network/timeout/circuit failures)
 *  - body: response text ('' when unavailable)
 *  - json: parsed body via parseJsonSafe, or null
 *  - error: null on success, otherwise a short machine-readable string
 *  - attempts: number of network attempts made (0 when rejected fast)
 *  - durationMs: wall time measured with the injected `now`
 */
export async function resilientFetch(url, {
  fetchImpl = fetch,
  timeoutMs = 15_000,
  retries = 2,
  backoffMs = 500,
  rateLimitMs = 0,
  circuitBreaker,
  signal,
  headers,
  now = Date.now,
} = {}) {
  const startedAt = now();

  // Caller already aborted: fail fast without touching the network.
  if (signal && signal.aborted) {
    return failureResult({ error: 'aborted', attempts: 0, startedAt, now });
  }

  // Circuit breaker: reject fast while open (no attempt consumed).
  if (circuitBreaker && !circuitBreaker.allowRequest()) {
    return failureResult({ error: 'circuit_open', attempts: 0, startedAt, now });
  }

  // Coalesce identical in-flight URLs: join the existing promise.
  if (inFlight.has(url)) {
    return inFlight.get(url);
  }

  const task = doFetch(url, {
    fetchImpl, timeoutMs, retries, backoffMs, rateLimitMs,
    circuitBreaker, signal, headers, now, startedAt,
  }).finally(() => {
    inFlight.delete(url);
  });
  inFlight.set(url, task);
  return task;
}

async function doFetch(url, opts) {
  const {
    fetchImpl, timeoutMs, retries, backoffMs, rateLimitMs,
    circuitBreaker, signal, headers, now, startedAt,
  } = opts;

  const maxAttempts = Math.max(1, retries + 1);
  let attempts = 0;
  let lastStatus = 0;
  let lastBody = '';
  let lastError = 'unknown';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts += 1;

    // Per-origin rate limiting (minimum interval between request starts).
    if (rateLimitMs > 0) {
      await getOriginLimiter(url, rateLimitMs).acquire();
    }

    // Hard timeout via AbortController, chained to the caller's signal.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });

    let response = null;
    try {
      response = await fetchImpl(url, { signal: controller.signal, headers });
    } catch (err) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);

      if (signal && signal.aborted) {
        // Caller-initiated abort: not a source failure, never retried.
        return failureResult({ error: 'aborted', attempts, startedAt, now });
      }
      lastError = timedOut ? 'timeout' : `network_error: ${err && err.message ? err.message : String(err)}`;
      lastStatus = 0;
      lastBody = '';
      if (circuitBreaker) circuitBreaker.recordFailure();
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelay(attempt, backoffMs));
        continue;
      }
      return failureResult({ error: lastError, attempts, startedAt, now });
    }

    // Read the body (also covers failures mid-stream).
    let text = '';
    try {
      text = await response.text();
    } catch (err) {
      if (signal && signal.aborted) {
        clearTimeout(timer);
        signal.removeEventListener('abort', onExternalAbort);
        return failureResult({ error: 'aborted', attempts, startedAt, now });
      }
      lastError = timedOut ? 'timeout' : `body_read_error: ${err && err.message ? err.message : String(err)}`;
      lastStatus = response.status || 0;
      if (circuitBreaker) circuitBreaker.recordFailure();
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelay(attempt, backoffMs));
        continue;
      }
      return failureResult({ status: lastStatus, error: lastError, attempts, startedAt, now });
    }
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);

    const status = response.status;
    lastStatus = status;
    lastBody = text;

    if (status >= 200 && status < 300) {
      if (circuitBreaker) circuitBreaker.recordSuccess();
      return {
        ok: true,
        status,
        body: text,
        json: parseJsonSafe(text),
        error: null,
        attempts,
        durationMs: Math.max(0, now() - startedAt),
      };
    }

    const retryable = status === 429 || status >= 500;
    if (!retryable) {
      // 4xx other than 429: permanent client error. No retry, and it does not
      // count as a source outage for the circuit breaker.
      return failureResult({ status, body: text, error: `http_${status}`, attempts, startedAt, now });
    }

    lastError = `http_${status}`;
    if (circuitBreaker) circuitBreaker.recordFailure();

    if (attempt < maxAttempts - 1) {
      // Respect Retry-After when present; otherwise exponential backoff+jitter.
      const ra = retryAfterMs(response.headers, now);
      const delay = ra != null ? ra : backoffDelay(attempt, backoffMs);
      await sleep(delay);
      // If the breaker just opened (this failure was the threshold one),
      // stop retrying instead of hammering a failing source.
      if (circuitBreaker && !circuitBreaker.allowRequest()) {
        return failureResult({ status, body: text, error: 'circuit_open', attempts, startedAt, now });
      }
      continue;
    }
    return failureResult({ status, body: text, error: lastError, attempts, startedAt, now });
  }

  // Unreachable in practice; defensive structured failure.
  return failureResult({ status: lastStatus, body: lastBody, error: lastError, attempts, startedAt, now });
}
