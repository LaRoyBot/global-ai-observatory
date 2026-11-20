// Global AI Observatory — shared geographic engine.
// Extracted from the original single-file implementation and PRESERVED: the
// orthographic projection math, great-circle route sampling, true hemisphere
// clipping (bisection at the limb), the reusable 150-particle pool, the cached
// two-layer canvas renderer, hit testing, tooltips and selection are unchanged.
// What changed is the boundary: data is injected, DOM is scoped to a container,
// and UI concerns are emitted as events instead of writing to global ids.
//
// Usage:
//   const globe = createGlobe(containerEl, { flows, countries, onChange, onSelect });
//   await globe.mount();
//   globe.setPeriod(2); globe.selectCountry("IND"); globe.setLayers([...]);
//
// The engine never invents geography: route endpoints come from real country
// reference points, and backside geometry is genuinely clipped, not masked.
import { COUNTRY_COORDS as DEFAULT_COORDS, ISO_NUMERIC, SG_SUPPLEMENT } from "./country-reference.js";
import { periodLabel, periodShort, fmtCompact, fmtExact, fmtPct, escapeHtml } from "../shared/formatting.js";
import { createEarthRenderer, subsolarPoint } from "./earth-texture.js";

const DEFAULT_D3_URLS = [
  "/vendor/d3.min.js",
  "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
  "https://unpkg.com/d3@7.9.0/dist/d3.min.js"
];
const DEFAULT_TOPOJSON_URLS = [
  "/vendor/topojson-client.min.js",
  "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
  "https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js"
];
const DEFAULT_ATLAS_URLS = [
  "/data/reference/countries-110m.json",
  "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
  "https://unpkg.com/world-atlas@2.0.2/countries-110m.json"
];

export function createGlobe(container, opts = {}) {
  if (!container) throw new Error("createGlobe requires a container element");
  const FLOWS = Array.isArray(opts.flows) ? opts.flows : [];
  const COUNTRY_COORDS = opts.countries || DEFAULT_COORDS;
  const rootEl = container;
  rootEl.classList.add("globe-root");
  rootEl.innerHTML =
    '<canvas class="globe-canvas" tabindex="0" role="img" aria-label="Interactive orthographic globe. Drag to rotate, arrow keys to rotate, Enter to select the hovered country."></canvas>' +
    '<div class="globe-tooltip" role="tooltip" aria-hidden="true"></div>' +
    '<div class="globe-notice" hidden></div>' +
    '<div class="globe-loading"><div class="globe-spinner"></div><div class="globe-loading-text">LOADING GEOGRAPHIC ENGINE</div></div>' +
    '<div class="globe-hint">Drag to rotate &middot; click a country or route</div>' +
    '<div class="sr-only globe-status" role="status" aria-live="polite"></div>';
  const dom = {
    globe: rootEl.querySelector(".globe-canvas"),
    tooltip: rootEl.querySelector(".globe-tooltip"),
    "stage-notice": rootEl.querySelector(".globe-notice"),
    loading: rootEl.querySelector(".globe-loading"),
    "globe-hint": rootEl.querySelector(".globe-hint"),
    "sr-status": rootEl.querySelector(".globe-status")
  };

  // ---- event bus (UI concerns leave the engine as events) ----
  const listeners = new Map();
  function on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => off(name, fn); }
  function off(name, fn) { const s = listeners.get(name); if (s) s.delete(fn); }
  function emit(name, payload) { const s = listeners.get(name); if (s) for (const fn of [...s]) { try { fn(payload); } catch (err) { console.error("[globe] listener error", name, err); } } }
  function emitChange() { emit("change", snapshot()); }

  /* ---------- 1. CONFIGURATION ---------- */
  const CFG = {
    colors: {
      background:"#0a0a0a", globe:"#020a08", countryFill:"#0a2018",
      countryOutline:"#0f5040", textSecondary:"#cccccc", textMuted:"#838383",
      input:"#44ff88", output:"#ffaa00", selection:"#e8e8e8",
      atmosphere:"rgba(68,255,136,0.14)", route:"42,122,96",
      graticule:"rgba(10,42,32,0.55)"
    },
    particleBudget: 150,        // hard cap, normal mode
    particleBudgetLow: 75,      // hard cap, low-power mode
    radiusBase: 1, radiusGain: 2.2, radiusMin: 1, radiusMax: 3.2,
    dprCap: 2, dprCapLow: 1,
    autoRotateDegPerSec: 0.9,
    playbackBaseMs: 2400,       // ms per period at 1x
    crossfadeMs: 600,           // route intensity transition between periods
    spotlightMs: 900,
    idleResumeMs: 2500,         // auto-rotation resume delay after interaction
    assetTimeoutMs: 12000,
    urls: {
      d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
      topojson: "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
      atlas: "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
    }
  };


  /* ---------- 4. DATASET VALIDATION ----------
     Runs at startup. Malformed data produces a visible, specific error —
     records are never silently discarded. */
  function validateDataset(flows, coords) {
    const errors = [];
    const seen = new Set();
    const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!Array.isArray(flows) || flows.length === 0) {
      errors.push("FLOWS must be a non-empty array.");
      return { ok:false, errors };
    }
    flows.forEach((r, i) => {
      const at = "FLOWS[" + i + "]";
      if (!r || typeof r !== "object") { errors.push(at + ": not an object."); return; }
      for (const k of ["period","origin","destination","inputTokens","outputTokens"]) {
        if (!(k in r)) errors.push(at + ": missing required property '" + k + "'.");
      }
      if (typeof r.period !== "string" || !periodRe.test(r.period))
        errors.push(at + ": period '" + r.period + "' is not YYYY-MM with a valid month.");
      for (const side of ["origin","destination"]) {
        const code = r[side];
        if (typeof code !== "string" || !coords[code]) {
          errors.push(at + ": " + side + " '" + code + "' has no COUNTRY_COORDS entry.");
        } else {
          const c = coords[code];
          if (typeof c.name !== "string" || !c.name)
            errors.push(at + ": " + code + " is missing a display name.");
          if (!Number.isFinite(c.lon) || c.lon < -180 || c.lon > 180 ||
              !Number.isFinite(c.lat) || c.lat < -90 || c.lat > 90)
            errors.push(at + ": " + code + " has invalid coordinates (" + c.lon + ", " + c.lat + ").");
        }
      }
      if (r.origin && r.destination && r.origin === r.destination)
        errors.push(at + ": origin and destination are the same country.");
      for (const k of ["inputTokens","outputTokens"]) {
        const v = r[k];
        if (!Number.isInteger(v) || v < 0)
          errors.push(at + ": " + k + " must be a nonnegative integer (got " + v + ").");
        else if (v > Number.MAX_SAFE_INTEGER)
          errors.push(at + ": " + k + " exceeds Number.MAX_SAFE_INTEGER.");
      }
      const key = r.period + "|" + r.origin + "|" + r.destination;
      if (seen.has(key)) errors.push(at + ": duplicate record for " + key + ".");
      seen.add(key);
    });
    // Every country used in FLOWS needs an ISO numeric mapping for the atlas.
    for (const code of new Set(flows.flatMap(r => [r.origin, r.destination]))) {
      if (coords[code] && !ISO_NUMERIC[code])
        errors.push("Country " + code + " is missing an ISO_NUMERIC mapping.");
    }
    return { ok: errors.length === 0, errors };
  }


  /* ---------- 5. AGGREGATION LAYER ----------
     Single source of numeric truth. Every statistic, ranking, tooltip and
     particle allocation in the app is derived from these functions, which
     operate on the embedded FLOWS records. Exact integer arithmetic is used;
     aggregates are guarded against Number.MAX_SAFE_INTEGER overflow. */
  const Agg = (() => {
    const SAFE = Number.MAX_SAFE_INTEGER;
    function guard(v, label) {
      if (!Number.isFinite(v) || v > SAFE || v < -SAFE)
        throw new Error("Aggregate '" + label + "' exceeds safe integer precision (" + v + "). Use BigInt-backed data for datasets this large.");
      return v;
    }
    function periods() {
      return [...new Set(FLOWS.map(r => r.period))].sort();
    }
    function recordsFor(period) {
      return FLOWS.filter(r => r.period === period);
    }
    function totals(recs) {
      let input = 0, output = 0;
      const countries = new Set();
      for (const r of recs) {
        input += r.inputTokens; output += r.outputTokens;
        countries.add(r.origin); countries.add(r.destination);
      }
      guard(input, "input"); guard(output, "output"); guard(input + output, "total");
      return { input, output, total: input + output, routes: recs.length, countries: countries.size };
    }
    // Group by serving country (origin) or consuming country (destination).
    function groupBy(recs, side) {
      const m = new Map();
      for (const r of recs) {
        const code = r[side];
        let g = m.get(code);
        if (!g) { g = { code, name: COUNTRY_COORDS[code].name, input: 0, output: 0, total: 0, routes: 0 }; m.set(code, g); }
        g.input += r.inputTokens; g.output += r.outputTokens;
        g.total += r.inputTokens + r.outputTokens; g.routes++;
      }
      for (const g of m.values()) { guard(g.input, side + ".input"); guard(g.output, side + ".output"); guard(g.total, side + ".total"); }
      return m;
    }
    const byOrigin = recs => groupBy(recs, "origin");
    const byDestination = recs => groupBy(recs, "destination");
    function routeVolumes(recs) {
      const m = new Map();
      for (const r of recs) {
        const key = r.origin + ">" + r.destination;
        let v = m.get(key);
        if (!v) { v = { key, origin: r.origin, destination: r.destination, input: 0, output: 0, total: 0 }; m.set(key, v); }
        v.input += r.inputTokens; v.output += r.outputTokens; v.total += r.inputTokens + r.outputTokens;
      }
      for (const v of m.values()) guard(v.total, "route.total");
      return m;
    }
    // Selected-country metrics. Directions are explicit, never ambiguous:
    //   serving.outputServed   = generated tokens this country SERVES to others (origin side, output)
    //   serving.inputReceived  = prompt tokens this country RECEIVES as server (origin side, input)
    //   consuming.outputReceived = generated tokens this country RECEIVES as consumer (destination side, output)
    //   consuming.inputSent    = prompt tokens this country SENDS as consumer (destination side, input)
    function countryMetrics(code, recs) {
      const s = { outputServed: 0, inputReceived: 0, total: 0, partners: 0 };
      const c = { outputReceived: 0, inputSent: 0, total: 0, partners: 0 };
      const sPartners = new Set(), cPartners = new Set();
      for (const r of recs) {
        if (r.origin === code) {
          s.outputServed += r.outputTokens; s.inputReceived += r.inputTokens;
          s.total += r.inputTokens + r.outputTokens; sPartners.add(r.destination);
        }
        if (r.destination === code) {
          c.outputReceived += r.outputTokens; c.inputSent += r.inputTokens;
          c.total += r.inputTokens + r.outputTokens; cPartners.add(r.origin);
        }
      }
      s.partners = sPartners.size; c.partners = cPartners.size;
      guard(s.total, "country.serving"); guard(c.total, "country.consuming");
      return { serving: s, consuming: c };
    }
    // Rankings: total-associated volume, grouped by destination (consuming)
    // or origin (serving). Share denominator is always the period total.
    function rankings(recs, mode, limit) {
      const groups = mode === "serving" ? byOrigin(recs) : byDestination(recs);
      const t = totals(recs);
      const rows = [...groups.values()]
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
        .map((g, i) => ({ rank: i + 1, ...g, share: t.total > 0 ? g.total / t.total : 0 }));
      return limit ? rows.slice(0, limit) : rows;
    }
    // Partner rankings for a selected country.
    //   mode "consumers": countries consuming FROM the selected server (origin=code, group by destination)
    //   mode "servers":   countries serving the selected consumer (destination=code, group by origin)
    function partners(code, recs, mode) {
      const m = new Map();
      let denom = 0;
      for (const r of recs) {
        const match = mode === "consumers" ? r.origin === code : r.destination === code;
        if (!match) continue;
        const other = mode === "consumers" ? r.destination : r.origin;
        let g = m.get(other);
        if (!g) { g = { code: other, name: COUNTRY_COORDS[other].name, input: 0, output: 0, total: 0 }; m.set(other, g); }
        g.input += r.inputTokens; g.output += r.outputTokens;
        g.total += r.inputTokens + r.outputTokens;
        denom += r.inputTokens + r.outputTokens;
      }
      guard(denom, "partners.denom");
      return [...m.values()]
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
        .map((g, i) => ({ rank: i + 1, ...g, share: denom > 0 ? g.total / denom : 0 }));
    }
    function pct(part, whole) { return whole > 0 ? (part / whole) * 100 : 0; }
    return { periods, recordsFor, totals, byOrigin, byDestination, routeVolumes, countryMetrics, rankings, partners, pct, guard };
  })();


  /* ---------- 6. PARTICLE ALLOCATION ----------
     Deterministic, budgeted, square-root volume scale (documented in the
     methodology panel):
       weight(stream) = sqrt(volume)
       radius(stream) = clamp(1 + 2.2 * sqrt(volume / maxVolume), 1, 3.2) px
     Budget: <= 150 particles (<= 75 low-power). Every visible nonzero stream
     gets one particle where the budget allows; the remainder is distributed
     proportionally to sqrt-weights using the largest-remainder method with
     stable tie-breaking, so counts never flicker between identical states.
     Particles encode RELATIVE volume — they are not individual tokens. */
  function allocateParticles(streams, budget) {
    // streams: [{ key, volume }] — visible, nonzero, already filtered.
    const counts = new Map();
    if (!streams.length || budget <= 0) return counts;
    const weighted = streams
      .map(s => ({ key: s.key, volume: s.volume, w: Math.sqrt(s.volume) }))
      .sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const n = weighted.length;
    if (budget < n) {
      // Not enough budget for everyone: strongest streams get one each.
      for (let i = 0; i < budget; i++) counts.set(weighted[i].key, 1);
      return counts;
    }
    for (const s of weighted) counts.set(s.key, 1);
    let remaining = budget - n;
    const sumW = weighted.reduce((a, s) => a + s.w, 0);
    const quotas = weighted.map(s => {
      const q = remaining * (s.w / sumW);
      return { key: s.key, floor: Math.floor(q), frac: q - Math.floor(q) };
    });
    let used = quotas.reduce((a, q) => a + q.floor, 0);
    for (const q of quotas) counts.set(q.key, counts.get(q.key) + q.floor);
    let leftover = remaining - used;
    const byFrac = [...quotas].sort((a, b) => b.frac - a.frac || (a.key < b.key ? -1 : 1));
    for (let i = 0; leftover > 0 && i < byFrac.length; i++, leftover--)
      counts.set(byFrac[i].key, counts.get(byFrac[i].key) + 1);
    return counts;
  }
  function particleRadius(volume, maxVolume) {
    if (!(volume > 0) || !(maxVolume > 0)) return CFG.radiusMin;
    const r = CFG.radiusBase + CFG.radiusGain * Math.sqrt(volume / maxVolume);
    return Math.min(CFG.radiusMax, Math.max(CFG.radiusMin, r));
  }


  /* ---------- 7. GEOGRAPHIC MATH, VISIBILITY & ROUTES ----------
     All route geometry is geographic: great-circle (slerp) interpolation
     between real country reference points, projected through an orthographic
     projection. Hemisphere visibility is tested explicitly per point with
     dot(p, viewCenter) > 0 — a circular canvas clip is NOT used for routes
     or particles. Antimeridian crossings are handled naturally because all
     math is done on unit vectors, never on raw longitude differences. */
  const Geo = (() => {
    const DEG = Math.PI / 180;
    const toVec = (lon, lat) => {
      const l = lon * DEG, p = lat * DEG, cp = Math.cos(p);
      return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
    };
    const toLonLat = v => [Math.atan2(v[1], v[0]) / DEG, Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const dist = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)); // radians, robust
    // Great-circle interpolation. Near-antipodal pairs fall back to a stable
    // orthogonal axis so interpolation never produces NaN.
    function slerp(a, b, t) {
      const d = dot(a, b);
      const omega = Math.acos(Math.max(-1, Math.min(1, d)));
      if (omega < 1e-8) return a.slice();
      let axis = b;
      if (Math.PI - omega < 1e-6) {
        axis = norm(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
        const s = Math.sin(omega * t);
        return norm([a[0] * Math.cos(omega * t) + axis[0] * s, a[1] * Math.cos(omega * t) + axis[1] * s, a[2] * Math.cos(omega * t) + axis[2] * s]);
      }
      const s = Math.sin(omega);
      const wa = Math.sin((1 - t) * omega) / s, wb = Math.sin(t * omega) / s;
      return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
    }
    // Orthographic projection math (identical to d3.geoOrthographic with
    // rotate([-centerLon, -centerLat]); verified by a dev parity test).
    // state.rotation stores d3-style rotate angles [lambda0, phi0].
    function centerVec(rotation) { return toVec(-rotation[0], -rotation[1]); }
    function projectVec(v, rotation, scale, cx, cy) {
      const c = centerVec(rotation);
      // Build the tangent basis at the view center.
      const lonC = -rotation[0] * DEG, latC = -rotation[1] * DEG;
      const east = [-Math.sin(lonC), Math.cos(lonC), 0];
      const north = [-Math.sin(latC) * Math.cos(lonC), -Math.sin(latC) * Math.sin(lonC), Math.cos(latC)];
      const x = dot(v, east), y = dot(v, north);
      return [cx + scale * x, cy - scale * y, dot(v, c)]; // third value: cosc (visibility)
    }
    function project(lonlat, rotation, scale, cx, cy) {
      return projectVec(toVec(lonlat[0], lonlat[1]), rotation, scale, cx, cy);
    }
    // Inverse orthographic: screen px -> [lon, lat], or null outside the sphere.
    function invert(px, py, rotation, scale, cx, cy) {
      const dx = (px - cx) / scale, dy = (cy - py) / scale;
      const rho = Math.hypot(dx, dy);
      if (rho > 1) return null;
      const latC = -rotation[1] * DEG, lonC = -rotation[0] * DEG;
      if (rho < 1e-9) return [-rotation[0], -rotation[1]];
      const c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
      const lat = Math.asin(cc * Math.sin(latC) + (dy * sc * Math.cos(latC)) / rho);
      const lon = lonC + Math.atan2(dx * sc, rho * Math.cos(latC) * cc - dy * Math.sin(latC) * sc);
      return [lon / DEG, lat / DEG];
    }
    const visible = (v, rotation) => dot(v, centerVec(rotation)) > 1e-6;
    // Cross-track angular distance from point p to great circle through a,b.
    function crossTrack(p, a, b) {
      const n = norm(cross(a, b));
      return Math.asin(Math.max(-1, Math.min(1, Math.abs(dot(p, n)))));
    }
    return { DEG, toVec, toLonLat, dot, cross, norm, dist, slerp, centerVec, project, projectVec, invert, visible, crossTrack };
  })();

  /* Route objects are built ONCE from the union of all FLOWS pairs and
     reused for every period. Samples are dense enough (~1.2° steps) that
     horizon crossings can be refined by bisection for clean geographic
     clipping of the route lines themselves. */
  const ROUTES = (() => {
    const pairs = new Map();
    for (const r of FLOWS) {
      const key = r.origin + ">" + r.destination;
      if (!pairs.has(key)) pairs.set(key, { origin: r.origin, destination: r.destination });
    }
    const routes = [];
    for (const [key, p] of [...pairs.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      const ca = COUNTRY_COORDS[p.origin], cb = COUNTRY_COORDS[p.destination];
      const a = Geo.toVec(ca.lon, ca.lat), b = Geo.toVec(cb.lon, cb.lat);
      const distRad = Geo.dist(a, b);
      const steps = Math.max(24, Math.ceil((distRad / Geo.DEG) / 1.2));
      const samples = [];
      for (let i = 0; i <= steps; i++) samples.push(Geo.slerp(a, b, i / steps));
      routes.push({
        key, origin: p.origin, destination: p.destination,
        a, b, distRad, distDeg: distRad / Geo.DEG, samples,
        // t in [0,1] along origin->destination. Input particles run 1-t.
        at: t => Geo.slerp(a, b, t),
        durationMs: (distRad / Geo.DEG) / 14 * 1000 // ~14°/s angular speed
      });
    }
    return routes;
  })();
  const ROUTE_BY_KEY = new Map(ROUTES.map(r => [r.key, r]));

  /* ---------- Application state ---------- */
  const state = {
    periodIdx: 0,
    playing: false, speed: 1, loop: true,
    selectedCountry: null, selectedRoute: null,
    hoverCountry: null, hoverRoute: null,
    showInput: true, showOutput: true, showRoutes: true, lowPower: false,
    autoRotate: true,
    rotation: (opts.initialRotation || [-60, -20]).slice(), // d3-style rotate angles
    rankMode: "consuming",
    partnerMode: "consumers",       // "consumers" | "servers"
    story: null,
    dragging: false,
    lastInteraction: 0,
    clock: 0,                       // particle animation time (ms), frozen when hidden/reduced
    lastFrameTs: 0,
    lastAdvanceTs: 0,
    fade: null,                     // { prev: Map(routeKey->volumes), t0 }
    spotlight: null,                // { from, to, t0 }
    frames: 0,
    reducedMotion: false, motionOverride: false, fatal: false,
    assets: { d3: false, topojson: false, atlas: false },
    fallback: null,                 // null | "d3" | "atlas" | "all"
    validation: null,
    baseDirty: true,
    lastBaseRotation: [NaN, NaN],
    pointer: { x: 0, y: 0, inside: false },
    ready: false
  };
  let PERIODS = [];


  /* ---------- 8. RENDERING ----------
     Layered drawing:
       base offscreen canvas  — atmosphere, sphere, graticule, country fills,
                                borders, selected-country highlight. Rebuilt
                                only when rotation moves > 0.08°, selection
                                changes, or the viewport resizes (geometry is
                                never recomputed per particle frame).
       main canvas per frame  — cached base bitmap, geodesic route lines with
                                true horizon clipping, particles, hover marks.
     If D3 fails to load, a native-Canvas fallback draws the sphere and
     graticules with the same projection math (no country polygons). */
  const el = id => dom[id] || null;
  const canvas = dom.globe;
  const ctx = canvas.getContext("2d");
  const baseCanvas = document.createElement("canvas");
  const bctx = baseCanvas.getContext("2d");
  // Realistic Earth layer (NASA textures + real solar terminator). Falls back
  // to the vector globe when textures fail, low-power is on, or ?earth=0.
  let earth = null;
  let activeEarthCanvas = null;
  let lastEarthDrawMs = 0;
  let lastEarthRot = [NaN, NaN];
  const EARTH_DISABLED = new URLSearchParams(location.search).get("earth") === "0";
  function earthActive() { return !!(earth && !state.lowPower && !choroplethLayer && !EARTH_DISABLED); }
  const view = { w: 0, h: 0, dpr: 1, scale: 100, cx: 0, cy: 0 };
  let countryFeatures = new Map();   // ISO alpha-3 -> GeoJSON feature
  let allFeatures = [];
  let borderMesh = null;
  let d3Projection = null;

  function resize() {
    const stage = rootEl;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w < 10 || h < 10) return;
    view.dpr = Math.min(window.devicePixelRatio || 1, state.lowPower ? CFG.dprCapLow : CFG.dprCap);
    view.w = w; view.h = h;
    view.scale = Math.min(w, h) / 2 - 26;
    view.cx = w / 2; view.cy = h / 2;
    canvas.width = Math.round(w * view.dpr); canvas.height = Math.round(h * view.dpr);
    baseCanvas.width = canvas.width; baseCanvas.height = canvas.height;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (earth) earth.configure(view.scale, view.dpr);
    state.baseDirty = true;
  }

  function setupGeography(topo) {
    const feats = window.topojson.feature(topo, topo.objects.countries).features;
    borderMesh = window.topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
    allFeatures = feats;
    for (const [code, numeric] of Object.entries(ISO_NUMERIC)) {
      const f = feats.find(f => String(f.id) === numeric || String(f.id) === String(parseInt(numeric, 10)));
      if (f) { f.properties = f.properties || {}; f.properties.iso = code; countryFeatures.set(code, f); }
    }
    // Natural Earth 1:110m omits city-states; use the embedded 1:50m outline.
    if (!countryFeatures.has("SGP")) {
      const sg = JSON.parse(JSON.stringify(SG_SUPPLEMENT));
      sg.id = "702";
      allFeatures.push(sg);
      countryFeatures.set("SGP", sg);
    }
  }

  /* Draw a geographic polyline with genuine hemisphere clipping: visible
     runs are stroked; horizon crossings are refined by bisection so lines
     end exactly at the limb instead of being chopped at sample points. */
  function strokeGeoLine(c, samples, style, width) {
    const rot = state.rotation, sc = view.scale, cx = view.cx, cy = view.cy;
    const center = Geo.centerVec(rot);
    const proj = v => {
      const p = Geo.projectVec(v, rot, sc, cx, cy);
      return { x: p[0], y: p[1], vis: Geo.dot(v, center) > 0 };
    };
    const horizon = (v1, v2) => {
      let lo = 0, hi = 1;
      const d1 = Geo.dot(v1, center);
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const vm = Geo.slerp(v1, v2, mid);
        if ((Geo.dot(vm, center) > 0) === (d1 > 0)) lo = mid; else hi = mid;
      }
      return Geo.slerp(v1, v2, (lo + hi) / 2);
    };
    c.strokeStyle = style; c.lineWidth = width; c.lineCap = "round";
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        c.beginPath();
        c.moveTo(run[0].x, run[0].y);
        for (let i = 1; i < run.length; i++) c.lineTo(run[i].x, run[i].y);
        c.stroke();
      }
      run = [];
    };
    let prev = null;
    for (const v of samples) {
      const p = proj(v);
      if (prev && p.vis !== prev.vis) {
        const h = proj(horizon(prev.v, v));
        if (prev.vis) { run.push(h); flush(); }
        else { run = [h]; }
      }
      if (p.vis) run.push(p);
      prev = { ...p, v };
    }
    flush();
  }

  function rebuildBase() {
    const { w, h, dpr, scale, cx, cy } = view;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);
    // Atmospheric halo — subtle, never obscures borders.
    const halo = bctx.createRadialGradient(cx, cy, scale * 0.97, cx, cy, scale * 1.09);
    halo.addColorStop(0, "rgba(68,255,136,0.08)");
    halo.addColorStop(0.45, "rgba(68,255,136,0.04)");
    halo.addColorStop(1, "rgba(68,255,136,0)");
    bctx.fillStyle = halo;
    bctx.beginPath(); bctx.arc(cx, cy, scale * 1.09, 0, Math.PI * 2); bctx.fill();
    const realistic = earthActive();
    if (!realistic) {
      // Ocean sphere with controlled lighting (vector mode).
      const ocean = bctx.createRadialGradient(cx - scale * 0.3, cy - scale * 0.35, scale * 0.1, cx, cy, scale);
      ocean.addColorStop(0, "#0a2018");
      ocean.addColorStop(1, "#020a08");
      bctx.fillStyle = ocean;
      bctx.beginPath(); bctx.arc(cx, cy, scale, 0, Math.PI * 2); bctx.fill();
    } else {
      // Thin atmospheric limb over the photographic sphere.
      const rim = bctx.createRadialGradient(cx, cy, scale * 0.88, cx, cy, scale);
      rim.addColorStop(0, "rgba(60,160,120,0)");
      rim.addColorStop(0.82, "rgba(60,160,120,0.05)");
      rim.addColorStop(1, "rgba(120,220,170,0.16)");
      bctx.fillStyle = rim;
      bctx.beginPath(); bctx.arc(cx, cy, scale, 0, Math.PI * 2); bctx.fill();
    }

    if (window.d3) {
      d3Projection = window.d3.geoOrthographic()
        .rotate(state.rotation).scale(scale).translate([cx, cy]).precision(0.4);
      const path = window.d3.geoPath(d3Projection, bctx);
      // Graticule — vector mode only; the photographic Earth needs no grid.
      if (!realistic) {
        bctx.beginPath(); path(window.d3.geoGraticule10());
        bctx.strokeStyle = CFG.colors.graticule; bctx.lineWidth = 0.5; bctx.stroke();
      }
      if (state.assets.atlas && allFeatures.length) {
        // Country fills — batched, or per-feature when a choropleth layer is active.
        // In realistic mode the texture IS the surface; fills would hide it.
        if (realistic) {
          /* no fills */
        } else if (choroplethLayer && choroplethLayer.values) {
          for (const f of allFeatures) {
            const iso = f.properties && f.properties.iso;
            const val = iso != null ? choroplethLayer.values[iso] : undefined;
            bctx.beginPath(); path(f);
            bctx.fillStyle = (val == null || !choroplethLayer.color) ? CFG.colors.countryFill : choroplethLayer.color(val);
            bctx.fill();
          }
        } else {
          bctx.beginPath();
          for (const f of allFeatures) path(f);
          bctx.fillStyle = CFG.colors.countryFill; bctx.fill();
        }
        // Borders
        if (borderMesh) {
          bctx.beginPath(); path(borderMesh);
          bctx.strokeStyle = realistic ? "rgba(120,200,160,0.14)" : "rgba(15,80,64,0.55)";
          bctx.lineWidth = realistic ? 0.5 : 0.6; bctx.stroke();
        }
        // Selected country highlight
        if (state.selectedCountry) {
          const f = countryFeatures.get(state.selectedCountry);
          if (f) {
            bctx.beginPath(); path(f);
            bctx.fillStyle = realistic ? "rgba(232,232,232,0.07)" : "#1e1e1e"; bctx.fill();
            bctx.beginPath(); path(f);
            bctx.strokeStyle = "rgba(232,232,232,0.18)"; bctx.lineWidth = 4; bctx.stroke();
            bctx.beginPath(); path(f);
            bctx.strokeStyle = CFG.colors.selection; bctx.lineWidth = 1.3; bctx.stroke();
          }
        }
      }
    } else {
      // Native-Canvas fallback: sphere outline + manual graticule.
      bctx.beginPath(); bctx.arc(cx, cy, scale, 0, Math.PI * 2);
      bctx.strokeStyle = "rgba(15,80,64,0.8)"; bctx.lineWidth = 1; bctx.stroke();
      const grat = [];
      for (let lon = -180; lon < 180; lon += 30) {
        const line = [];
        for (let lat = -87; lat <= 87; lat += 3) line.push(Geo.toVec(lon, lat));
        grat.push(line);
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const line = [];
        for (let lon = -180; lon <= 180; lon += 3) line.push(Geo.toVec(lon, lat));
        grat.push(line);
      }
      for (const line of grat) strokeGeoLine(bctx, line, CFG.colors.graticule, 0.5);
      if (state.selectedCountry) drawReferenceRing(bctx, state.selectedCountry, CFG.colors.selection, 1.3);
    }
    state.baseDirty = false;
    state.lastBaseRotation = [state.rotation[0], state.rotation[1]];
  }

  function drawReferenceRing(c, code, color, width) {
    const cc = COUNTRY_COORDS[code];
    const p = Geo.project([cc.lon, cc.lat], state.rotation, view.scale, view.cx, view.cy);
    if (p[2] <= 0) return;
    c.beginPath(); c.arc(p[0], p[1], 6, 0, Math.PI * 2);
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }

  /* ---------- Route lines ---------- */
  function currentVolumes() { return Agg.routeVolumes(Agg.recordsFor(PERIODS[state.periodIdx])); }

  function routeFocus(key) {
    const r = ROUTE_BY_KEY.get(key);
    if (state.selectedRoute) return key === state.selectedRoute ? 1 : 0.10;
    if (state.selectedCountry) return (r.origin === state.selectedCountry || r.destination === state.selectedCountry) ? 1 : 0.12;
    return 1;
  }

  function drawRoutes(now) {
    if (!state.showRoutes) return;
    const vols = currentVolumes();
    let fadeF = 1;
    if (state.fade && !(state.fade.prev instanceof Map)) state.fade = null; // defensive: malformed payload
    if (state.fade) {
      fadeF = Math.min(1, (now - state.fade.t0) / CFG.crossfadeMs);
      fadeF = fadeF * fadeF * (3 - 2 * fadeF); // smoothstep
      if (fadeF >= 1) state.fade = null;
    }
    const keys = new Set(vols.keys());
    if (state.fade) for (const k of state.fade.prev.keys()) keys.add(k);
    let maxTotal = 1;
    for (const v of vols.values()) maxTotal = Math.max(maxTotal, v.total);
    for (const key of keys) {
      const route = ROUTE_BY_KEY.get(key);
      if (!route) continue;
      const cur = vols.get(key), prev = state.fade ? state.fade.prev.get(key) : null;
      const effTotal = (prev ? prev.total : 0) + ((cur ? cur.total : 0) - (prev ? prev.total : 0)) * fadeF;
      if (effTotal <= 0) continue;
      const focus = routeFocus(key);
      let alpha = ((earthActive() ? 0.16 : 0.10) + (earthActive() ? 0.22 : 0.16) * Math.sqrt(effTotal / maxTotal)) * focus;
      let color = earthActive() ? "80,190,140" : CFG.colors.route, width = 1;
      if (state.hoverRoute === key) { alpha = Math.max(alpha, 0.55); color = "210,235,220"; width = 1.4; }
      if (state.selectedRoute === key) { alpha = 0.75; color = "210,235,220"; width = 1.5; }
      if (earthActive()) alpha = Math.min(alpha, 0.45);
      if (alpha < 0.015) continue;
      strokeGeoLine(ctx, route.samples, "rgba(" + color + "," + alpha.toFixed(3) + ")", width);
      // Endpoint markers for inspected routes.
      if (state.hoverRoute === key || state.selectedRoute === key) {
        for (const v of [route.a, route.b]) {
          const p = Geo.projectVec(v, state.rotation, view.scale, view.cx, view.cy);
          if (p[2] > 0) {
            ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(232,232,232,0.9)"; ctx.fill();
          }
        }
      }
    }
  }


  /* ---------- 9. PARTICLE SYSTEM ----------
     A fixed pool of reusable particle objects (never allocated per frame).
     Allocation is recomputed only when period, filters or selection change.
     Position is time-based: t = (clock / duration + phase) mod 1, with the
     input stream running the route in reverse (destination -> origin). */
  const particlePool = Array.from({ length: CFG.particleBudget }, () => ({
    active: false, key: "", route: null, dir: "out", phase: 0, duration: 1, radius: 1, color: CFG.colors.output
  }));
  let allocation = new Map();
  let activeStreamList = [];

  function relevantRoute(route) {
    if (state.selectedRoute) return route.key === state.selectedRoute;
    if (state.selectedCountry) return route.origin === state.selectedCountry || route.destination === state.selectedCountry;
    return true;
  }

  function updateAllocation() {
    const vols = currentVolumes();
    const streams = [];
    for (const route of ROUTES) {
      const v = vols.get(route.key);
      if (!v || !relevantRoute(route)) continue;
      if (state.showInput && v.input > 0) streams.push({ key: route.key + "|in", routeKey: route.key, dir: "in", volume: v.input });
      if (state.showOutput && v.output > 0) streams.push({ key: route.key + "|out", routeKey: route.key, dir: "out", volume: v.output });
    }
    streams.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    activeStreamList = streams;
    const budget = state.lowPower ? CFG.particleBudgetLow : CFG.particleBudget;
    allocation = allocateParticles(streams, budget);
    const maxVolume = streams.reduce((m, s) => Math.max(m, s.volume), 0);
    let idx = 0;
    for (const s of streams) {
      const count = allocation.get(s.key) || 0;
      const route = ROUTE_BY_KEY.get(s.routeKey);
      const radius = particleRadius(s.volume, maxVolume);
      const color = s.dir === "in" ? CFG.colors.input : CFG.colors.output;
      for (let i = 0; i < count && idx < particlePool.length; i++, idx++) {
        const p = particlePool[idx];
        p.active = true; p.key = s.key; p.route = route; p.dir = s.dir;
        p.phase = (i + 0.5) / count; p.duration = route.durationMs;
        p.radius = radius; p.color = color;
      }
    }
    for (; idx < particlePool.length; idx++) particlePool[idx].active = false;
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = earthActive() ? "screen" : "lighter";
    const rot = state.rotation, sc = view.scale, cx = view.cx, cy = view.cy;
    const center = Geo.centerVec(rot);
    const tails = !state.lowPower;
    for (const p of particlePool) {
      if (!p.active) continue;
      let t = ((state.clock / p.duration) + p.phase) % 1;
      const geoT = p.dir === "in" ? 1 - t : t;
      const v = p.route.at(geoT);
      if (Geo.dot(v, center) <= 1e-6) continue; // behind the Earth: hidden immediately
      const pos = Geo.projectVec(v, rot, sc, cx, cy);
      const rgb = p.dir === "in" ? "68,255,136" : "255,170,0";
      if (tails) {
        const tailAlphas = [0.30, 0.18, 0.09];
        for (let k = 1; k <= 3; k++) {
          let tt = t - k * 0.013;
          if (tt < 0) break; // tail truncates at the route endpoint, never wraps
          const gv = p.route.at(p.dir === "in" ? 1 - tt : tt);
          if (Geo.dot(gv, center) <= 1e-6) break;
          const tp = Geo.projectVec(gv, rot, sc, cx, cy);
          ctx.beginPath(); ctx.arc(tp[0], tp[1], p.radius * 0.72, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(" + rgb + "," + tailAlphas[k - 1] + ")"; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(pos[0], pos[1], p.radius * 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + rgb + ",0.13)"; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(pos[0], pos[1], p.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + rgb + ",0.95)"; ctx.fill();
    }
    ctx.restore();
  }

  function drawHoverCountry() {
    const code = state.hoverCountry;
    if (!code || code === state.selectedCountry) return;
    if (window.d3 && state.assets.atlas) {
      const f = countryFeatures.get(code);
      if (!f) return;
      const proj = window.d3.geoOrthographic().rotate(state.rotation).scale(view.scale).translate([view.cx, view.cy]);
      const path = window.d3.geoPath(proj, ctx);
      ctx.beginPath(); path(f);
      ctx.strokeStyle = "rgba(232,232,232,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    } else {
      drawReferenceRing(ctx, code, "rgba(232,232,232,0.6)", 1);
    }
  }

  /* ---------- Frame loop ---------- */
  let rafId = null;
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = state.lastFrameTs ? Math.min(ts - state.lastFrameTs, 100) : 16;
    state.lastFrameTs = ts;
    if (!state.ready) return;

    // Spotlight transition (elegant, quick, cancellable by drag).
    if (state.spotlight) {
      const s = state.spotlight;
      const f = Math.min(1, (ts - s.t0) / CFG.spotlightMs);
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      state.rotation = [s.from[0] + (s.to[0] - s.from[0]) * e, s.from[1] + (s.to[1] - s.from[1]) * e];
      if (f >= 1) state.spotlight = null;
    }

    // Slow auto-rotation; paused while dragging, spotlighting, inspecting,
    // or shortly after any interaction. Disabled under reduced motion.
    const inspecting = state.pointer.inside && (state.hoverRoute || state.hoverCountry);
    if (state.autoRotate && (!state.reducedMotion || state.motionOverride) && !state.dragging && !state.spotlight && !inspecting &&
        ts - state.lastInteraction > CFG.idleResumeMs) {
      state.rotation[0] += CFG.autoRotateDegPerSec * dt / 1000;
      if (state.rotation[0] > 180) state.rotation[0] -= 360;
    }

    // Playback advances through real FLOWS periods only.
    if (state.playing && ts - state.lastAdvanceTs >= CFG.playbackBaseMs / state.speed) {
      state.lastAdvanceTs = ts;
      api.advancePeriod();
    }

    if (!state.reducedMotion) state.clock += dt;

    const rotMoved = Math.abs(state.rotation[0] - state.lastBaseRotation[0]) > 0.08 ||
                     Math.abs(state.rotation[1] - state.lastBaseRotation[1]) > 0.08;
    if (state.baseDirty || rotMoved || state.dragging) rebuildBase();

    ctx.clearRect(0, 0, view.w, view.h);
    if (earthActive()) {
      const moved = Math.abs(state.rotation[0] - lastEarthRot[0]) > 0.04 ||
                    Math.abs(state.rotation[1] - lastEarthRot[1]) > 0.04;
      const sunTick = ts - lastEarthDrawMs > 1000;
      if (!activeEarthCanvas || moved || state.dragging || sunTick) {
        activeEarthCanvas = earth.render(state.rotation[0], state.rotation[1], Date.now());
        lastEarthDrawMs = ts;
        lastEarthRot = [state.rotation[0], state.rotation[1]];
      }
      if (activeEarthCanvas) {
        ctx.drawImage(activeEarthCanvas, view.cx - view.scale, view.cy - view.scale, view.scale * 2, view.scale * 2);
      }
    }
    ctx.drawImage(baseCanvas, 0, 0, view.w, view.h);
    drawRoutes(ts);
    drawParticles();
    drawMarkers();
    drawHoverCountry();
    state.frames++;
  }

  function startLoop() { if (rafId === null) { state.lastFrameTs = 0; rafId = requestAnimationFrame(frame); } }
  function stopLoop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }


  /* ---------- 11. HIT TESTING ---------- */
  function countryAtLonLat(lonlat) {
    const p = Geo.toVec(lonlat[0], lonlat[1]);
    if (window.d3 && state.assets.atlas) {
      for (const [code, f] of countryFeatures) {
        if (window.d3.geoContains(f, lonlat)) return code;
      }
      // Small-state assist: Singapore is a few px wide at globe scale.
      const sg = COUNTRY_COORDS.SGP;
      const threshold = Math.max(0.9 * Geo.DEG, 7 / view.scale);
      if (Geo.dist(p, Geo.toVec(sg.lon, sg.lat)) < threshold) return "SGP";
      return null;
    }
    // Fallback without polygons: nearest reference point within a generous
    // angular threshold (clearly an approximation, explained in the notice).
    let best = null, bestD = Infinity;
    const threshold = Math.max(1.5 * Geo.DEG, 10 / view.scale);
    for (const [code, c] of Object.entries(COUNTRY_COORDS)) {
      const d = Geo.dist(p, Geo.toVec(c.lon, c.lat));
      if (d < threshold && d < bestD) { best = code; bestD = d; }
    }
    return best;
  }

  function routeAtScreen(px, py) {
    const ll = Geo.invert(px, py, state.rotation, view.scale, view.cx, view.cy);
    if (!ll) return null;
    const p = Geo.toVec(ll[0], ll[1]);
    const threshold = 6 / view.scale; // ~6px cross-track tolerance
    const vols = currentVolumes();
    let best = null, bestCt = Infinity;
    for (const route of ROUTES) {
      if (!vols.has(route.key) || !relevantRoute(route)) continue;
      const ct = Geo.crossTrack(p, route.a, route.b);
      if (ct >= threshold) continue;
      const along = Geo.dist(route.a, p) + Geo.dist(p, route.b) - route.distRad;
      if (along < 0.04 && ct < bestCt) { best = route.key; bestCt = ct; }
    }
    return best;
  }


  /* ---------- 12. TOOLTIPS ---------- */
  const tooltip = dom.tooltip;
  function positionTooltip(clientX, clientY) {
    const pad = 8, off = 16;
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    let left = clientX + off, top = clientY + off;
    if (left + w > window.innerWidth - pad) left = clientX - w - off;
    if (top + h > window.innerHeight - pad) top = clientY - h - off;
    tooltip.style.left = Math.max(pad, left) + "px";
    tooltip.style.top = Math.max(pad, top) + "px";
  }
  function showRouteTooltip(key, clientX, clientY) {
    const v = currentVolumes().get(key);
    if (!v) { hideTooltip(); return; }
    const so = COUNTRY_COORDS[v.origin].name, de = COUNTRY_COORDS[v.destination].name;
    const period = PERIODS[state.periodIdx];
    tooltip.innerHTML =
      '<div class="tt-title">' + so.toUpperCase() + " &rarr; " + de.toUpperCase() + "</div>" +
      '<div class="tt-sub">Serving: ' + so + " &middot; Consumption: " + de + "</div>" +
      '<div class="tt-row"><span class="k"><span class="dot in"></span>Prompt tokens</span><span class="v" title="' + fmtExact(v.input) + ' tokens">' + fmtCompact(v.input) + "</span></div>" +
      '<div class="tt-dir"><span class="dot in"></span>travels ' + de + " &rarr; " + so + " (reverse)</div>" +
      '<div class="tt-row"><span class="k"><span class="dot out"></span>Generated tokens</span><span class="v" title="' + fmtExact(v.output) + ' tokens">' + fmtCompact(v.output) + "</span></div>" +
      '<div class="tt-dir"><span class="dot out"></span>travels ' + so + " &rarr; " + de + "</div>" +
      '<div class="tt-row total"><span class="k">Total associated</span><span class="v" title="' + fmtExact(v.total) + ' tokens">' + fmtCompact(v.total) + "</span></div>" +
      '<div class="tt-foot">Period: ' + periodLabel(period) + " &middot; Synthetic demonstration</div>";
    tooltip.classList.add("active");
    tooltip.setAttribute("aria-hidden", "false");
    positionTooltip(clientX, clientY);
  }
  function showCountryTooltip(code, clientX, clientY) {
    const recs = Agg.recordsFor(PERIODS[state.periodIdx]);
    const m = Agg.countryMetrics(code, recs);
    const c = COUNTRY_COORDS[code];
    tooltip.innerHTML =
      '<div class="tt-title">' + c.name.toUpperCase() + ' <span class="mono" style="color:var(--text-muted)">' + code + "</span></div>" +
      '<div class="tt-row"><span class="k">As serving country</span><span class="v">' + fmtCompact(m.serving.total) + "</span></div>" +
      '<div class="tt-row"><span class="k">As consuming country</span><span class="v">' + fmtCompact(m.consuming.total) + "</span></div>" +
      '<div class="tt-foot">Click to explore &middot; ' + periodLabel(PERIODS[state.periodIdx]) + "</div>";
    tooltip.classList.add("active");
    tooltip.setAttribute("aria-hidden", "false");
    positionTooltip(clientX, clientY);
  }
  function hideTooltip() {
    tooltip.classList.remove("active");
    tooltip.setAttribute("aria-hidden", "true");
  }


  /* ---------- 13. SELECTION & SPOTLIGHT ---------- */
  function announce(msg) { dom["sr-status"].textContent = msg; if (opts.onAnnounce) opts.onAnnounce(msg); }

  function spotlightTo(lon, lat) {
    const target = [-lon, Math.max(-89.9, Math.min(89.9, -lat))];
    const from = [state.rotation[0], state.rotation[1]];
    const delta = ((target[0] - from[0] + 540) % 360) - 180; // shortest path
    const to = [from[0] + delta, target[1]];
    if (state.reducedMotion) { state.rotation = to; state.baseDirty = true; return; }
    state.spotlight = { from, to, t0: performance.now() };
  }

  function selectCountry(code, withSpotlight = true) {
    state.selectedCountry = code;
    state.selectedRoute = null;
    state.story = null;
    emit("dismiss-story");
    state.baseDirty = true;
    updateAllocation();
    emitChange();
    hideTooltip();
    if (withSpotlight) { const c = COUNTRY_COORDS[code]; spotlightTo(c.lon, c.lat); }
    announce("Selected " + COUNTRY_COORDS[code].name + ". Country intelligence updated for " + periodLabel(PERIODS[state.periodIdx]) + ".");
  }
  function selectRoute(key) {
    const r = ROUTE_BY_KEY.get(key);
    state.selectedRoute = key;
    if (state.selectedCountry && r.origin !== state.selectedCountry && r.destination !== state.selectedCountry)
      state.selectedCountry = null;
    state.story = null;
    emit("dismiss-story");
    state.baseDirty = true;
    updateAllocation();
    emitChange();
    announce("Inspecting route " + COUNTRY_COORDS[r.origin].name + " to " + COUNTRY_COORDS[r.destination].name + ".");
  }
  function clearSelections() {
    state.selectedCountry = null;
    state.selectedRoute = null;
    state.baseDirty = true;
    updateAllocation();
    emitChange();
    hideTooltip();
    announce("Selection cleared.");
  }


  /* ---------- 14. POINTER & KEYBOARD INTERACTION ---------- */
  let dragStart = null, lastHoverTs = 0, touchTooltipTimer = null;

  canvas.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    dragStart = { x: e.clientX, y: e.clientY, moved: 0 };
    state.dragging = true;
    state.spotlight = null;
    state.lastInteraction = performance.now();
    hideTooltip();
    canvas.style.cursor = "grabbing";
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", e => {
    const rect = canvas.getBoundingClientRect();
    state.pointer.x = e.clientX - rect.left;
    state.pointer.y = e.clientY - rect.top;
    state.pointer.inside = true;
    if (state.dragging && dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      dragStart.x = e.clientX; dragStart.y = e.clientY;
      dragStart.moved += Math.abs(dx) + Math.abs(dy);
      const k = 60 / view.scale; // degrees per pixel, scaled to globe size
      state.rotation[0] += dx * k;
      if (state.rotation[0] > 180) state.rotation[0] -= 360;
      if (state.rotation[0] < -180) state.rotation[0] += 360;
      state.rotation[1] = Math.max(-89.9, Math.min(89.9, state.rotation[1] - dy * k));
      state.baseDirty = true;
      state.lastInteraction = performance.now();
      return;
    }
    const now = performance.now();
    if (now - lastHoverTs < 33) return; // throttle hover hit-testing to ~30Hz
    lastHoverTs = now;
    const rk = routeAtScreen(state.pointer.x, state.pointer.y);
    const ll = Geo.invert(state.pointer.x, state.pointer.y, state.rotation, view.scale, view.cx, view.cy);
    const ck = (!rk && ll) ? countryAtLonLat(ll) : null;
    const changed = rk !== state.hoverRoute || ck !== state.hoverCountry;
    state.hoverRoute = rk;
    state.hoverCountry = ck;
    canvas.style.cursor = (rk || ck) ? "pointer" : "grab";
    if (rk) showRouteTooltip(rk, e.clientX, e.clientY);
    else if (ck) showCountryTooltip(ck, e.clientX, e.clientY);
    else if (changed) hideTooltip();
    if (rk || ck) state.lastInteraction = now; // pause auto-rotate while inspecting
  });

  function endDrag(e) {
    if (!state.dragging) return;
    state.dragging = false;
    canvas.style.cursor = "grab";
    state.lastInteraction = performance.now();
    const wasClick = dragStart && dragStart.moved < 6;
    dragStart = null;
    if (!wasClick) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const mk = markerAtScreen(x, y);
    if (mk) { emit("select-marker", mk); return; }
    const rk = routeAtScreen(x, y);
    if (rk) {
      if (state.selectedRoute === rk) { state.selectedRoute = null; updateAllocation(); emitChange(); }
      else selectRoute(rk);
      if (e.pointerType === "touch") {
        showRouteTooltip(rk, e.clientX, e.clientY);
        clearTimeout(touchTooltipTimer);
        touchTooltipTimer = setTimeout(hideTooltip, 3500);
      }
      return;
    }
    const ll = Geo.invert(x, y, state.rotation, view.scale, view.cx, view.cy);
    const ck = ll ? countryAtLonLat(ll) : null;
    if (ck) {
      if (state.selectedCountry === ck) clearSelections();
      else selectCountry(ck);
    } else if (ll) {
      clearSelections(); // ocean click clears
    }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", e => { state.dragging = false; dragStart = null; canvas.style.cursor = "grab"; });
  canvas.addEventListener("pointerleave", () => {
    state.pointer.inside = false;
    state.hoverRoute = null; state.hoverCountry = null;
    if (!state.dragging) hideTooltip();
  });

  canvas.addEventListener("keydown", e => {
    const step = e.shiftKey ? 12 : 4;
    let handled = true;
    switch (e.key) {
      case "ArrowLeft": state.rotation[0] += step; break;
      case "ArrowRight": state.rotation[0] -= step; break;
      case "ArrowUp": state.rotation[1] = Math.max(-89.9, state.rotation[1] - step); break;
      case "ArrowDown": state.rotation[1] = Math.min(89.9, state.rotation[1] + step); break;
      case "Home": state.rotation = [-60, -20]; break;
      case "Enter": if (state.hoverCountry) selectCountry(state.hoverCountry); else handled = false; break;
      default: handled = false;
    }
    if (handled) {
      if (state.rotation[0] > 180) state.rotation[0] -= 360;
      if (state.rotation[0] < -180) state.rotation[0] += 360;
      state.baseDirty = true;
      state.lastInteraction = performance.now();
      e.preventDefault();
      e.stopPropagation();
    }
  });


  // ---- generic geographic layers (markers / choropleth) ----
  let markerLayer = null, choroplethLayer = null;
  function drawMarkers() {
    if (!markerLayer || !Array.isArray(markerLayer.items) || !markerLayer.items.length) return;
    const center = Geo.centerVec(state.rotation);
    ctx.save();
    for (const m of markerLayer.items) {
      if (m.lat == null || m.lon == null) continue;
      const v = Geo.toVec(m.lon, m.lat);
      if (Geo.dot(v, center) <= 1e-6) continue; // genuine backside occlusion
      const p = Geo.projectVec(v, state.rotation, view.scale, view.cx, view.cy);
      const r = m.radius || 3;
      const color = m.color || "rgba(232,232,232,0.9)";
      if (m.ring) {
        ctx.beginPath(); ctx.arc(p[0], p[1], r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.restore();
  }
  function markerAtScreen(x, y) {
    if (!markerLayer || !Array.isArray(markerLayer.items)) return null;
    const center = Geo.centerVec(state.rotation);
    let best = null, bestD = 100;
    for (const m of markerLayer.items) {
      if (m.lat == null || m.lon == null) continue;
      const v = Geo.toVec(m.lon, m.lat);
      if (Geo.dot(v, center) <= 1e-6) continue;
      const p = Geo.projectVec(v, state.rotation, view.scale, view.cx, view.cy);
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < Math.max(9, (m.radius || 3) + 5) && d < bestD) { bestD = d; best = m; }
    }
    return best;
  }
  function setLayers(layers) {
    markerLayer = null; choroplethLayer = null;
    for (const layer of (layers || [])) {
      if (!layer || layer.visible === false) continue;
      if (layer.type === "markers") markerLayer = layer;
      else if (layer.type === "choropleth") choroplethLayer = layer;
    }
    state.baseDirty = true;
  }

  // ---- asset loading (local vendor first, pinned CDN mirrors as fallback) ----
  const ATLAS_URLS = opts.atlasUrls || DEFAULT_ATLAS_URLS;
  const LOAD_NOTICE = "Internet access is required to load the geographic map and rendering libraries.";
  function showNotice(msg) {
    dom["stage-notice"].textContent = msg;
    dom["stage-notice"].hidden = false;
    emit("notice", { message: msg });
    console.warn("[globe] " + msg);
  }
  function showFatal(msg) {
    state.fatal = true;
    stopLoop();
    dom.loading.hidden = false;
    dom.loading.innerHTML =
      '<div class="globe-fatal-title">GEOGRAPHIC ENGINE COULD NOT START</div>' +
      '<pre class="globe-fatal-body">' + escapeHtml(msg) + '</pre>' +
      '<div class="globe-fatal-disclaimer">Synthetic demo data, not measured international token traffic</div>';
    emit("error", { message: msg });
  }
  function loadScript(urls, ready) {
    return new Promise(resolve => {
      const queue = urls.slice();
      const next = () => {
        if (ready()) { resolve(true); return; }
        if (!queue.length) { resolve(false); return; }
        const s = document.createElement("script");
        s.src = queue.shift();
        s.async = false;
        let settled = false;
        const timer = setTimeout(() => finish(false), opts.scriptTimeoutMs || 12000);
        const finish = ok => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          s.onload = null; s.onerror = null;
          if (!ok && s.parentNode) s.parentNode.removeChild(s);
          if (ok && ready()) resolve(true); else next();
        };
        s.onload = () => finish(true);
        s.onerror = () => finish(false);
        document.head.appendChild(s);
      };
      next();
    });
  }
  async function fetchAtlas() {
    let lastError = "";
    for (const url of ATLAS_URLS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.atlasTimeoutMs || 15000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status + " from " + url);
        const topo = await res.json();
        if (!topo || !topo.objects || !topo.objects.countries || !Array.isArray(topo.arcs))
          throw new Error("Unexpected TopoJSON structure from " + url);
        setupGeography(topo);
        state.assets.atlas = true;
        state.baseDirty = true;
        return true;
      } catch (err) {
        clearTimeout(timer);
        lastError = err && err.name === "AbortError" ? "timed out" : (err && err.message ? err.message : String(err));
      }
    }
    state.assets.atlas = false;
    state.geoError = "Country boundaries could not be loaded (" + lastError + "). The globe shows the sphere, graticules, country reference markers, routes and all statistics, but geographic outline detail is unavailable.";
    return false;
  }

  // ---- engine self-validation (aggregation reconciliation + particle budget) ----
  function runValidation() {
    const failures = [];
    let checks = 0;
    const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); };
    for (const period of PERIODS) {
      const recs = Agg.recordsFor(period);
      const t = Agg.totals(recs);
      let sumIn = 0, sumOut = 0;
      for (const r of recs) { sumIn += r.inputTokens; sumOut += r.outputTokens; }
      ok(t.input === sumIn, period + ": input total != record sum");
      ok(t.output === sumOut, period + ": output total != record sum");
      ok(t.total === sumIn + sumOut, period + ": combined != input + output");
      ok([...Agg.byOrigin(recs).values()].reduce((a, g) => a + g.total, 0) === t.total, period + ": serving groups do not reconcile");
      ok([...Agg.byDestination(recs).values()].reduce((a, g) => a + g.total, 0) === t.total, period + ": consuming groups do not reconcile");
      ok(Agg.rankings(recs, "consuming").reduce((a, r) => a + r.total, 0) === t.total, period + ": consuming ranking does not reconcile");
      ok(Agg.rankings(recs, "serving").reduce((a, r) => a + r.total, 0) === t.total, period + ": serving ranking does not reconcile");
      const rv = Agg.routeVolumes(recs);
      const streams = [];
      for (const [key, v] of rv) {
        if (v.input > 0) streams.push({ key: key + "|in", volume: v.input });
        if (v.output > 0) streams.push({ key: key + "|out", volume: v.output });
      }
      const counts = allocateParticles(streams, CFG.particleBudget);
      let used = 0; for (const n of counts.values()) used += n;
      ok(used <= CFG.particleBudget, period + ": particle budget exceeded (" + used + ")");
      const low = allocateParticles(streams, CFG.particleBudgetLow);
      let lowUsed = 0; for (const n of low.values()) lowUsed += n;
      ok(lowUsed <= CFG.particleBudgetLow, period + ": low-power budget exceeded");
    }
    const report = { pass: failures.length === 0, checks, failures };
    if (failures.length) console.error("[globe] validation failures:", failures);
    return report;
  }

  // ---- lifecycle ----
  let resizeObserver = null, rmQuery = null, onRmChange = null, onVisibility = null, mounted = false;
  function snapshot() {
    const period = PERIODS[state.periodIdx] || null;
    const recs = period ? Agg.recordsFor(period) : [];
    const t = Agg.totals(recs);
    const codes = new Set();
    for (const r of recs) { codes.add(r.origin); codes.add(r.destination); }
    return {
      period, periodIdx: state.periodIdx, periods: PERIODS.slice(),
      totals: t, routeCount: Agg.routeVolumes(recs).size, countryCount: codes.size,
      recordCount: recs.length,
      selectedCountry: state.selectedCountry, selectedRoute: state.selectedRoute,
      hoverCountry: state.hoverCountry, hoverRoute: state.hoverRoute,
      rotation: state.rotation.slice(), playing: state.playing, speed: state.speed,
      autoRotate: state.autoRotate, lowPower: state.lowPower, reducedMotion: state.reducedMotion,
      showInput: state.showInput, showOutput: state.showOutput, showRoutes: state.showRoutes,
      particles: particlePool.reduce((n, p) => n + (p.active ? 1 : 0), 0),
      particleBudget: state.lowPower ? CFG.particleBudgetLow : CFG.particleBudget,
      assets: Object.assign({}, state.assets), validation: state.validation,
      frames: state.frames, ready: state.ready, fatal: state.fatal
    };
  }
  async function mount() {
    if (mounted) return api;
    mounted = true;
    const validation = validateDataset(FLOWS, COUNTRY_COORDS);
    const errors = FLOWS.length === 0 ? [] : (validation.errors || (Array.isArray(validation) ? validation : []));
    if (errors.length) {
      showFatal("The injected flow dataset is malformed. No records were silently discarded.\n\n" + errors.join("\n"));
      return api;
    }
    PERIODS = Agg.periods();
    state.periodIdx = Math.max(0, PERIODS.length - 1);
    rmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    state.reducedMotion = rmQuery.matches;
    state.autoRotate = opts.autoRotate != null ? !!opts.autoRotate : !state.reducedMotion;
    state.lowPower = !!opts.lowPower;
    onRmChange = e => {
      state.reducedMotion = e.matches;
      if (e.matches && !state.motionOverride) state.autoRotate = false;
      emitChange();
    };
    if (rmQuery.addEventListener) rmQuery.addEventListener("change", onRmChange);
    else if (rmQuery.addListener) rmQuery.addListener(onRmChange);
    resize();
    updateAllocation();
    if (opts.earth !== false && !EARTH_DISABLED) {
      createEarthRenderer().then(r => {
        earth = r;
        earth.configure(view.scale, view.dpr);
        activeEarthCanvas = null;
        state.baseDirty = true;
        emitChange();
      }).catch(err => {
        console.warn("[globe] photographic Earth unavailable; vector globe retained.", err.message);
      });
    }
    const fail = opts.fail || new URLSearchParams(location.search).get("fail");
    if (fail !== "d3" && fail !== "all") {
      await loadScript(opts.d3Urls || DEFAULT_D3_URLS, () => !!window.d3);
      await loadScript(opts.topojsonUrls || DEFAULT_TOPOJSON_URLS, () => !!window.topojson);
    }
    state.assets.d3 = !!window.d3 && fail !== "d3" && fail !== "all";
    state.assets.topojson = !!window.topojson && state.assets.d3;
    if (!state.assets.d3) showNotice(LOAD_NOTICE + " D3.js could not be loaded; a static native-Canvas globe is shown with reference markers only.");
    else if (!state.assets.topojson) showNotice(LOAD_NOTICE + " topojson-client could not be loaded; geographic boundaries are unavailable.");
    if (state.assets.d3 && state.assets.topojson) {
      const status = dom.loading.querySelector(".globe-loading-text");
      if (status) status.textContent = "LOADING COUNTRY GEOMETRY…";
      if (fail === "atlas") {
        state.assets.atlas = false;
        state.geoError = "Map asset load was disabled by the fail=atlas flag; country boundaries are not shown.";
        showNotice(state.geoError);
      } else {
        await fetchAtlas();
        if (!state.assets.atlas) showNotice(state.geoError);
      }
    }
    state.validation = runValidation();
    emit("validation", state.validation);
    dom.loading.hidden = true;
    resize();
    state.baseDirty = true;
    state.ready = true;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(rootEl);
    }
    onVisibility = () => { if (document.hidden) stopLoop(); else if (!state.fatal && state.ready) startLoop(); };
    document.addEventListener("visibilitychange", onVisibility);
    startLoop();
    emitChange();
    emit("ready", snapshot());
    return api;
  }
  function destroy() {
    stopLoop();
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (rmQuery && onRmChange) {
      if (rmQuery.removeEventListener) rmQuery.removeEventListener("change", onRmChange);
      else if (rmQuery.removeListener) rmQuery.removeListener(onRmChange);
    }
    if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    earth = null; activeEarthCanvas = null;
    listeners.clear();
    rootEl.innerHTML = "";
    mounted = false;
    state.ready = false;
  }

  const api = {
    mount, destroy, resize,
    on, off, emit,
    getSnapshot: snapshot,
    getState: () => state,
    getEarth: () => ({ active: earthActive(), subsolar: subsolarPoint(Date.now()), textureSize: earth ? earth.size : 0 }),
    agg: Agg, geo: Geo, routes: ROUTES, routeByKey: ROUTE_BY_KEY, cfg: CFG,
    periods: () => PERIODS.slice(),
    setFlows(flows) {
      // Replace the demonstration dataset without rebuilding the engine.
      FLOWS.length = 0;
      for (const r of flows) FLOWS.push(r);
      const v = validateDataset(FLOWS, COUNTRY_COORDS);
      const errs = FLOWS.length === 0 ? [] : (v.errors || (Array.isArray(v) ? v : []));
      if (errs.length) { emit("error", { message: errs.join("; ") }); return false; }
      PERIODS = Agg.periods();
      state.periodIdx = Math.min(state.periodIdx, PERIODS.length - 1);
      state.baseDirty = true;
      updateAllocation(); emitChange();
      return true;
    },
    setPeriod(index, announceChange = true) {
      if (index < 0 || index >= PERIODS.length || index === state.periodIdx) return false;
      const prevVolumes = currentVolumes();
      state.periodIdx = index;
      state.fade = state.reducedMotion ? null : { prev: prevVolumes, t0: performance.now() };
      hideTooltip();
      updateAllocation();
      emitChange();
      if (announceChange) announce("Period " + periodLabel(PERIODS[index]) + ".");
      return true;
    },
    stepPeriod(delta) { return api.setPeriod(state.periodIdx + delta); },
    advancePeriod() {
      if (state.periodIdx + 1 < PERIODS.length) return api.setPeriod(state.periodIdx + 1, false);
      if (state.loop) return api.setPeriod(0, false);
      state.playing = false; emitChange(); return false;
    },
    setPlaying(on) { state.playing = !!on; state.lastFrameTs = 0; emitChange(); },
    togglePlay() { api.setPlaying(!state.playing); },
    setSpeed(x) { state.speed = Number(x) || 1; emitChange(); },
    setLoop(on) { state.loop = !!on; emitChange(); },
    selectCountry, selectRoute, clearSelections,
    spotlightTo,
    setRotation(r) { state.rotation = [r[0], r[1]]; state.baseDirty = true; state.spotlight = null; },
    getRotation: () => state.rotation.slice(),
    setAutoRotate(on) { state.autoRotate = !!on; if (on) state.motionOverride = true; state.lastInteraction = performance.now(); emitChange(); },
    setLowPower(on) { state.lowPower = !!on; resize(); updateAllocation(); emitChange(); },
    setShowInput(on) { state.showInput = !!on; updateAllocation(); emitChange(); },
    setShowOutput(on) { state.showOutput = !!on; updateAllocation(); emitChange(); },
    setShowRoutes(on) { state.showRoutes = !!on; emitChange(); },
    setLayers,
    hitMarker: markerAtScreen,
    project: (lon, lat) => Geo.project([lon, lat], state.rotation, view.scale, view.cx, view.cy),
    visibleAt: (lon, lat) => Geo.visible(Geo.toVec(lon, lat), state.rotation),
    particleCount: () => particlePool.reduce((n, p) => n + (p.active ? 1 : 0), 0),
    allocation: () => Object.fromEntries(allocation),
    volumes: () => Object.fromEntries(currentVolumes()),
    assets: () => Object.assign({}, state.assets),
    rafActive: () => rafId !== null,
    validate: runValidation,
    view: () => Object.assign({}, view),
    canvas: () => canvas
  };
  return api;
}
