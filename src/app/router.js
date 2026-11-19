// History-API router with lazy workspace modules, deep links and 404 handling.
// Navigation never triggers a full page reload; the server also resolves deep
// links to the shell so direct URLs and browser back/forward both work.
const routes = [];
let current = null;
let notFoundHandler = null;
let beforeEach = null;

export function route(pattern, loader, meta = {}) {
  const keys = [];
  const regex = new RegExp("^" + pattern.replace(/:[a-zA-Z]+/g, m => { keys.push(m.slice(1)); return "([^/]+)"; }) + "/?$");
  routes.push({ pattern, regex, keys, loader, meta });
}
export function onNotFound(fn) { notFoundHandler = fn; }
export function before(fn) { beforeEach = fn; }

export function parseLocation() {
  const url = new URL(location.href);
  return { path: url.pathname.replace(/\/+$/, "") || "/", params: Object.fromEntries(url.searchParams), url };
}

export async function navigate(path, { replace = false, params = null } = {}) {
  const url = new URL(path, location.origin);
  if (params) for (const [k, v] of Object.entries(params)) { if (v == null || v === "") url.searchParams.delete(k); else url.searchParams.set(k, v); }
  if (replace) history.replaceState({}, "", url); else history.pushState({}, "", url);
  await resolve();
}

export function setParams(params, { replace = true } = {}) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(params)) { if (v == null || v === "") url.searchParams.delete(k); else url.searchParams.set(k, v); }
  if (replace) history.replaceState({}, "", url); else history.pushState({}, "", url);
}

export async function resolve() {
  const { path, params } = parseLocation();
  for (const r of routes) {
    const m = path.match(r.regex);
    if (!m) continue;
    const routeParams = {};
    r.keys.forEach((k, i) => { routeParams[k] = decodeURIComponent(m[i + 1]); });
    const ctx = { path, params, routeParams, meta: r.meta, pattern: r.pattern };
    if (beforeEach) await beforeEach(ctx);
    if (current && current.destroy) { try { current.destroy(); } catch (err) { console.error("[router] destroy failed", err); } }
    const mod = await r.loader();
    const mountFn = mod.mount || mod.default;
    if (typeof mountFn !== "function") throw new Error("Workspace module for " + r.pattern + " has no mount()");
    current = await mountFn(ctx);
    document.dispatchEvent(new CustomEvent("observatory:navigated", { detail: ctx }));
    return ctx;
  }
  if (current && current.destroy) { try { current.destroy(); } catch {} }
  current = null;
  if (notFoundHandler) await notFoundHandler({ path, params });
  return null;
}

export function start() {
  window.addEventListener("popstate", () => { resolve(); });
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[data-link]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http") || a.target === "_blank") return;
    e.preventDefault();
    navigate(href);
  });
  return resolve();
}
export function currentRoute() { return current; }
