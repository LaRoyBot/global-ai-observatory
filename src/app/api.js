// API client. Failures are surfaced as structured results, never as fake zeros.
const BASE = "/api/v1";
const cache = new Map();
const inflight = new Map();

export async function apiGet(path, { ttlMs = 20000, force = false } = {}) {
  const key = path;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(BASE + path, { signal: controller.signal, headers: { accept: "application/json" } });
      clearTimeout(timer);
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* non-JSON response */ }
      if (!res.ok) {
        const message = body && body.error ? body.error.message : "HTTP " + res.status;
        return { ok: false, status: res.status, error: message, data: null };
      }
      const value = { ok: true, status: res.status, data: body.data, meta: body.meta || null, error: null };
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, status: 0, error: err.name === "AbortError" ? "Request timed out" : (err.message || String(err)), data: null };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

export async function apiSend(path, method, body) {
  try {
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", accept: "application/json" },
      body: body == null ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    if (!res.ok) return { ok: false, status: res.status, error: parsed && parsed.error ? parsed.error.message : "HTTP " + res.status, data: null };
    cache.clear();
    return { ok: true, status: res.status, data: parsed ? parsed.data : null, error: null };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || String(err), data: null };
  }
}

export function invalidate(pathPrefix) {
  for (const key of [...cache.keys()]) if (!pathPrefix || key.startsWith(pathPrefix)) cache.delete(key);
}
