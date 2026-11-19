// Workspace 5 — AI Adoption Observatory. Official survey observations on a
// choropleth, with metric definitions, ranked comparison, coverage gaps and
// an explicit comparability warning. Missing countries are never coloured as zero.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate, setParams } from "../app/router.js";
import { state, selectCountry, announce } from "../app/state.js";
import { createGlobe } from "../geography/globe.js";
import { createFlatMap } from "../geography/flatmap.js";
import { loadCountryFeatures, whenGeoReady } from "../geography/atlas.js";
import { COUNTRY_COORDS } from "../geography/country-reference.js";

// Sequential scale built from existing tokens: country fill -> input cyan.
function scaleColor(t) {
  const a = [22, 40, 58], b = [89, 201, 245];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t))));
  return "rgb(" + c.join(",") + ")";
}

export async function mount(ctx) {
  const main = document.getElementById("main");
  const p = ctx.params || {};
  const [adR, countriesR] = await Promise.all([apiGet("/adoption", { ttlMs: 0 }), apiGet("/countries", { ttlMs: 300000 })]);
  if (!adR.ok) {
    main.innerHTML = '<div class="workspace" data-screen-label="adoption">' + ui.workspaceHeader({ title: "AI Adoption Observatory", sub: "Official adoption indicators." }) + ui.errorState(adR.error, "ad-retry") + "</div>";
    const h = e => { if (e.target.id === "ad-retry") navigate("/adoption"); };
    document.addEventListener("click", h);
    return { destroy() { document.removeEventListener("click", h); } };
  }
  const data = adR.data;
  const coords = Object.assign({}, COUNTRY_COORDS);
  const countryRows = countriesR.ok ? countriesR.data : [];
  for (const c of countryRows) if (!coords[c.iso3]) coords[c.iso3] = { name: c.name, lon: c.lon, lat: c.lat };
  const nameOf = iso => (coords[iso] || {}).name || iso;
  const metrics = data.metrics || [];
  const observations = data.observations || [];
  let metricId = p.metric || (metrics.find(m => m.id.includes("tany")) || metrics[0] || {}).id || "";
  let region = p.region || "";
  let country = p.country || "";
  let mode = state.geoMode === "flat" ? "flat" : "globe";

  const periodsFor = mid => [...new Set(observations.filter(o => o.metric_id === mid).map(o => o.reference_period))].sort();
  let period = p.period || (periodsFor(metricId).slice(-1)[0] || "");

  main.innerHTML = '<div class="workspace" data-screen-label="adoption">' +
    ui.workspaceHeader({
      title: "AI Adoption Observatory",
      sub: "Official, attributed adoption indicators. Surveys with different methodologies are never merged into one unqualified global ranking; missing countries are coverage gaps, not zeros.",
      actions: '<button class="btn sm" id="ad-mode" type="button">Flat map</button>',
      context: '<div class="disclaimer"><span class="dot"></span>' + ui.h(data.warning || "") + "</div>"
    }) +
    '<div class="filters" id="ad-filters"></div>' +
    '<div class="adopt-grid"><div class="adopt-stage" id="ad-stage"></div><aside class="stack" id="ad-side"></aside></div>' +
    '<div class="section-head"><h2>Ranked comparison</h2><span class="mono-note" id="ad-rank-note"></span></div>' +
    '<div id="ad-rank"></div>' +
    '<div class="section-head"><h2>Coverage</h2><span class="mono-note">gaps are explicit, never interpolated</span></div>' +
    '<div id="ad-coverage"></div></div>';

  function currentRows() {
    return observations.filter(o => o.metric_id === metricId && o.reference_period === period &&
      (!region || (countryRows.find(c => c.iso3 === o.country_iso3) || {}).region === region) &&
      (!country || o.country_iso3 === country));
  }
  function metric() { return metrics.find(m => m.id === metricId) || null; }

  /* filters */
  const regions = [...new Set(countryRows.map(c => c.region).filter(Boolean))].sort();
  function renderFilters() {
    const periods = periodsFor(metricId);
    document.getElementById("ad-filters").innerHTML =
      '<div class="field" style="min-width:280px"><label for="ad-metric">Metric</label><select class="input" id="ad-metric">' +
        metrics.map(m => '<option value="' + ui.h(m.id) + '"' + (m.id === metricId ? " selected" : "") + ">" + ui.h(m.name) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ad-period">Reference period</label><select class="input" id="ad-period">' +
        periods.map(y => '<option value="' + ui.h(y) + '"' + (y === period ? " selected" : "") + ">" + ui.h(y) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ad-region">Region</label><select class="input" id="ad-region"><option value="">All regions</option>' +
        regions.map(r => '<option value="' + ui.h(r) + '"' + (r === region ? " selected" : "") + ">" + ui.h(r) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ad-country">Country</label><select class="input" id="ad-country"><option value="">All countries</option>' +
        countryRows.map(c => c.iso3).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(iso => '<option value="' + iso + '"' + (iso === country ? " selected" : "") + ">" + ui.h(nameOf(iso)) + "</option>").join("") + "</select></div>";
    document.getElementById("ad-metric").addEventListener("change", e => { metricId = e.target.value; period = periodsFor(metricId).slice(-1)[0] || ""; syncUrl(); renderFilters(); renderAll(); });
    document.getElementById("ad-period").addEventListener("change", e => { period = e.target.value; syncUrl(); renderAll(); });
    document.getElementById("ad-region").addEventListener("change", e => { region = e.target.value; syncUrl(); renderAll(); });
    document.getElementById("ad-country").addEventListener("change", e => { country = e.target.value; syncUrl(); renderAll(); });
  }
  function syncUrl() { setParams({ metric: metricId, period, region, country }); }

  /* geographic engine + choropleth */
  let globe = null, flat = null;
  const stage = document.getElementById("ad-stage");
  function choroplethValues() {
    const rows = currentRows();
    const vals = {};
    for (const o of rows) vals[o.country_iso3] = o.value;
    return vals;
  }
  function applyChoropleth() {
    const vals = choroplethValues();
    const nums = Object.values(vals);
    const min = nums.length ? Math.min(...nums) : 0, max = nums.length ? Math.max(...nums) : 1;
    const span = max - min || 1;
    const color = v => scaleColor((v - min) / span);
    if (globe) globe.setLayers([{ id: "adoption", type: "choropleth", values: vals, color, visible: true }]);
    if (flat) { const map = {}; for (const k of Object.keys(vals)) map[k] = color(vals[k]); flat.setChoropleth(map); }
    return { min, max, n: nums.length };
  }
  async function mountGeo() {
    stage.innerHTML = "";
    if (mode === "globe") {
      globe = createGlobe(stage, { flows: [], countries: coords, lowPower: state.lowPower, autoRotate: state.autoRotate && !state.reducedMotion, onAnnounce: announce });
      globe.on("change", snap => { if (snap.selectedCountry !== state.selectedCountry) selectCountry(snap.selectedCountry, "globe"); renderSide(); });
      globe.on("error", () => {});
      await globe.mount();
      globe.setShowRoutes(false); globe.setShowInput(false); globe.setShowOutput(false);
      if (state.selectedCountry) globe.selectCountry(state.selectedCountry, false);
      applyChoropleth();
    } else {
      flat = createFlatMap(stage, { countries: coords, onSelect: iso => { selectCountry(iso); renderSide(); } });
      whenGeoReady(async () => { try { flat.setFeatures(await loadCountryFeatures(countryRows)); applyChoropleth(); } catch (err) { console.warn("[adoption] flat geometry unavailable", err); } });
    }
  }
  function destroyGeo() { if (globe) { globe.destroy(); globe = null; } if (flat) { flat.destroy(); flat = null; } }

  /* side: metric definition + selected country + scale */
  function renderSide() {
    const m = metric();
    const scale = applyChoropleth();
    const iso = state.selectedCountry || country;
    const obs = iso ? observations.filter(o => o.country_iso3 === iso && o.metric_id === metricId).sort((a, b) => a.reference_period.localeCompare(b.reference_period)) : [];
    let html = ui.panel({
      title: "Metric definition", tools: m ? ui.evidenceBadge("reported") : "",
      body: m ? ui.kv([
        ["Indicator", m.name],
        ["Definition", m.definition || "—"],
        ["Unit", m.unit || "—"],
        ["Scope", m.scope || "—"],
        ["Methodology", m.methodology || "—"],
        ["Source", m.source_id || "—"],
      ]) : ui.emptyState("No metric", "No adoption metrics are registered."),
    });
    html += ui.panel({
      title: "Scale", body: '<div class="legend-scale"><span>' + scale.min.toFixed(1) + '%</span><span class="ramp"></span><span>' + scale.max.toFixed(1) + "%</span></div>" +
        ui.note(scale.n + " countries coloured for " + period + ". Uncoloured countries have no observation — a coverage gap, never a zero. Scale is min–max of the current selection."),
    });
    if (iso) {
      html += ui.panel({
        title: "Country — " + nameOf(iso), link: { href: "/countries/" + iso, label: "Full profile" },
        body: obs.length ? ui.table({ columns: [
          { key: "reference_period", label: "Period" },
          { key: "value", label: "%", numeric: true, render: r => r.value + "%" },
          { key: "publication_date", label: "Published" },
        ], rows: obs }) + (obs.length >= 2 ? ui.lineChart(obs.map(o => ({ label: o.reference_period, value: o.value })), { height: 100 }) : ui.note("Only one reference period is recorded for this metric and country; no trend is manufactured."))
          : ui.emptyState("No observation", "This country has no observation for the selected metric. It is a coverage gap, not zero adoption."),
      });
    }
    document.getElementById("ad-side").innerHTML = html;
  }

  function renderRank() {
    const rows = currentRows().slice().sort((a, b) => b.value - a.value);
    document.getElementById("ad-rank-note").textContent = rows.length + " countries · " + period + " · " + (metric() ? metric().name : "");
    document.getElementById("ad-rank").innerHTML = rows.length ? ui.panel({
      title: "Ranked by observed value", tools: ui.evidenceBadge("reported"),
      body: ui.rankList(rows.map((r, i) => ({ rank: i + 1, code: r.country_iso3, name: nameOf(r.country_iso3), total: r.value, share: null })), { hrefFn: r => "/countries/" + r.code, barTone: "cyan", valueKey: "total" }) +
        ui.note(data.warning || "Different survey methodologies are never merged into one unqualified global ranking."),
    }) : ui.emptyState("No observations for this selection", "Try a different metric, period or region. Missing data is a coverage gap, not zero.");
  }

  function renderCoverage() {
    const cov = data.coverage || { countries_covered: 0, countries_total: 0, gaps: [] };
    const gaps = (cov.gaps || []).slice(0, 60);
    document.getElementById("ad-coverage").innerHTML = ui.statRow([
      { label: "Countries covered", value: String(cov.countries_covered), sub: "any metric / period", tone: "cyan" },
      { label: "Countries in reference", value: String(cov.countries_total) },
      { label: "Coverage gaps", value: String((cov.gaps || []).length), tone: "amber", sub: "no observation" },
      { label: "Observations", value: String(observations.length), sub: metrics.length + " metrics" },
    ]) + ui.panel({
      title: "Countries with no observation",
      body: gaps.length ? '<div class="tag-row">' + gaps.map(iso => '<a class="chip" data-link href="/countries/' + iso + '">' + ui.h(nameOf(iso)) + "</a>").join("") + "</div>" +
        ui.note("These countries are absent from the sourced surveys. They are NOT coloured as zero and are NOT interpolated from neighbours.")
        : ui.emptyState("No gaps", "Every referenced country has at least one observation."),
    });
  }

  function renderAll() { applyChoropleth(); renderSide(); renderRank(); renderCoverage(); }
  document.getElementById("ad-mode").addEventListener("click", async () => {
    mode = mode === "globe" ? "flat" : "globe";
    document.getElementById("ad-mode").textContent = mode === "globe" ? "Flat map" : "Globe";
    state.geoMode = mode; destroyGeo(); await mountGeo(); renderSide();
  });
  document.getElementById("ad-mode").textContent = mode === "globe" ? "Flat map" : "Globe";

  renderFilters(); renderAll();
  await mountGeo(); renderSide();
  return { destroy() { destroyGeo(); } };
}
