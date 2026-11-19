// tests/adapters/http.test.js
// Unit tests for the shared resilient HTTP helper. No network: fetchImpl is
// always injected. Timers are real but kept tiny; circuit-breaker and rate
// limiter math is tested with an injected fake `now`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resilientFetch,
  createCircuitBreaker,
  createRateLimiter,
  parseJsonSafe,
} from '../../server/adapters/http.js';

// --- helpers ---------------------------------------------------------------

let urlCounter = 0;
/** Unique URL per test so in-flight coalescing never leaks across tests. */
const u = (label) => `https://http-test.example/${label}-${++urlCounter}`;

/** Minimal fetch-Response stand-in. */
function res(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => body,
  };
}

/** fetchImpl that plays a scripted sequence of responses/errors/functions. */
function seqFetch(steps) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts, at: Date.now() });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(url, opts);
    return step;
  };
  fn.calls = calls;
  return fn;
}

/** fetchImpl that hangs until its abort signal fires, then rejects. */
function hangingFetch(url, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    });
  });
}

const freshBreaker = (opts) => createCircuitBreaker(opts);

// --- parseJsonSafe ---------------------------------------------------------

test('parseJsonSafe parses valid JSON and returns null otherwise', () => {
  assert.deepEqual(parseJsonSafe('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonSafe('[1,2]'), [1, 2]);
  assert.equal(parseJsonSafe('not json'), null);
  assert.equal(parseJsonSafe(''), null);
  assert.equal(parseJsonSafe('{broken'), null);
  assert.equal(parseJsonSafe(null), null);
  assert.equal(parseJsonSafe(undefined), null);
});

// --- success & basic failure shapes ----------------------------------------

test('successful fetch returns structured result with parsed json', async () => {
  const fetchImpl = seqFetch([res('{"hello":"world"}')]);
  const r = await resilientFetch(u('ok'), { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.body, '{"hello":"world"}');
  assert.deepEqual(r.json, { hello: 'world' });
  assert.equal(r.error, null);
  assert.equal(r.attempts, 1);
  assert.equal(typeof r.durationMs, 'number');
  assert.ok(r.durationMs >= 0);
});

test('non-JSON body succeeds with json:null (e.g. XML feeds)', async () => {
  const fetchImpl = seqFetch([res('<feed></feed>')]);
  const r = await resilientFetch(u('xml'), { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.json, null);
  assert.equal(r.body, '<feed></feed>');
});

test('404 is never retried and does not trip the circuit breaker', async () => {
  const breaker = freshBreaker({ failureThreshold: 1 });
  const fetchImpl = seqFetch([res('nope', { status: 404 })]);
  const r = await resilientFetch(u('404'), { fetchImpl, retries: 3, circuitBreaker: breaker });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.error, 'http_404');
  assert.equal(r.attempts, 1);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(breaker.state, 'closed'); // client error != source outage
});

test('400 is never retried', async () => {
  const fetchImpl = seqFetch([res('bad', { status: 400 })]);
  const r = await resilientFetch(u('400'), { fetchImpl, retries: 3, backoffMs: 1 });
  assert.equal(r.attempts, 1);
  assert.equal(r.error, 'http_400');
});

// --- retries: 5xx, network errors ------------------------------------------

test('HTTP 500 then success: retried with backoff, attempts=2', async () => {
  const fetchImpl = seqFetch([res('err', { status: 500 }), res('{"ok":true}')]);
  const r = await resilientFetch(u('500-ok'), { fetchImpl, retries: 2, backoffMs: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(fetchImpl.calls.length, 2);
});

test('persistent HTTP 503 exhausts retries: attempts = retries+1', async () => {
  const fetchImpl = seqFetch([res('down', { status: 503 })]);
  const r = await resilientFetch(u('503'), { fetchImpl, retries: 2, backoffMs: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(r.error, 'http_503');
  assert.equal(r.attempts, 3);
  assert.equal(fetchImpl.calls.length, 3);
});

test('network error then success is retried', async () => {
  const fetchImpl = seqFetch([new Error('ECONNRESET'), res('fine')]);
  const r = await resilientFetch(u('net-ok'), { fetchImpl, retries: 2, backoffMs: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.body, 'fine');
});

test('persistent network error returns structured failure, never throws', async () => {
  const fetchImpl = seqFetch([new Error('ECONNREFUSED')]);
  const r = await resilientFetch(u('net-fail'), { fetchImpl, retries: 1, backoffMs: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.match(r.error, /^network_error: ECONNREFUSED/);
  assert.equal(r.attempts, 2);
});

test('synchronously-throwing fetchImpl is caught as a structured failure', async () => {
  const fetchImpl = () => { throw new TypeError('bad url'); };
  const r = await resilientFetch(u('sync-throw'), { fetchImpl, retries: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error, /^network_error: bad url/);
});

// --- 429 + Retry-After ------------------------------------------------------

test('HTTP 429 with Retry-After seconds is respected before retry', async () => {
  const fetchImpl = seqFetch([
    res('slow down', { status: 429, headers: { 'retry-after': '1' } }),
    res('ok now'),
  ]);
  const t0 = Date.now();
  const r = await resilientFetch(u('429'), { fetchImpl, retries: 2, backoffMs: 1 });
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.ok(elapsed >= 990, `expected >=990ms wait for Retry-After:1, got ${elapsed}`);
});

test('HTTP 429 with Retry-After HTTP-date is respected', async () => {
  const until = new Date(Date.now() + 2000).toUTCString(); // second granularity
  const fetchImpl = seqFetch([
    res('', { status: 429, headers: { 'retry-after': until } }),
    res('ok'),
  ]);
  const t0 = Date.now();
  const r = await resilientFetch(u('429-date'), { fetchImpl, retries: 1, backoffMs: 1 });
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.ok(elapsed >= 900, `expected ~1-2s wait for HTTP-date Retry-After, got ${elapsed}`);
});

test('HTTP 429 without Retry-After falls back to backoff and retries', async () => {
  const fetchImpl = seqFetch([res('', { status: 429 }), res('ok')]);
  const r = await resilientFetch(u('429-nora'), { fetchImpl, retries: 1, backoffMs: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

// --- timeout & external abort ----------------------------------------------

test('hard timeout aborts the attempt and reports error:timeout', async () => {
  const fetchImpl = seqFetch([hangingFetch]);
  const r = await resilientFetch(u('timeout'), { fetchImpl, timeoutMs: 30, retries: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'timeout');
  assert.equal(r.attempts, 1);
});

test('timeout is retried and can succeed on the next attempt', async () => {
  const fetchImpl = seqFetch([hangingFetch, res('recovered')]);
  const r = await resilientFetch(u('timeout-ok'), { fetchImpl, timeoutMs: 30, retries: 1, backoffMs: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.body, 'recovered');
});

test('pre-aborted external signal fails fast without any network attempt', async () => {
  const ac = new AbortController();
  ac.abort();
  const fetchImpl = seqFetch([res('never')]);
  const r = await resilientFetch(u('preabort'), { fetchImpl, signal: ac.signal });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'aborted');
  assert.equal(r.attempts, 0);
  assert.equal(fetchImpl.calls.length, 0);
});

test('external abort mid-flight is not retried', async () => {
  const ac = new AbortController();
  const fetchImpl = seqFetch([hangingFetch, res('should not happen')]);
  const pending = resilientFetch(u('midabort'), { fetchImpl, signal: ac.signal, retries: 3, timeoutMs: 5000 });
  setTimeout(() => ac.abort(), 10);
  const r = await pending;
  assert.equal(r.ok, false);
  assert.equal(r.error, 'aborted');
  assert.equal(fetchImpl.calls.length, 1);
});

// --- circuit breaker ---------------------------------------------------------

test('circuit breaker: opens after threshold, rejects during cooldown, half-open probe closes it', () => {
  let t = 0;
  const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => t });
  assert.equal(cb.state, 'closed');
  assert.equal(cb.allowRequest(), true);
  cb.recordFailure();
  assert.equal(cb.state, 'closed'); // 1 < 2
  cb.recordFailure();
  assert.equal(cb.state, 'open');
  assert.equal(cb.allowRequest(), false); // fast reject during cooldown
  t = 999;
  assert.equal(cb.allowRequest(), false);
  t = 1000;
  assert.equal(cb.state, 'half-open');
  assert.equal(cb.allowRequest(), true); // single probe allowed
  assert.equal(cb.allowRequest(), false); // no second probe while one is in flight
  cb.recordSuccess();
  assert.equal(cb.state, 'closed');
  assert.equal(cb.allowRequest(), true);
});

test('circuit breaker: failed half-open probe reopens with fresh cooldown', () => {
  let t = 0;
  const cb = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  cb.recordFailure();
  assert.equal(cb.state, 'open');
  t = 1000;
  assert.equal(cb.allowRequest(), true); // probe
  cb.recordFailure(); // probe failed
  assert.equal(cb.state, 'open');
  assert.equal(cb.allowRequest(), false);
  t = 1999;
  assert.equal(cb.allowRequest(), false); // cooldown restarted at t=1000
  t = 2000;
  assert.equal(cb.allowRequest(), true);
});

test('circuit breaker: success resets the consecutive-failure counter', () => {
  const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
  cb.recordFailure();
  cb.recordFailure();
  cb.recordSuccess();
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.state, 'closed'); // never 3 consecutive
});

test('resilientFetch + breaker: fast circuit_open rejection, then half-open recovery', async () => {
  let t = 0;
  const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => t });
  let shouldFail = true;
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (shouldFail) throw new Error('source down');
    return res('back up');
  };
  const opts = { fetchImpl, retries: 0, circuitBreaker: breaker, now: () => t };

  const r1 = await resilientFetch(u('cb'), opts);
  assert.match(r1.error, /^network_error/);
  const r2 = await resilientFetch(u('cb'), opts);
  assert.match(r2.error, /^network_error/);
  assert.equal(breaker.state, 'open');

  const r3 = await resilientFetch(u('cb'), opts);
  assert.equal(r3.error, 'circuit_open');
  assert.equal(r3.attempts, 0);
  assert.equal(calls.length, 2); // rejected fast: no network call

  t = 1000; // cooldown elapsed -> half-open probe
  shouldFail = false;
  const r4 = await resilientFetch(u('cb'), opts);
  assert.equal(r4.ok, true);
  assert.equal(r4.body, 'back up');
  assert.equal(breaker.state, 'closed');
});

// --- rate limiting -----------------------------------------------------------

test('rate limiter schedules slots with injected now', async () => {
  let t = 0;
  const rl = createRateLimiter({ minIntervalMs: 100, now: () => t });
  assert.equal(rl.msUntilFree(), 0);
  await rl.acquire(); // immediate at t=0, reserves until t=100
  assert.equal(rl.msUntilFree(), 100);
  t = 40;
  assert.equal(rl.msUntilFree(), 60);
  t = 100;
  assert.equal(rl.msUntilFree(), 0);
  await rl.acquire(); // immediate again
  assert.equal(rl.msUntilFree(), 100);
});

test('resilientFetch enforces rateLimitMs between request starts', async () => {
  const starts = [];
  const fetchImpl = async () => {
    starts.push(Date.now());
    return res('ok');
  };
  // Dedicated origin so the shared per-origin limiter is not polluted.
  const base = 'https://rate-limit-test.example/x';
  const r1 = await resilientFetch(`${base}-1`, { fetchImpl, rateLimitMs: 80 });
  const r2 = await resilientFetch(`${base}-2`, { fetchImpl, rateLimitMs: 80 });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(starts.length, 2);
  const gap = starts[1] - starts[0];
  assert.ok(gap >= 75, `expected >=~80ms between starts, got ${gap}`);
});

// --- in-flight coalescing ------------------------------------------------------

test('identical in-flight URLs are coalesced into one network request', async () => {
  let resolveFetch;
  let callCount = 0;
  const fetchImpl = () => {
    callCount += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };
  const url = u('coalesce');
  const p1 = resilientFetch(url, { fetchImpl });
  const p2 = resilientFetch(url, { fetchImpl });
  // Let both callers register before the response lands.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(callCount, 1);
  resolveFetch(res('shared'));
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1, r2);
  assert.equal(r1.body, 'shared');

  // After settling, the coalescing entry is cleared: a new call hits network.
  const r3 = await resilientFetch(url, { fetchImpl: seqFetch([res('fresh')]) });
  assert.equal(r3.body, 'fresh');
});

test('different URLs are not coalesced', async () => {
  const fetchImpl = seqFetch([res('a'), res('b')]);
  const [r1, r2] = await Promise.all([
    resilientFetch(u('distinct'), { fetchImpl }),
    resilientFetch(u('distinct'), { fetchImpl }),
  ]);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
});

// --- duration measurement -------------------------------------------------------

test('durationMs uses the injected now clock', async () => {
  let t = 1000;
  const fetchImpl = async () => { t += 250; return res('ok'); };
  const r = await resilientFetch(u('clock'), { fetchImpl, now: () => t });
  assert.equal(r.durationMs, 250);
});
