// Lightweight flat-map view sharing the SAME geographic state as the globe.
// Uses the already-loaded D3 + Natural Earth geometry — no second heavy engine,
// no WebGL. Selection, layers and filters are shared through the app store.
import { state, selectCountry, subscribe } from "../app/state.js";

export function createFlatMap(container, { countries = {}, onSelect = null } = {}) {
  container.classList.add("flatmap-root");
  container.innerHTML = '<canvas class="flatmap-canvas" tabindex="0" role="img" aria-label="Flat equirectangular world map. Click a country to select it."></canvas>' +
    '<div class="globe-notice" hidden></div>';
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const notice = container.querySelector(".globe-notice");
  let features = [], projection = null, path = null, w = 0, h = 0, dpr = 1;
  let markers = [], choropleth = null, destroyed = false;

  function resize() {
    const rect = container.getBoundingClientRect();
    w = Math.max(200, rect.width); h = Math.max(160, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (window.d3) {
      projection = window.d3.geoEquirectangular().fitExtent([[8, 8], [w - 8, h - 8]], { type: "Sphere" });
      path = window.d3.geoPath(projection, ctx);
    }
    draw();
  }
  function draw() {
    if (destroyed) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0B1420";
    ctx.fillRect(0, 0, w, h);
    if (!window.d3 || !projection) {
      notice.hidden = false;
      notice.textContent = "Flat map requires D3, which could not be loaded. Country selection is still available through the workspace lists.";
      return;
    }
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.fillStyle = "#101C2B"; ctx.fill();
    ctx.beginPath(); path(window.d3.geoGraticule10());
    ctx.strokeStyle = "rgba(87,112,132,0.18)"; ctx.lineWidth = 0.4; ctx.stroke();
    for (const f of features) {
      const iso = f.properties && f.properties.iso;
      ctx.beginPath(); path(f);
      if (choropleth && iso && choropleth[iso] != null) { ctx.fillStyle = choropleth[iso]; ctx.fill(); }
      else { ctx.fillStyle = "#16283A"; ctx.fill(); }
      ctx.strokeStyle = iso === state.selectedCountry ? "rgba(192,232,255,0.95)" : "rgba(87,112,132,0.5)";
      ctx.lineWidth = iso === state.selectedCountry ? 1.4 : 0.5;
      ctx.stroke();
    }
    for (const m of markers) {
      if (m.lat == null || m.lon == null) continue;
      const p = projection([m.lon, m.lat]);
      if (!p) continue;
      ctx.beginPath(); ctx.arc(p[0], p[1], m.radius || 3, 0, Math.PI * 2);
      ctx.fillStyle = m.color || "rgba(192,232,255,0.9)"; ctx.fill();
    }
  }
  function onClick(e) {
    if (!projection || !window.d3) return;
    const rect = canvas.getBoundingClientRect();
    const ll = projection.invert([e.clientX - rect.left, e.clientY - rect.top]);
    if (!ll) return;
    const hit = features.find(f => window.d3.geoContains(f, ll));
    const iso = hit && hit.properties ? hit.properties.iso : null;
    if (iso) { selectCountry(iso); if (onSelect) onSelect(iso); }
    else selectCountry(null);
    draw();
  }
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("keydown", e => { if (e.key === "Escape") { selectCountry(null); draw(); } });
  const unsub = subscribe(() => draw());
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);
  window.addEventListener("resize", resize);

  return {
    setFeatures(f) { features = f || []; draw(); },
    setMarkers(m) { markers = m || []; draw(); },
    setChoropleth(c) { choropleth = c || null; draw(); },
    resize, draw,
    destroy() {
      destroyed = true;
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("resize", resize);
      if (ro) ro.disconnect();
      unsub();
      container.innerHTML = "";
    }
  };
}
