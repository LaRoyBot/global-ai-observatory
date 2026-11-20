// Workspace 3 — Infrastructure Atlas. Sourced sites and cloud-region
// availability on the preserved geographic engine, with working filters,
// clustering, detail cards and explicit facility/region distinctions.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate, setParams } from "../app/router.js";
import { state, selectCountry, announce } from "../app/state.js";
import { createGlobe } from "../geography/globe.js";
import { createFlatMap } from "../geography/flatmap.js";
import { loadCountryFeatures, whenGeoReady } from "../geography/atlas.js";
import { COUNTRY_COORDS } from "../geography/country-reference.js";
import { fmtDateTime } from "../shared/formatting.js";

const SITE_COLOR = "#9ca3af", REGION_COLOR = "#ffaa00", LAB_COLOR = "#44ff88", CLUSTER_COLOR = "#e8e8e8";
const FACILITY_LABEL = { ai_datacentre: "AI datacentre", datacentre: "Datacentre", research_lab: "Research lab", cloud_region: "Cloud region", corporate_hq: "Corporate HQ", semiconductor_fab: "Semiconductor fab" };

export async function mount(ctx) {
  const main = document.getElementById("main");
  const p = ctx.params || {};
  const filters = { provider: p.provider || "", type: p.type || "", country: p.country || "", status: p.status || "", q: p.q || "", focus: p.focus || "" };
  let cluster = p.cluster === "1";
  let mode = state.geoMode === "flat" ? "flat" : "globe";

  main.innerHTML = '<div class="workspace" data-screen-label="infrastructure">' +
    ui.workspaceHeader({
      title: "Infrastructure Atlas",
      sub: "Publicly documented AI infrastructure and cloud-region availability. Every record carries its source, verification date and status. Announced capacity is planned, not commissioned.",
      actions: '<button class="btn sm" id="if-mode" type="button">Flat map</button><button class="btn sm" id="if-cluster" type="button" aria-pressed="' + cluster + '">Cluster by country</button>',
      context: '<div class="disclaimer"><span class="dot"></span>Facility presence does NOT establish where inference is served. Coordinates are city/county reference points, not surveyed locations.</div>'
    }) +
    '<div id="if-distinctions"></div>' +
    '<div class="filters" id="if-filters"></div>' +
    '<div class="infra-grid"><div class="infra-stage" id="if-stage"></div><aside class="stack" id="if-side"></aside></div>' +
    '<div class="section-head"><h2>Facilities & regions</h2><span class="mono-note" id="if-count"></span></div>' +
    '<div id="if-list"></div>' +
    '<div class="section-head"><h2>Regional concentration</h2><span class="mono-note">compatible denominators · coverage-limited</span></div>' +
    '<div class="grid-2" id="if-concentration"></div></div>';

  const [infraR, countriesR] = await Promise.all([apiGet("/infrastructure", { ttlMs: 0 }), apiGet("/countries", { ttlMs: 300000 })]);
  if (!infraR.ok) {
    document.getElementById("if-list").innerHTML = ui.errorState(infraR.error, "if-retry");
    const h = e => { if (e.target.id === "if-retry") navigate("/infrastructure"); };
    document.addEventListener("click", h);
    return { destroy() { document.removeEventListener("click", h); } };
  }
  const data = infraR.data;
  const coords = Object.assign({}, COUNTRY_COORDS);
  const countryRows = countriesR.ok ? countriesR.data : [];
  for (const c of countryRows) if (!coords[c.iso3]) coords[c.iso3] = { name: c.name, lon: c.lon, lat: c.lat };
  const nameOf = iso => (coords[iso] || {}).name || iso || "—";

  document.getElementById("if-distinctions").innerHTML = '<div class="distinctions">' +
    (data.distinctions || []).map(d => '<div class="distinction">' + ui.h(d) + "</div>").join("") + "</div>";

  /* ---- filters ---- */
  const providers = [...new Set([...data.sites.map(s => s.provider_slug), ...data.regions.map(r => r.provider_slug)].filter(Boolean))].sort();
  const types = [...new Set(data.sites.map(s => s.facility_type).filter(Boolean))].sort();
  const statuses = data.statuses || [...new Set(data.sites.map(s => s.status))];
  const countriesUsed = [...new Set([...data.sites.map(s => s.country_iso3), ...data.regions.map(r => r.country_iso3)].filter(Boolean))].sort();
  function opt(v, label, sel) { return '<option value="' + ui.h(v) + '"' + (v === sel ? " selected" : "") + ">" + ui.h(label) + "</option>"; }
  function renderFilters() {
    document.getElementById("if-filters").innerHTML =
      '<div class="field"><label for="if-q">Search</label><input class="input" id="if-q" type="search" placeholder="name, operator, city…" value="' + ui.h(filters.q) + '"></div>' +
      '<div class="field"><label for="if-provider">Provider / operator</label><select class="input" id="if-provider">' + opt("", "All", filters.provider) + providers.map(x => opt(x, x, filters.provider)).join("") + "</select></div>" +
      '<div class="field"><label for="if-type">Facility category</label><select class="input" id="if-type">' + opt("", "All", filters.type) + types.map(x => opt(x, FACILITY_LABEL[x] || x, filters.type)).join("") + "</select></div>" +
      '<div class="field"><label for="if-country">Country</label><select class="input" id="if-country">' + opt("", "All", filters.country) + countriesUsed.map(x => opt(x, nameOf(x), filters.country)).join("") + "</select></div>" +
      '<div class="field"><label for="if-status">Status</label><select class="input" id="if-status">' + opt("", "All", filters.status) + statuses.map(x => opt(x, x.replace(/_/g, " "), filters.status)).join("") + "</select></div>" +
      '<button class="btn sm ghost" id="if-clear" type="button">Clear filters</button>';
    const q = document.getElementById("if-q");
    let t = null;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { filters.q = q.value.trim(); syncUrl(); renderAll(); }, 200); });
    for (const [id, key] of [["if-provider", "provider"], ["if-type", "type"], ["if-country", "country"], ["if-status", "status"]]) {
      document.getElementById(id).addEventListener("change", e => { filters[key] = e.target.value; syncUrl(); renderAll(); });
    }
    document.getElementById("if-clear").addEventListener("click", () => {
      Object.assign(filters, { provider: "", type: "", country: "", status: "", q: "", focus: "" });
      syncUrl(); renderFilters(); renderAll();
    });
  }
  function syncUrl() { setParams({ provider: filters.provider, type: filters.type, country: filters.country, status: filters.status, q: filters.q, focus: filters.focus, cluster: cluster ? "1" : "" }); }

  function matchSite(s) {
    if (filters.provider && s.provider_slug !== filters.provider) return false;
    if (filters.type && s.facility_type !== filters.type) return false;
    if (filters.country && s.country_iso3 !== filters.country) return false;
    if (filters.status && s.status !== filters.status) return false;
    if (filters.q) { const hay = (s.name + " " + (s.operator || "") + " " + (s.city || "")).toLowerCase(); if (!hay.includes(filters.q.toLowerCase())) return false; }
    return true;
  }
  function matchRegion(r) {
    if (filters.provider && r.provider_slug !== filters.provider) return false;
    if (filters.type && filters.type !== "cloud_region") return false;
    if (filters.country && r.country_iso3 !== filters.country) return false;
    if (filters.status && filters.status !== "available") return false;
    if (filters.q) { const hay = (r.name + " " + r.region_code + " " + (r.city || "") + " " + r.provider_name).toLowerCase(); if (!hay.includes(filters.q.toLowerCase())) return false; }
    return true;
  }

  /* ---- geographic engine ---- */
  let globe = null, flat = null;
  const stage = document.getElementById("if-stage");
  function markerItems() {
    const sites = data.sites.filter(matchSite), regions = data.regions.filter(matchRegion);
    if (cluster) {
      const byCountry = {};
      for (const s of sites) if (s.country_iso3) byCountry[s.country_iso3] = (byCountry[s.country_iso3] || 0) + 1;
      for (const r of regions) if (r.country_iso3) byCountry[r.country_iso3] = (byCountry[r.country_iso3] || 0) + 1;
      return Object.entries(byCountry).map(([iso, n]) => {
        const c = coords[iso]; if (!c) return null;
        return { lon: c.lon, lat: c.lat, color: CLUSTER_COLOR, radius: Math.min(11, 3 + Math.sqrt(n) * 1.7), ring: true, kind: "cluster", id: iso, name: nameOf(iso) + " · " + n + " records", country: iso };
      }).filter(Boolean);
    }
    const items = [];
    for (const s of sites) if (s.lat != null && s.lon != null) items.push({ lon: s.lon, lat: s.lat, color: s.facility_type === "research_lab" ? LAB_COLOR : SITE_COLOR, radius: 3.6, ring: s.status === "operational", kind: "site", id: s.id, name: s.name, href: "/infrastructure?focus=" + encodeURIComponent(s.id) });
    for (const r of regions) if (r.lat != null && r.lon != null) items.push({ lon: r.lon, lat: r.lat, color: REGION_COLOR, radius: 2.3, ring: false, kind: "region", id: r.id, name: r.provider_name + " " + r.region_code, href: "/infrastructure?focus=" + encodeURIComponent(r.id) });
    return items;
  }
  function applyMarkers() {
    const items = markerItems();
    if (globe) globe.setLayers([{ id: "markers", type: "markers", items, visible: true }]);
    if (flat) flat.setMarkers(items.map(m => Object.assign({}, m, { radius: Math.min(7, m.radius) })));
  }
  function onMarker(m) {
    if (!m) return;
    if (m.kind === "cluster") { filters.country = m.country; syncUrl(); renderFilters(); renderAll(); announce("Filtered to " + nameOf(m.country)); return; }
    filters.focus = m.id; syncUrl(); renderDetail();
  }
  async function mountGeo() {
    stage.innerHTML = "";
    if (mode === "globe") {
      // The engine requires a flow dataset; the atlas uses an empty synthetic
      // set so no arcs are drawn — markers are the only geographic layer.
      globe = createGlobe(stage, { flows: [], countries: coords, lowPower: state.lowPower, autoRotate: state.autoRotate && !state.reducedMotion, onAnnounce: announce });
      globe.on("select-marker", onMarker);
      globe.on("error", () => {});
      globe.on("change", () => {});
      await globe.mount();
      globe.setShowRoutes(false); globe.setShowInput(false); globe.setShowOutput(false);
      applyMarkers();
    } else {
      flat = createFlatMap(stage, { countries: coords, onSelect: iso => { selectCountry(iso); } });
      whenGeoReady(async () => { try { flat.setFeatures(await loadCountryFeatures(countryRows)); applyMarkers(); } catch (err) { console.warn("[infra] flat geometry unavailable", err); } });
    }
  }
  function destroyGeo() { if (globe) { globe.destroy(); globe = null; } if (flat) { flat.destroy(); flat = null; } }

  /* ---- detail card ---- */
  function renderDetail() {
    const box = document.getElementById("if-side");
    const site = data.sites.find(s => s.id === filters.focus);
    const region = data.regions.find(r => r.id === filters.focus);
    let html = "";
    if (site) {
      html += ui.panel({
        title: site.name, tools: ui.statusBadge(site.status) + ui.evidenceBadge(site.evidence_class),
        body: '<div class="site-op">' + ui.h(site.operator || "operator not documented") + "</div>" + ui.kv([
          ["Country", nameOf(site.country_iso3)],
          ["City / region", site.city || "—"],
          ["Facility type", FACILITY_LABEL[site.facility_type] || site.facility_type],
          ["Reference point", site.lat != null ? site.lat.toFixed(3) + ", " + site.lon.toFixed(3) : "—", "", "City/county reference point, not a surveyed facility location"],
          ["Capacity (sourced only)", site.capacity_note || "not documented"],
          ["Accelerators (sourced only)", site.accelerator_note || "not documented"],
          ["Verified at", site.verified_at || "—"],
          ["Source", site.source_id || "—"],
        ]) + (site.notes ? ui.note(site.notes) : "") +
        '<div class="btn-row">' + ui.sourceLink(site, "Original source") + '<button class="btn sm ghost" id="if-close-detail" type="button">Close</button></div>',
      });
    } else if (region) {
      html += ui.panel({
        title: region.provider_name + " · " + region.region_code, tools: '<span class="badge available"><span class="bdot"></span>region available</span>' + ui.evidenceBadge(region.evidence_class),
        body: ui.kv([
          ["Region name", region.name],
          ["Country", region.country_iso3 ? nameOf(region.country_iso3) : "not mapped"],
          ["City", region.city || "—"],
          ["Verified at", region.verified_at || "—"],
        ]) + ui.note(region.notes || "Cloud-region availability is not evidence of inference-serving geography.") +
        '<div class="btn-row">' + ui.sourceLink(region, "Original source") + '<button class="btn sm ghost" id="if-close-detail" type="button">Close</button></div>',
      });
    }
    const sites = data.sites.filter(matchSite), regions = data.regions.filter(matchRegion);
    html += ui.panel({
      title: "Selection summary",
      body: ui.kv([["Matching facilities", String(sites.length)], ["Matching cloud regions", String(regions.length)], ["Operational facilities", String(sites.filter(s => s.status === "operational").length)]]) +
        ui.note("Counts reflect the current filters and the sourced reference dataset only. They are not a census of global AI infrastructure."),
    });
    box.innerHTML = html;
    const close = document.getElementById("if-close-detail");
    if (close) close.addEventListener("click", () => { filters.focus = ""; syncUrl(); renderDetail(); });
  }

  /* ---- list ---- */
  function renderList() {
    const sites = data.sites.filter(matchSite), regions = data.regions.filter(matchRegion);
    document.getElementById("if-count").textContent = sites.length + " facilities · " + regions.length + " cloud regions";
    let html = "";
    if (!sites.length && !regions.length) {
      html = ui.emptyState("No records match these filters", "This is a coverage gap in the sourced reference dataset, not evidence that no infrastructure exists. Clear filters or run npm run ingest to refresh sources.");
    } else {
      if (sites.length) html += ui.panel({ title: "Facilities (" + sites.length + ")", body: ui.table({ columns: [
        { key: "name", label: "Facility", render: r => '<a href="#" data-focus="' + ui.h(r.id) + '">' + ui.h(r.name) + "</a>" },
        { key: "operator", label: "Operator", render: r => ui.h(r.operator || "—") },
        { key: "country_iso3", label: "Country", render: r => nameOf(r.country_iso3) },
        { key: "facility_type", label: "Type", render: r => FACILITY_LABEL[r.facility_type] || r.facility_type },
        { key: "status", label: "Status", render: r => ui.statusBadge(r.status) },
        { key: "verified_at", label: "Verified" },
      ], rows: sites }) });
      if (regions.length) html += ui.panel({ title: "Cloud regions (" + regions.length + ")", body: ui.table({ columns: [
        { key: "region_code", label: "Region", render: r => '<a href="#" data-focus="' + ui.h(r.id) + '">' + ui.h(r.region_code) + "</a>" },
        { key: "name", label: "Name" },
        { key: "provider_name", label: "Provider" },
        { key: "country_iso3", label: "Country", render: r => r.country_iso3 ? nameOf(r.country_iso3) : '<span class="gap-tag">not mapped</span>' },
        { key: "city", label: "City", render: r => r.city || "—" },
      ], rows: regions.slice(0, 100) }) + (regions.length > 100 ? ui.note("Showing first 100 of " + regions.length + " regions. Narrow the filters to see the rest.") : "") });
    }
    document.getElementById("if-list").innerHTML = html;
    for (const a of document.querySelectorAll("[data-focus]")) a.addEventListener("click", e => { e.preventDefault(); filters.focus = a.dataset.focus; syncUrl(); renderDetail(); });
  }

  function renderConcentration() {
    const byCountry = data.by_country || [], regionsByCountry = data.regions_by_country || [];
    document.getElementById("if-concentration").innerHTML =
      ui.panel({ title: "Facilities by country", body: byCountry.length ? ui.table({ columns: [
        { key: "country_iso3", label: "Country", render: r => '<a data-link href="/countries/' + r.country_iso3 + '">' + nameOf(r.country_iso3) + "</a>" },
        { key: "sites", label: "Sites", numeric: true },
        { key: "ai_datacentres", label: "AI datacentres", numeric: true },
        { key: "operational", label: "Operational", numeric: true },
      ], rows: byCountry }) : ui.emptyState("No facility records", "Coverage gap, not zero activity."),
        tools: ui.evidenceBadge("reported") }) +
      ui.panel({ title: "Cloud regions by country", body: regionsByCountry.length ? ui.table({ columns: [
        { key: "country_iso3", label: "Country", render: r => '<a data-link href="/countries/' + r.country_iso3 + '">' + nameOf(r.country_iso3) + "</a>" },
        { key: "regions", label: "Regions", numeric: true },
      ], rows: regionsByCountry }) : ui.emptyState("No region records", "Coverage gap, not zero availability."),
        tools: ui.evidenceBadge("reported") }) +
      ui.note("These are counts of sourced records, not compute capacity. No capacity heatmap is shown because comparable, verified capacity data does not exist for most facilities. Region availability and facility presence are different denominators and are never summed.");
  }

  function renderAll() { applyMarkers(); renderDetail(); renderList(); }

  document.getElementById("if-mode").addEventListener("click", async () => {
    mode = mode === "globe" ? "flat" : "globe";
    document.getElementById("if-mode").textContent = mode === "globe" ? "Flat map" : "Globe";
    state.geoMode = mode; destroyGeo(); await mountGeo();
  });
  document.getElementById("if-cluster").addEventListener("click", e => {
    cluster = !cluster; e.currentTarget.setAttribute("aria-pressed", String(cluster)); syncUrl(); applyMarkers();
    announce(cluster ? "Markers clustered by country" : "Individual markers shown");
  });
  document.getElementById("if-mode").textContent = mode === "globe" ? "Flat map" : "Globe";

  renderFilters(); renderConcentration(); renderAll();
  await mountGeo();
  if (filters.focus) renderDetail();

  return { destroy() { destroyGeo(); } };
}
