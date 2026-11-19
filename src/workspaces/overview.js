// Workspace 1 — Overview. The preserved globe is the centrepiece; eight
// functional intelligence panels sit on a persisted, reorderable layout.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate } from "../app/router.js";
import { state, savePrefs, selectCountry, setLayerVisible, announce } from "../app/state.js";
import { createGlobe } from "../geography/globe.js";
import { createFlatMap } from "../geography/flatmap.js";
import { loadCountryFeatures, whenGeoReady } from "../geography/atlas.js";
import { COUNTRY_COORDS } from "../geography/country-reference.js";
import { fmtCompact, fmtExact, periodLabel } from "../shared/formatting.js";

const DISCLAIMER = "Synthetic demo data, not measured international token traffic";
const PANELS = [
  { id: "regions", title: "Leading AI infrastructure regions", href: "/infrastructure", cls: "reported" },
  { id: "providers", title: "Leading AI providers", href: "/intelligence", cls: "reported" },
  { id: "models", title: "Model release activity", href: "/economics", cls: "reported" },
  { id: "pricing", title: "AI API pricing highlights", href: "/economics", cls: "reported" },
  { id: "infra", title: "Latest infrastructure developments", href: "/infrastructure", cls: "reported" },
  { id: "research", title: "Research highlights", href: "/intelligence", cls: "reported" },
  { id: "adoption", title: "AI adoption observations", href: "/adoption", cls: "reported" },
  { id: "freshness", title: "Data-source freshness", href: "/sources", cls: "reported" },
];
const SITE_COLOR = "#A78BFA", REGION_COLOR = "#FFB56B", LAB_COLOR = "#59C9F5";

function defaultLayout() { return PANELS.map((p, i) => ({ id: p.id, visible: true, order: i })); }
function loadLayout() {
  const saved = state.prefs.overviewLayout;
  const base = defaultLayout();
  if (!Array.isArray(saved) || !saved.length) return base;
  return base.map(b => {
    const s = saved.find(x => x && x.id === b.id);
    return s ? { id: b.id, visible: s.visible !== false, order: Number.isFinite(s.order) ? s.order : b.order } : b;
  }).sort((a, b) => a.order - b.order);
}

export async function mount(ctx) {
  const main = document.getElementById("main");
  main.innerHTML = '<div class="workspace" data-screen-label="overview">' +
    ui.workspaceHeader({
      title: "Global AI Observatory",
      sub: "A modular intelligence platform for the world's AI economy. Token flows are a synthetic demonstration; infrastructure, models, pricing, adoption and research are sourced public records with explicit provenance.",
      actions: '<button class="btn sm" id="ov-flows" type="button">Explore token flows</button><a class="btn sm ghost" data-link href="/sources">Sources & health</a>',
      context: '<div class="disclaimer"><span class="dot"></span>' + DISCLAIMER + "</div>"
    }) +
    '<div id="ov-stats">' + ui.loadingBlock("Loading coverage…") + "</div>" +
    '<div class="ov-grid"><section class="ov-stage">' +
      '<div class="stage-head"><span class="stage-title">Geographic intelligence engine</span><span class="stage-actions">' +
        '<button class="btn sm" id="ov-mode" type="button">Flat map</button>' +
        '<button class="btn sm" id="ov-rotate" type="button" aria-pressed="true">Auto-rotate</button>' +
        '<button class="btn sm" id="ov-power" type="button" aria-pressed="' + state.lowPower + '">Low power</button>' +
      "</span></div>" +
      '<div class="layer-catalogue" id="ov-layers"></div>' +
      '<div id="ov-geo" style="position:relative;height:420px"></div>' +
      '<div class="stage-foot"><span class="disclaimer" style="font-size:11px"><span class="dot"></span>' + DISCLAIMER + '</span><span class="stage-note" id="ov-note"></span></div>' +
    '</section><aside class="ov-inspect" id="ov-inspect"></aside></div>' +
    '<div class="panel-layout-bar"><span class="panel-title" style="border:0;padding:0">Intelligence panels</span>' +
      '<span class="mono-note">show / hide · reorder · saved to your preferences</span>' +
      '<button class="btn sm" id="ov-reset" type="button">Reset layout</button></div>' +
    '<div class="ov-panels" id="ov-panels"></div></div>';

  const [ovR, flowsR, countriesR, infraR, modelsR, providersR] = await Promise.all([
    apiGet("/overview"), apiGet("/flows?all=1", { ttlMs: 60000 }), apiGet("/countries", { ttlMs: 300000 }),
    apiGet("/infrastructure"), apiGet("/models", { ttlMs: 60000 }), apiGet("/providers", { ttlMs: 60000 }),
  ]);
  const ov = ovR.ok ? ovR.data : null;
  const coords = Object.assign({}, COUNTRY_COORDS);
  const countryRows = countriesR.ok ? countriesR.data : [];
  for (const c of countryRows) if (!coords[c.iso3]) coords[c.iso3] = { name: c.name, lon: c.lon, lat: c.lat };
  const infra = infraR.ok ? infraR.data : { sites: [], regions: [] };
  const models = modelsR.ok ? modelsR.data : [];
  const providers = providersR.ok ? providersR.data : [];

  /* coverage statistics */
  const cov = ov && ov.coverage;
  document.getElementById("ov-stats").innerHTML = cov ? ui.statRow([
    { label: "Token observations", value: fmtExact(cov.flow_records), sub: cov.flow_periods + " demo periods · synthetic", tone: "violet", exact: cov.flow_records, unit: "records" },
    { label: "Countries referenced", value: String(cov.countries), sub: "canonical reference layer" },
    { label: "Providers", value: String(cov.providers), sub: "curated registry", tone: "amber" },
    { label: "Models catalogued", value: String(cov.models), sub: cov.models_with_pricing + " with pricing", tone: "cyan" },
    { label: "Infrastructure sites", value: String(cov.infrastructure_sites), sub: cov.cloud_regions + " cloud regions", tone: "violet" },
    { label: "Research signals", value: String(cov.intelligence_signals), sub: cov.adoption_observations + " adoption obs.", tone: "amber" },
  ]) : ui.errorState(ovR.error, "ov-retry");

  /* layer catalogue (shared geographic state) */
  const LAYERS = [
    { id: "flows", label: "Token flows (synthetic)" },
    { id: "sites", label: "Infrastructure sites" },
    { id: "regions", label: "Cloud regions" },
  ];
  function renderLayers() {
    document.getElementById("ov-layers").innerHTML = LAYERS.map(l =>
      '<button class="layer-toggle" type="button" data-layer="' + l.id + '" aria-pressed="' + state.activeLayers.includes(l.id) + '"><span class="lt-dot"></span>' + ui.h(l.label) + "</button>").join("");
    for (const b of document.querySelectorAll("[data-layer]")) b.addEventListener("click", () => {
      setLayerVisible(b.dataset.layer, !state.activeLayers.includes(b.dataset.layer));
      renderLayers(); applyLayers();
    });
  }
  let globe = null, flat = null, mode = state.geoMode === "flat" ? "flat" : "globe";
  const geoEl = document.getElementById("ov-geo");

  function markerItems() {
    const items = [];
    if (state.activeLayers.includes("sites")) for (const s of infra.sites) {
      if (s.lat == null || s.lon == null) continue;
      items.push({ lon: s.lon, lat: s.lat, color: s.facility_type === "research_lab" ? LAB_COLOR : SITE_COLOR, radius: 3.4, ring: s.status === "operational", kind: "site", id: s.id, name: s.name, href: "/infrastructure?focus=" + encodeURIComponent(s.id) });
    }
    if (state.activeLayers.includes("regions")) for (const r of infra.regions) {
      if (r.lat == null || r.lon == null) continue;
      items.push({ lon: r.lon, lat: r.lat, color: REGION_COLOR, radius: 2.2, ring: false, kind: "region", id: r.id, name: r.provider_name + " " + r.region_code, href: "/infrastructure?focus=" + encodeURIComponent(r.id) });
    }
    return items;
  }
  function applyLayers() {
    const items = markerItems();
    if (globe) {
      globe.setLayers([{ id: "markers", type: "markers", items, visible: true }]);
      globe.setShowRoutes(state.activeLayers.includes("flows"));
    }
    if (flat) flat.setMarkers(items.map(m => Object.assign({}, m, { radius: 3 })));
  }
  function renderInspect(iso) {
    const box = document.getElementById("ov-inspect");
    if (!iso) {
      box.innerHTML = ui.panel({ title: "Country inspection", body: ui.emptyState("No country selected", "Click a country on the globe or map, or press Ctrl+K to search. Full profiles combine infrastructure, providers, flows, adoption and research."), link: { href: "/countries/IND", label: "Example: India" } });
      return;
    }
    const c = coords[iso];
    const recs = globe ? globe.agg.recordsFor(globe.getSnapshot().period) : [];
    const m = globe ? globe.agg.countryMetrics(iso, recs) : null;
    const sites = infra.sites.filter(s => s.country_iso3 === iso);
    const regions = infra.regions.filter(r => r.country_iso3 === iso);
    box.innerHTML = ui.panel({
      title: "Country — " + ((c && c.name) || iso),
      tools: '<button class="btn sm" id="ov-focus" type="button">Focus</button>',
      link: { href: "/countries/" + iso, label: "Full profile" },
      body: (m ? '<div class="subhead">Token flows · synthetic</div>' + ui.kv([
        ["Associated serving volume", fmtCompact(m.serving.total), "", fmtExact(m.serving.total) + " tokens"],
        ["Associated consumption volume", fmtCompact(m.consuming.total), "", fmtExact(m.consuming.total) + " tokens"],
        ["Serving partners", String(m.serving.partners)],
      ]) : "") +
        '<div class="subhead">Sourced infrastructure</div>' + ui.kv([
          ["Infrastructure sites", String(sites.length)],
          ["Cloud regions (availability)", String(regions.length)],
        ]) +
        (sites.length ? ui.table({ columns: [{ key: "name", label: "Site" }, { key: "status", label: "Status", render: r => ui.statusBadge(r.status) }], rows: sites.slice(0, 4) })
          : ui.note("No sourced infrastructure records for this country yet — a coverage gap, not evidence of absence.")),
    });
    const f = document.getElementById("ov-focus");
    if (f) f.addEventListener("click", () => { if (globe && c) globe.spotlightTo(c.lon, c.lat); });
  }
  async function mountGeo() {
    geoEl.innerHTML = "";
    if (mode === "globe") {
      if (!flowsR.ok) { geoEl.innerHTML = ui.errorState(flowsR.error, "ov-retry"); return; }
      globe = createGlobe(geoEl, { flows: flowsR.data.records, countries: coords, lowPower: state.lowPower, autoRotate: state.autoRotate && !state.reducedMotion, onAnnounce: announce });
      globe.on("change", snap => {
        document.getElementById("ov-note").textContent = periodLabel(snap.period) + " · " + snap.routeCount + " routes · " + snap.countryCount + " countries · " + snap.particles + "/" + snap.particleBudget + " particles";
        const rot = document.getElementById("ov-rotate"); if (rot) rot.setAttribute("aria-pressed", String(snap.autoRotate));
        if (snap.selectedCountry !== state.selectedCountry) selectCountry(snap.selectedCountry, "globe");
        renderInspect(snap.selectedCountry);
      });
      globe.on("select-marker", m => { if (m && m.href) navigate(m.href); });
      globe.on("error", e => announce("Geographic engine error: " + e.message));
      await globe.mount();
      if (state.selectedCountry) globe.selectCountry(state.selectedCountry, false);
      applyLayers(); renderInspect(state.selectedCountry);
    } else {
      flat = createFlatMap(geoEl, { countries: coords, onSelect: iso => { selectCountry(iso); renderInspect(iso); } });
      whenGeoReady(async () => { try { flat.setFeatures(await loadCountryFeatures(countryRows)); applyLayers(); } catch (err) { console.warn("[overview] flat geometry unavailable", err); } });
      document.getElementById("ov-note").textContent = "Equirectangular reference map · click a country to inspect";
      renderInspect(state.selectedCountry);
    }
  }
  function destroyGeo() { if (globe) { globe.destroy(); globe = null; } if (flat) { flat.destroy(); flat = null; } }

  /* eight intelligence panels */
  let layout = loadLayout();
  const modelCountByProvider = {};
  for (const m of models) modelCountByProvider[m.provider_id] = (modelCountByProvider[m.provider_id] || 0) + 1;
  function panelBody(id) {
    if (!ov) return ui.errorState(ovR.error, "ov-retry");
    switch (id) {
      case "regions": {
        const rows = (ov.infrastructure.regions_by_country || []).slice(0, 8);
        if (!rows.length) return ui.emptyState("No cloud-region records", "Public cloud-region endpoints have not been ingested. Run npm run ingest. Coverage gaps are never shown as zero activity.");
        return ui.rankList(rows.map(r => ({ code: r.country_iso3, name: (coords[r.country_iso3] || {}).name || r.country_iso3, total: r.regions })), { hrefFn: r => "/infrastructure?country=" + r.code, barTone: "amber" }) +
          ui.note("Cloud-region availability, NOT inference-serving geography. Counts are compatible (regions per country).");
      }
      case "providers": {
        const rows = providers.map(p => ({ code: p.slug, name: p.name, total: modelCountByProvider[p.id] || 0 })).filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
        if (!rows.length) return ui.emptyState("No provider model counts", "Model catalogue ingestion has not run yet.");
        return ui.rankList(rows, { hrefFn: r => "/providers/" + r.code, barTone: "cyan" }) + ui.note("Models catalogued per provider from public catalogues. Headquarters country is not inference-serving geography.");
      }
      case "models": {
        const rows = (ov.models.recent || []).slice(0, 8);
        if (!rows.length) return ui.emptyState("No model records", "Public model catalogues populate this panel (npm run ingest).");
        return ui.table({ columns: [
          { key: "name", label: "Model", render: r => '<a data-link href="/models/' + encodeURIComponent(r.slug) + '">' + ui.h(r.name) + "</a>" },
          { key: "release_date", label: "Released", render: r => r.release_date ? ui.h(String(r.release_date).slice(0, 10)) : '<span class="gap-tag">not documented</span>' },
          { key: "source_id", label: "Source" },
        ], rows });
      }
      case "pricing": {
        const rows = (ov.economics.highlights || []).slice(0, 8);
        if (!rows.length) return ui.emptyState("No pricing observations", "Official pricing has not been ingested. Prices are never estimated or fabricated.");
        return ui.table({ columns: [
          { key: "model_slug", label: "Model", render: r => '<a data-link href="/models/' + encodeURIComponent(r.model_slug) + '">' + ui.h(r.model_slug) + "</a>" },
          { key: "category", label: "Category" },
          { key: "price", label: "USD / M tokens", numeric: true, render: r => "$" + r.price },
        ], rows }) + ui.note("Normalized to USD per million tokens; original price and unit retained in Economics.");
      }
      case "infra": {
        const rows = (ov.infrastructure.recent_sites || []).slice(0, 8);
        if (!rows.length) return ui.emptyState("No infrastructure records", "The sourced reference dataset is empty until ingestion runs.");
        return ui.table({ columns: [
          { key: "name", label: "Facility", render: r => '<a data-link href="/infrastructure?focus=' + encodeURIComponent(r.id) + '">' + ui.h(r.name) + "</a>" },
          { key: "country_iso3", label: "Country" },
          { key: "status", label: "Status", render: r => ui.statusBadge(r.status) },
        ], rows }) + ui.note("Announced ≠ commissioned. Coordinates are city/county reference points.");
      }
      case "research": {
        const list = (ov.intelligence.latest || []).slice(0, 6);
        if (!list.length) return ui.emptyState("No research signals", "Public research feeds (arXiv) have not been ingested. No items are fabricated.");
        return '<ul class="feed-list">' + list.map(i => '<li class="feed-item"><a class="feed-headline" href="' + ui.h(i.source_url) + '" target="_blank" rel="noopener noreferrer">' + ui.h(i.headline) + '</a><div class="feed-meta">' + ui.h(i.source_name || "") + " · published " + ui.h(String(i.published_at || "").slice(0, 10)) + " " + ui.evidenceBadge(i.evidence_class) + "</div></li>").join("") + "</ul>";
      }
      case "adoption": {
        const obs = (ov.adoption.observations || []).slice(0, 8);
        if (!obs.length) return ui.emptyState("No adoption observations", "Official adoption statistics have not been ingested. Survey coverage differs by country and is never interpolated.");
        return ui.table({ columns: [
          { key: "country_iso3", label: "Country", render: r => '<a data-link href="/countries/' + r.country_iso3 + '">' + ui.h((coords[r.country_iso3] || {}).name || r.country_iso3) + "</a>" },
          { key: "metric_id", label: "Metric", render: r => ui.h(r.metric_id.replace(/^eurostat-/, "").replace(/-ge10$/, "")) },
          { key: "value", label: "%", numeric: true, render: r => r.value + (r.unit === "percent" ? "%" : "") },
          { key: "reference_period", label: "Period" },
        ], rows: obs }) + ui.note("Eurostat enterprise AI survey (10+ employed). Not a global ranking; methodologies are never blended.");
      }
      case "freshness": {
        const rows = ov.sources || [];
        if (!rows.length) return ui.emptyState("No sources registered", "The source registry is empty.");
        return ui.table({ columns: [
          { key: "name", label: "Source", render: r => '<a data-link href="/sources">' + ui.h(r.name) + "</a>" },
          { key: "status", label: "Status", render: r => '<span class="badge ' + ui.h(r.status) + '"><span class="bdot"></span>' + ui.h(r.status) + "</span>" },
          { key: "freshness", label: "Freshness", render: r => ui.freshnessBadge(r.freshness) },
        ], rows: rows.slice(0, 10) });
      }
      default: return ui.emptyState("Unknown panel", "");
    }
  }
  function renderPanels() {
    const box = document.getElementById("ov-panels");
    box.innerHTML = layout.map((l, idx) => {
      const def = PANELS.find(p => p.id === l.id);
      const controls = '<span class="layout-controls">' +
        '<button class="btn sm icon" type="button" data-move="' + l.id + ':-1" aria-label="Move panel up"' + (idx === 0 ? " disabled" : "") + ">↑</button>" +
        '<button class="btn sm icon" type="button" data-move="' + l.id + ':1" aria-label="Move panel down"' + (idx === layout.length - 1 ? " disabled" : "") + ">↓</button>" +
        '<button class="btn sm icon" type="button" data-vis="' + l.id + '" aria-pressed="' + l.visible + '" aria-label="Show or hide panel">' + (l.visible ? "◉" : "○") + "</button></span>";
      if (!l.visible) return '<div class="panel-hidden"><span>' + ui.h(def.title) + " — hidden</span>" + controls + "</div>";
      return "<div>" + ui.panel({ title: def.title, tools: controls, link: { href: def.href, label: "Open" }, body: panelBody(l.id) }) + "</div>";
    }).join("");
    for (const b of box.querySelectorAll("[data-move]")) b.addEventListener("click", () => {
      const parts = b.dataset.move.split(":"); const i = layout.findIndex(x => x.id === parts[0]); const j = i + Number(parts[1]);
      if (j < 0 || j >= layout.length) return;
      const t = layout[i]; layout[i] = layout[j]; layout[j] = t;
      layout.forEach((x, k) => x.order = k); persist(); renderPanels();
    });
    for (const b of box.querySelectorAll("[data-vis]")) b.addEventListener("click", () => {
      const l = layout.find(x => x.id === b.dataset.vis); l.visible = !l.visible; persist(); renderPanels();
    });
  }
  function persist() { savePrefs({ overviewLayout: layout.map(l => ({ id: l.id, visible: l.visible, order: l.order })) }); }

  /* wiring */
  const onDocClick = e => { if (e.target && e.target.id === "ov-retry") navigate("/"); };
  document.addEventListener("click", onDocClick);
  document.getElementById("ov-flows").addEventListener("click", () => navigate("/flows"));
  document.getElementById("ov-reset").addEventListener("click", () => { layout = defaultLayout(); persist(); renderPanels(); announce("Overview layout reset"); });
  document.getElementById("ov-mode").addEventListener("click", async () => {
    mode = mode === "globe" ? "flat" : "globe";
    document.getElementById("ov-mode").textContent = mode === "globe" ? "Flat map" : "Globe";
    state.geoMode = mode; destroyGeo(); await mountGeo();
  });
  document.getElementById("ov-rotate").addEventListener("click", () => { if (globe) globe.setAutoRotate(!globe.getState().autoRotate); });
  document.getElementById("ov-power").addEventListener("click", e => {
    state.lowPower = !state.lowPower; e.currentTarget.setAttribute("aria-pressed", String(state.lowPower));
    savePrefs({ lowPower: state.lowPower }); if (globe) globe.setLowPower(state.lowPower);
  });
  document.getElementById("ov-mode").textContent = mode === "globe" ? "Flat map" : "Globe";
  renderLayers(); renderPanels();
  await mountGeo();

  return { destroy() { document.removeEventListener("click", onDocClick); destroyGeo(); } };
}
