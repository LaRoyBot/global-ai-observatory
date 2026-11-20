// Workspace 2 — AI Token Flows. The signature experience.
// The preserved globe engine is mounted here; every number comes from the same
// canonical flow dataset through one aggregation layer.
import { createGlobe } from "../geography/globe.js";
import { createFlatMap } from "../geography/flatmap.js";
import { COUNTRY_COORDS } from "../geography/country-reference.js";
import { apiGet } from "../app/api.js";
import * as router from "../app/router.js";
import { state as appState, patch, selectCountry, announce } from "../app/state.js";
import * as ui from "../components/ui.js";
import { periodLabel, periodShort, fmtCompact, fmtExact, fmtPct } from "../shared/formatting.js";

const DISCLAIMER = "Synthetic demo data, not measured international token traffic";

export async function mount(ctx) {
  const main = document.getElementById("main");
  const [flowsRes, countriesRes] = await Promise.all([
    apiGet("/flows?all=1", { ttlMs: 60000 }),
    apiGet("/countries", { ttlMs: 300000 })
  ]);
  if (!flowsRes.ok) {
    main.innerHTML = '<div class="workspace">' + ui.workspaceHeader({ title: "AI Token Flows", sub: "Bilateral serving-to-consuming relationships." }) + ui.errorState(flowsRes.error, "flows-retry") + "</div>";
    const retry = document.getElementById("flows-retry");
    if (retry) retry.addEventListener("click", () => router.navigate("/flows"));
    return { destroy() {} };
  }
  const data = flowsRes.data;
  const records = data.records || [];
  const coords = Object.assign({}, COUNTRY_COORDS);
  if (countriesRes.ok) for (const c of countriesRes.data) if (!coords[c.iso3]) coords[c.iso3] = { name: c.name, lon: c.lon, lat: c.lat };

  main.innerHTML =
    '<div class="workspace flows-workspace" data-screen-label="flows">' +
    ui.workspaceHeader({
      title: "AI Token Flows",
      sub: "Conceptual bilateral relationships between serving and consuming countries. origin = serving country, destination = consuming country. Input (prompt) tokens travel consumer → server; output (generated) tokens travel server → consumer.",
      actions: '<span class="badge synthetic"><span class="bdot"></span>Synthetic fixture</span>' +
        '<button class="btn sm" id="flows-mode">Flat map</button>' +
        '<a class="btn sm ghost" data-link href="/sources">Methodology & sources</a>',
      context: '<div class="disclaimer"><span class="dot"></span>' + DISCLAIMER + "</div>" +
        '<span class="badge" id="flows-period-badge"></span>' +
        '<span class="note" id="flows-coverage"></span>'
    }) +
    '<div id="flows-stats"></div>' +
    '<div class="flows-layout">' +
      '<div><div class="flows-stage" id="flows-stage"></div>' +
        '<div class="instrument-strip" id="flows-instruments" aria-hidden="true"></div>' +
        '<div class="timeline" id="flows-timeline">' +
          '<div class="transport">' +
            '<button class="btn icon" id="tl-prev" aria-label="Previous period" title="Previous period (←)">‹</button>' +
            '<button class="btn icon" id="tl-play" aria-pressed="false" aria-label="Play period playback" title="Play / pause (Space)">▶</button>' +
            '<button class="btn icon" id="tl-next" aria-label="Next period" title="Next period (›)">›</button>' +
          "</div>" +
          '<div class="tl-slider"><input id="tl-slider" type="range" min="0" max="5" step="1" value="0" aria-label="Demonstration period timeline"><div class="ticks" id="tl-ticks"></div></div>' +
          '<div class="period-display" id="tl-period">—<small>PERIOD</small></div>' +
          '<select class="input" id="tl-speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>' +
          '<button class="btn sm" id="tl-loop" aria-pressed="true" title="Loop playback">Loop</button>' +
        "</div>" +
        '<div class="toolbar" style="margin-top:12px">' +
          '<button class="chip" id="tg-in" aria-pressed="true"><span class="swatch" style="background:var(--input-green)"></span>Input / prompt</button>' +
          '<button class="chip" id="tg-out" aria-pressed="true"><span class="swatch" style="background:var(--output-amber)"></span>Output / generated</button>' +
          '<button class="chip" id="tg-routes" aria-pressed="true">Route lines</button>' +
          '<button class="chip" id="tg-power" aria-pressed="false">Low power</button>' +
          '<button class="chip" id="tg-rotate" aria-pressed="true">Auto-rotate</button>' +
          '<span class="grow"></span>' +
          '<div class="field" style="min-width:190px"><label for="country-filter">Country filter</label><select class="input" id="country-filter"><option value="">All countries</option></select></div>' +
        "</div>" +
        '<div class="panel" style="margin-top:12px"><div class="panel-head"><h3 class="panel-title">Legend</h3></div><div class="panel-body"><div class="legend">' +
          '<div class="legend-row"><span class="dot in"></span>Input / prompt tokens travelling to the serving location</div>' +
          '<div class="legend-row"><span class="dot out"></span>Output / generated tokens travelling to the consumer</div>' +
          '<div class="legend-row"><span class="swatch" style="width:9px;height:9px;border-radius:50%;background:var(--accent)"></span>Particle size & density: relative volume (square-root scale, ≤150 particles)</div>' +
          '<div class="legend-row"><span class="ring"></span>Highlighted boundary: selected country</div>' +
          '<div class="legend-row"><span class="swatch" style="width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#3a5a40,#0a0a0a)"></span>Basemap: NASA Blue Marble + Black Marble (public domain) · day/night boundary computed from the real solar position</div>' +
        "</div></div></div>" +
      "</div>" +
      '<div class="flows-side" id="flows-side"></div>' +
    "</div>" +
    '<div class="panel-grid" style="margin-top:14px" id="flows-stories"></div>' +
    "</div>";

  const stage = document.getElementById("flows-stage");
  const side = document.getElementById("flows-side");
  let globe = null, flat = null, mode = appState.geoMode === "flat" ? "flat" : "globe";
  let lastRankMode = "consuming";
  let storyId = null;

  // ---- side panels ----
  function renderSide(snap) {
    const recs = globe ? globe.agg.recordsFor(snap.period) : [];
    const agg = globe ? globe.agg : null;
    const code = snap.selectedCountry;
    let html = "";
    if (storyId) {
      html += '<div class="story-card" id="story-card"><button class="story-close" id="story-close" aria-label="Dismiss exploration">✕</button>' +
        '<p class="story-title" id="story-title"></p><p id="story-text"></p></div>';
    }
    if (code && agg) {
      const m = agg.countryMetrics(code, recs);
      const name = (coords[code] && coords[code].name) || code;
      html += ui.panel({
        title: "Country intelligence — " + name,
        tools: '<button class="btn sm" id="btn-spotlight">Focus</button><button class="btn sm ghost" id="btn-clear">Clear</button>',
        link: { href: "/countries/" + code, label: "Profile" },
        body: '<div class="section-title" style="margin-top:0">Serving activity</div>' +
          ui.kv([
            ["Output tokens served to others", fmtCompact(m.serving.outputServed), "amber", fmtExact(m.serving.outputServed) + " tokens"],
            ["Input tokens received as server", fmtCompact(m.serving.inputReceived), "green", fmtExact(m.serving.inputReceived) + " tokens"],
            ["Associated serving volume", fmtCompact(m.serving.total), "", fmtExact(m.serving.total) + " tokens"],
            ["Consuming partners", String(m.serving.partners)]
          ]) +
          '<div class="section-title">Consumption activity</div>' +
          ui.kv([
            ["Output tokens received as consumer", fmtCompact(m.consuming.outputReceived), "amber", fmtExact(m.consuming.outputReceived) + " tokens"],
            ["Input tokens sent to servers", fmtCompact(m.consuming.inputSent), "green", fmtExact(m.consuming.inputSent) + " tokens"],
            ["Associated consumption volume", fmtCompact(m.consuming.total), "", fmtExact(m.consuming.total) + " tokens"],
            ["Serving partners", String(m.consuming.partners)]
          ]) +
          '<div class="section-title">Partner rankings</div>' +
          ui.tabs([{ id: "consumers", label: "Consuming" }, { id: "servers", label: "Serving" }], partnerMode, "data-partner") +
          '<div id="partner-list" style="margin-top:8px"></div>'
      });
    }
    if (snap.selectedRoute && agg) {
      const v = agg.routeVolumes(recs).get(snap.selectedRoute);
      if (v) html += ui.panel({
        title: "Route inspector",
        tools: '<button class="btn sm ghost" id="btn-clear-route">Close</button>',
        body: '<p class="mono" style="font-size:12px;color:var(--accent);margin:0 0 8px">' + ui.h((coords[v.origin] || {}).name || v.origin) + " → " + ui.h((coords[v.destination] || {}).name || v.destination) + "</p>" +
          ui.kv([
            ["Serving country", v.origin], ["Consuming country", v.destination],
            ["Prompt tokens (consumer → server)", fmtCompact(v.input), "green", fmtExact(v.input) + " tokens"],
            ["Generated tokens (server → consumer)", fmtCompact(v.output), "amber", fmtExact(v.output) + " tokens"],
            ["Total associated", fmtCompact(v.total), "", fmtExact(v.total) + " tokens"]
          ]) + ui.note("Synthetic demonstration relationship, not measured traffic.")
      });
    }
    const rows = agg ? agg.rankings(recs, lastRankMode, 8) : [];
    html += ui.panel({
      title: "Rankings",
      tools: ui.tabs([{ id: "consuming", label: "Consuming" }, { id: "serving", label: "Serving" }], lastRankMode, "data-rank"),
      body: '<p class="note" style="margin:0 0 8px">' + (lastRankMode === "consuming" ? "Top AI consuming destinations" : "Top AI serving countries") +
        " · associated synthetic token volume · share of period total</p>" +
        ui.rankList(rows.map(r => Object.assign({}, r, { name: (coords[r.code] || {}).name || r.code })), { hrefFn: r => "/countries/" + r.code, barTone: lastRankMode === "consuming" ? "green" : "amber" })
    });
    if (agg) {
      const t = agg.totals(recs);
      const share = t.total > 0 ? t.input / t.total : 0;
      html += ui.panel({
        title: "Prompt vs completion",
        body: ui.splitBar(share) + ui.kv([
          ["Input / prompt", fmtCompact(t.input) + " · " + fmtPct(share * 100), "green", fmtExact(t.input) + " tokens"],
          ["Output / generated", fmtCompact(t.output) + " · " + fmtPct((1 - share) * 100), "amber", fmtExact(t.output) + " tokens"]
        ]) + ui.note("Period " + periodLabel(snap.period) + ". Synthetic demonstration values.")
      });
    }
    side.innerHTML = html;
    if (code && agg) renderPartners(code, recs);
    wireSide();
  }
  let partnerMode = "consumers";
  function renderPartners(code, recs) {
    const box = document.getElementById("partner-list");
    if (!box || !globe) return;
    const rows = globe.agg.partners(code, recs, partnerMode);
    box.innerHTML = ui.rankList(rows.map(r => Object.assign({}, r, { name: (coords[r.code] || {}).name || r.code })), { hrefFn: r => "/countries/" + r.code });
    const noteEl = document.createElement("p");
    noteEl.className = "note";
    noteEl.style.margin = "7px 0 0";
    noteEl.textContent = partnerMode === "consumers"
      ? "Countries consuming from " + ((coords[code] || {}).name || code) + " · share of that country's serving total"
      : "Countries serving " + ((coords[code] || {}).name || code) + " · share of that country's consumption total";
    box.appendChild(noteEl);
  }
  function wireSide() {
    const clear = document.getElementById("btn-clear");
    if (clear) clear.addEventListener("click", () => { globe && globe.clearSelections(); selectCountry(null); });
    const spot = document.getElementById("btn-spotlight");
    if (spot) spot.addEventListener("click", () => { const c = coords[appState.selectedCountry || (globe && globe.getState().selectedCountry)]; if (c && globe) globe.spotlightTo(c.lon, c.lat); });
    const cr = document.getElementById("btn-clear-route");
    if (cr) cr.addEventListener("click", () => globe && globe.clearSelections());
    const sc = document.getElementById("story-close");
    if (sc) sc.addEventListener("click", () => { storyId = null; renderSide(globe ? globe.getSnapshot() : {}); });
    for (const b of document.querySelectorAll("[data-rank]")) b.addEventListener("click", () => { lastRankMode = b.getAttribute("data-rank"); renderSide(globe.getSnapshot()); });
    for (const b of document.querySelectorAll("[data-partner]")) b.addEventListener("click", () => { partnerMode = b.getAttribute("data-partner"); renderSide(globe.getSnapshot()); });
  }

  function renderStats(snap) {
    document.getElementById("flows-stats").innerHTML = ui.statRow([
      { label: "Total associated", value: fmtCompact(snap.totals.total), exact: snap.totals.total, unit: "tokens", sub: "input + output · " + snap.recordCount + " records" },
      { label: "Input · prompt", value: fmtCompact(snap.totals.input), tone: "green", exact: snap.totals.input, unit: "tokens", sub: "consumer → server" },
      { label: "Output · generated", value: fmtCompact(snap.totals.output), tone: "amber", exact: snap.totals.output, unit: "tokens", sub: "server → consumer" },
      { label: "Active routes", value: String(snap.routeCount), sub: "bilateral pairs" },
      { label: "Countries", value: String(snap.countryCount), sub: "serving + consuming" },
      { label: "Particles", value: snap.particles + " / " + snap.particleBudget, sub: "square-root volume encoding" }
    ]);
    document.getElementById("flows-period-badge").textContent = snap.period ? periodShort(snap.period) : "—";
    document.getElementById("flows-coverage").textContent = snap.periods.length + " monthly periods · " + records.length + " synthetic records · evidence class: synthetic";
  }

  function renderTimeline(snap) {
    const slider = document.getElementById("tl-slider");
    slider.max = String(Math.max(0, snap.periods.length - 1));
    slider.value = String(snap.periodIdx);
    document.getElementById("tl-period").innerHTML = ui.h(snap.period ? periodLabel(snap.period).toUpperCase() : "—") + "<small>PERIOD</small>";
    const ticks = document.getElementById("tl-ticks");
    if (ticks.childElementCount !== snap.periods.length) {
      ticks.innerHTML = snap.periods.map((p, i) => '<span role="button" tabindex="0" data-tick="' + i + '" aria-label="Go to ' + ui.h(periodLabel(p)) + '">' + ui.h(periodShort(p)) + "</span>").join("");
      for (const n of ticks.querySelectorAll("[data-tick]")) {
        n.addEventListener("click", () => globe.setPeriod(Number(n.getAttribute("data-tick"))));
        n.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); globe.setPeriod(Number(n.getAttribute("data-tick"))); } });
      }
    }
    [...ticks.children].forEach((n, i) => n.classList.toggle("current", i === snap.periodIdx));
    const play = document.getElementById("tl-play");
    play.textContent = snap.playing ? "❚❚" : "▶";
    play.setAttribute("aria-pressed", String(snap.playing));
    play.setAttribute("aria-label", snap.playing ? "Pause period playback" : "Play period playback");
    document.getElementById("tl-loop").setAttribute("aria-pressed", String(globe.getState().loop));
    document.getElementById("tl-speed").value = String(snap.speed);
    document.getElementById("tg-in").setAttribute("aria-pressed", String(snap.showInput));
    document.getElementById("tg-out").setAttribute("aria-pressed", String(snap.showOutput));
    document.getElementById("tg-routes").setAttribute("aria-pressed", String(snap.showRoutes));
    document.getElementById("tg-power").setAttribute("aria-pressed", String(snap.lowPower));
    document.getElementById("tg-rotate").setAttribute("aria-pressed", String(snap.autoRotate));
  }

  function onChange(snap) {
    renderStats(snap);
    renderTimeline(snap);
    renderSide(snap);
    if (snap.selectedCountry !== appState.selectedCountry) selectCountry(snap.selectedCountry, "globe");
  }

  // ---- mount geographic engine ----
  function mountGlobe() {
    stage.innerHTML = "";
    globe = createGlobe(stage, {
      flows: records, countries: coords,
      lowPower: appState.lowPower,
      autoRotate: !appState.reducedMotion,
      onAnnounce: announce
    });
    globe.on("change", onChange);
    globe.on("dismiss-story", () => { storyId = null; });
    globe.on("select-marker", m => { if (m && m.href) router.navigate(m.href); });
    globe.on("error", e => announce("Geographic engine error: " + e.message));
    globe.mount().then(() => {
      const snap = globe.getSnapshot();
      if (appState.selectedCountry) globe.selectCountry(appState.selectedCountry, false);
      onChange(globe.getSnapshot());
      if (!snap.assets.atlas) announce("Country boundaries unavailable; fallback globe in use.");
    });
  }
  function mountFlat() {
    stage.innerHTML = "";
    flat = createFlatMap(stage, { countries: coords, onSelect: iso => { selectCountry(iso); } });
    // Reuse the same atlas the globe loads; poll briefly until D3 is ready.
    const tryFeatures = async () => {
      if (!window.d3 || !window.topojson) { setTimeout(tryFeatures, 400); return; }
      try {
        const res = await fetch("/data/reference/countries-110m.json");
        const topo = await res.json();
        const feats = window.topojson.feature(topo, topo.objects.countries).features;
        const numToIso = {};
        for (const c of (countriesRes.ok ? countriesRes.data : [])) if (c.numeric) numToIso[String(parseInt(c.numeric, 10))] = c.iso3;
        for (const f of feats) { const iso = numToIso[String(parseInt(f.id, 10))]; f.properties = f.properties || {}; if (iso) f.properties.iso = iso; }
        flat.setFeatures(feats);
      } catch (err) { console.warn("[flows] flat map geometry unavailable", err); }
    };
    tryFeatures();
    const snap = { period: data.periods[data.periods.length - 1], periodIdx: data.periods.length - 1, periods: data.periods, totals: data.totals, routeCount: data.routes.length, countryCount: data.totals.countries, recordCount: data.records.length, selectedCountry: appState.selectedCountry, selectedRoute: null, particles: 0, particleBudget: 150, playing: false, speed: 1, showInput: true, showOutput: true, showRoutes: true, lowPower: appState.lowPower, autoRotate: false };
    renderStats(snap); renderTimeline(snap);
    side.innerHTML = ui.panel({ title: "Flat map mode", body: ui.note("The flat map shares country selection with the globe. Particle animation and route inspection are available in globe mode.") + ui.rankList((data.top_consuming || []).map(r => Object.assign({}, r, { name: (coords[r.code] || {}).name || r.code })), { hrefFn: r => "/countries/" + r.code }) });
  }
  if (mode === "flat") mountFlat(); else mountGlobe();

  // ---- instrument readouts (live rotation, UTC, real subsolar point, fps) ----
  let instrTimer = null;
  function startInstruments() {
    const el = document.getElementById("flows-instruments");
    if (!el) return;
    let lastFrames = 0, lastTs = performance.now();
    const fmtDeg = (v, pos, neg) => Math.abs(v).toFixed(1).padStart(5, "0") + "\u00B0" + (v >= 0 ? pos : neg);
    const tick = () => {
      if (!globe) { el.textContent = "FLAT MAP MODE \u00B7 PARTICLE ENGINE OFFLINE"; return; }
      const st = globe.getState();
      const e = globe.getEarth();
      const now = performance.now();
      const fps = Math.max(0, Math.round((st.frames - lastFrames) / Math.max(0.001, (now - lastTs) / 1000)));
      lastFrames = st.frames; lastTs = now;
      const lon = ((-st.rotation[0] % 360) + 540) % 360 - 180;
      const lat = Math.max(-90, Math.min(90, -st.rotation[1]));
      const utc = new Date().toISOString().slice(11, 19);
      const ss = e.subsolar;
      el.textContent =
        "VIEW " + fmtDeg(lon, "E", "W") + " " + fmtDeg(lat, "N", "S") +
        "  \u00B7  UTC " + utc +
        "  \u00B7  SUBSOLAR " + fmtDeg(ss[0], "E", "W") + " " + fmtDeg(ss[1], "N", "S") +
        "  \u00B7  " + (e.active ? "PHOTO\u00B7SOLAR " + e.textureSize + "PX" : "VECTOR") +
        "  \u00B7  " + globe.particleCount() + " PTCL  \u00B7  " + fps + " FPS";
    };
    tick();
    instrTimer = setInterval(tick, 500);
  }
  startInstruments();

  // ---- controls ----
  const $ = id => document.getElementById(id);
  $("tl-prev").addEventListener("click", () => globe && globe.stepPeriod(-1));
  $("tl-next").addEventListener("click", () => globe && globe.stepPeriod(1));
  $("tl-play").addEventListener("click", () => globe && globe.togglePlay());
  $("tl-slider").addEventListener("input", e => globe && globe.setPeriod(Number(e.target.value)));
  $("tl-speed").addEventListener("change", e => globe && globe.setSpeed(e.target.value));
  $("tl-loop").addEventListener("click", () => { if (!globe) return; globe.setLoop(!globe.getState().loop); renderTimeline(globe.getSnapshot()); });
  $("tg-in").addEventListener("click", () => globe && globe.setShowInput(!globe.getState().showInput));
  $("tg-out").addEventListener("click", () => globe && globe.setShowOutput(!globe.getState().showOutput));
  $("tg-routes").addEventListener("click", () => globe && globe.setShowRoutes(!globe.getState().showRoutes));
  $("tg-power").addEventListener("click", () => { if (!globe) return; globe.setLowPower(!globe.getState().lowPower); patch({ lowPower: globe.getState().lowPower }, "low-power"); });
  $("tg-rotate").addEventListener("click", () => globe && globe.setAutoRotate(!globe.getState().autoRotate));
  $("flows-mode").addEventListener("click", () => {
    mode = mode === "globe" ? "flat" : "globe";
    $("flows-mode").textContent = mode === "globe" ? "Flat map" : "Globe";
    patch({ geoMode: mode }, "geo-mode");
    if (globe) { globe.destroy(); globe = null; }
    if (flat) { flat.destroy(); flat = null; }
    if (mode === "flat") mountFlat(); else mountGlobe();
  });
  const filter = $("country-filter");
  filter.innerHTML = '<option value="">All countries</option>' + Object.keys(coords).sort((a, b) => coords[a].name.localeCompare(coords[b].name))
    .map(c => '<option value="' + c + '">' + ui.h(coords[c].name) + " (" + c + ")</option>").join("");
  filter.addEventListener("change", e => { if (e.target.value) { globe && globe.selectCountry(e.target.value); selectCountry(e.target.value); } else { globe && globe.clearSelections(); selectCountry(null); } });

  const onKey = e => {
    if (e.target && e.target.closest && e.target.closest("input, select, textarea, button, a")) return;
    if (!globe) return;
    if (e.code === "Space") { e.preventDefault(); globe.togglePlay(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); globe.stepPeriod(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); globe.stepPeriod(1); }
    else if (e.key === "Escape") { globe.clearSelections(); selectCountry(null); }
  };
  document.addEventListener("keydown", onKey);

  // ---- guided explorations (all figures derived from the live dataset) ----
  const stories = [
    { id: "india", title: "01 — Follow an AI request from India", text: "India appears as both serving country and consuming destination in this synthetic network. Select India to compare its serving and consumption metrics and partner rankings." },
    { id: "hubs", title: "02 — Explore the major serving hubs", text: "Switch the ranking to Serving to see where synthetic inference is modelled as being served. These are fictional relationships, not verified data-centre locations." },
    { id: "consumers", title: "03 — Compare leading consumption destinations", text: "Ranked by total associated synthetic token volume grouped by consuming country — a modelling convention, not a measurement of national AI demand." },
    { id: "balance", title: "04 — Prompt vs completion token balance", text: "Green particles are prompt tokens travelling consumer → server; amber particles are generated tokens travelling server → consumer. Size and density encode relative volume under a square-root scale." }
  ];
  $("flows-stories").innerHTML = ui.panel({
    title: "Guided explorations · synthetic data", span: 3,
    body: '<div class="tag-row">' + stories.map(s => '<button class="chip" data-story="' + s.id + '">' + ui.h(s.title) + "</button>").join("") + "</div>" +
      ui.note("Every story uses the live embedded dataset. No hardcoded figures.")
  });
  for (const b of document.querySelectorAll("[data-story]")) b.addEventListener("click", () => {
    const id = b.getAttribute("data-story");
    const s = stories.find(x => x.id === id);
    storyId = id;
    if (!globe) return;
    globe.setPeriod(globe.periods().length - 1, false);
    if (id === "india") globe.selectCountry("IND");
    else if (id === "hubs") { globe.clearSelections(); lastRankMode = "serving"; }
    else if (id === "consumers") { globe.clearSelections(); lastRankMode = "consuming"; }
    renderSide(globe.getSnapshot());
    const t = document.getElementById("story-title"), x = document.getElementById("story-text");
    if (t) t.textContent = s.title;
    if (x) {
      let extra = "";
      if (id === "india") {
        const m = globe.agg.countryMetrics("IND", globe.agg.recordsFor(globe.getSnapshot().period));
        extra = " " + fmtCompact(m.serving.total) + " associated synthetic tokens involve India as server in " + periodLabel(globe.getSnapshot().period) + ".";
      }
      x.textContent = s.text + extra;
    }
    announce("Guided exploration: " + s.title);
  });

  return {
    destroy() {
      if (instrTimer) clearInterval(instrTimer);
      document.removeEventListener("keydown", onKey);
      if (globe) globe.destroy();
      if (flat) flat.destroy();
    }
  };
}
