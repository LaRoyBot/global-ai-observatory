// Workspace 4 — AI Economics. Pricing catalogue, provider comparison,
// an interactive cost calculator and sourced pricing history. No price is
// ever estimated, interpolated or fabricated; missing prices are gaps.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate, setParams } from "../app/router.js";
import { announce } from "../app/state.js";
import { fmtDateTime, fmtExact } from "../shared/formatting.js";

const money = n => n == null ? "—" : "$" + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4));
const CATS = ["input", "output", "cached_input", "cache_read", "cache_write"];
const CAT_LABEL = { input: "Input", output: "Output", cached_input: "Cached input", cache_read: "Cache read", cache_write: "Cache write" };

export async function mount(ctx) {
  const main = document.getElementById("main");
  const p = ctx.params || {};
  let q = p.q || "", provider = p.provider || "", sortKey = p.sort || "input", sortDir = p.dir === "desc" ? -1 : 1;
  let cmpA = p.a || "", cmpB = p.b || "", cmpCat = p.cat || "input";

  main.innerHTML = '<div class="workspace" data-screen-label="economics">' +
    ui.workspaceHeader({
      title: "AI Economics",
      sub: "Published API pricing, normalized to USD per million tokens with the original price and unit retained. Comparisons use compatible categories only; the cost calculator produces estimates, not measurements.",
      actions: '<a class="btn sm ghost" data-link href="/sources">Pricing methodology</a>',
      context: '<span class="badge reported"><span class="bdot"></span>Sourced public pricing</span><span class="mono-note" id="ec-unit"></span>'
    }) +
    '<div id="ec-coverage"></div>' +
    '<div class="section-head"><h2>Cost calculator</h2><span class="mono-note">estimates from published prices · up to 3 scenarios</span></div>' +
    '<div class="calc-grid" id="ec-calc"></div>' +
    '<div class="section-head"><h2>Provider comparison</h2><span class="mono-note">compatible categories only</span></div>' +
    '<div id="ec-compare"></div>' +
    '<div class="section-head"><h2>Pricing history</h2><span class="mono-note">dated observations only · no manufactured trends</span></div>' +
    '<div id="ec-history"></div>' +
    '<div class="section-head"><h2>Model pricing catalogue</h2><span class="mono-note" id="ec-count"></span></div>' +
    '<div class="filters" id="ec-filters"></div>' +
    '<div id="ec-catalogue"></div></div>';

  const res = await apiGet("/economics", { ttlMs: 0 });
  if (!res.ok) {
    document.getElementById("ec-catalogue").innerHTML = ui.errorState(res.error, "ec-retry");
    const h = e => { if (e.target.id === "ec-retry") navigate("/economics"); };
    document.addEventListener("click", h);
    return { destroy() { document.removeEventListener("click", h); } };
  }
  const data = res.data;
  document.getElementById("ec-unit").textContent = data.unit;
  const catalogue = data.catalogue || [];
  const observations = data.observations || [];
  const providers = [...new Set(catalogue.map(c => c.provider_slug).filter(Boolean))].sort();

  /* coverage */
  const latest = observations.reduce((a, o) => (o.retrieved_at && o.retrieved_at > a ? o.retrieved_at : a), "");
  document.getElementById("ec-coverage").innerHTML = ui.statRow([
    { label: "Models with pricing", value: String(data.coverage.models), sub: "catalogued observations" },
    { label: "Pricing observations", value: fmtExact(data.coverage.observations), tone: "green", exact: data.coverage.observations },
    { label: "Providers", value: String(data.coverage.providers), tone: "amber" },
    { label: "Latest retrieval", value: latest ? latest.slice(0, 10) : "—", sub: latest ? fmtDateTime(latest) : "no observations" },
  ]) + ui.note(data.normalization);

  /* ---- cost calculator ---- */
  const priced = catalogue.filter(c => c.categories && (c.categories.input || c.categories.output));
  let scenarios = [
    { model: p.m || (priced[0] && priced[0].model_slug) || "", input: 1000000, output: 250000 },
    { model: "", input: 1000000, output: 250000 },
    { model: "", input: 1000000, output: 250000 },
  ];
  function modelOptions(sel) {
    return '<option value="">Select a model…</option>' + priced.map(c =>
      '<option value="' + ui.h(c.model_slug) + '"' + (c.model_slug === sel ? " selected" : "") + ">" + ui.h(c.model_slug) + "</option>").join("");
  }
  function scenarioCost(sc) {
    const entry = catalogue.find(c => c.model_slug === sc.model);
    if (!entry) return { ok: false, reason: "no model selected" };
    const inObs = entry.categories.input, outObs = entry.categories.output;
    if (!inObs && !outObs) return { ok: false, reason: "no pricing observation for this model" };
    const inCost = inObs ? (sc.input / 1e6) * inObs.price : null;
    const outCost = outObs ? (sc.output / 1e6) * outObs.price : null;
    if (inCost == null && outCost == null) return { ok: false, reason: "no pricing observation" };
    return { ok: true, total: (inCost || 0) + (outCost || 0), inCost, outCost, inObs, outObs, partial: inCost == null || outCost == null };
  }
  function renderCalc() {
    const box = document.getElementById("ec-calc");
    box.innerHTML = scenarios.map((sc, i) => {
      const r = scenarioCost(sc);
      const obs = r.ok ? (r.inObs || r.outObs) : null;
      return '<div class="scenario-col" data-sc="' + i + '">' +
        '<div class="subhead" style="margin-top:0">Scenario ' + (i + 1) + (i > 0 ? ' <button class="btn sm ghost" data-sc-clear="' + i + '" type="button">Clear</button>' : "") + "</div>" +
        '<div class="calc-field"><label for="sc-model-' + i + '">Model</label><select class="input" id="sc-model-' + i + '" data-sc-model="' + i + '">' + modelOptions(sc.model) + "</select></div>" +
        '<div class="calc-field"><label for="sc-in-' + i + '">Input / prompt tokens</label><input class="input" id="sc-in-' + i + '" type="number" min="0" step="1000" value="' + sc.input + '" data-sc-in="' + i + '"></div>' +
        '<div class="calc-field"><label for="sc-out-' + i + '">Output / generated tokens</label><input class="input" id="sc-out-' + i + '" type="number" min="0" step="1000" value="' + sc.output + '" data-sc-out="' + i + '"></div>' +
        (r.ok
          ? '<div class="calc-result">' + money(r.total) + "</div>" +
            ui.kv([
              ["Input cost", r.inCost == null ? "no pricing observation" : money(r.inCost), "green"],
              ["Output cost", r.outCost == null ? "no pricing observation" : money(r.outCost), "amber"],
            ]) +
            (r.partial ? ui.note("Partial estimate: one category has no published price. Missing prices are never treated as zero.") : "") +
            (obs ? '<div class="feed-meta">Price source: ' + ui.h(obs.source_id || "") + " · retrieved " + ui.h(String(obs.retrieved_at || "").slice(0, 10)) + " · " + ui.evidenceBadge(obs.evidence_class) + " " + ui.sourceLink(obs, "source") + "</div>"
                 + ui.kv([["Input price (original)", obs.price_original != null ? obs.price_original + " " + (obs.unit_original || "") : "—"], ["Normalized unit", data.unit]]) : "")
          : '<div class="calc-result">—</div>' + ui.emptyState("No estimate", r.reason + ". This is a coverage gap, not a zero cost.")) +
        "</div>";
    }).join("");
    for (const sel of box.querySelectorAll("[data-sc-model]")) sel.addEventListener("change", e => { scenarios[Number(sel.dataset.scModel)].model = e.target.value; syncUrl(); renderCalc(); renderHistory(); });
    for (const inp of box.querySelectorAll("[data-sc-in]")) inp.addEventListener("input", e => { scenarios[Number(inp.dataset.scIn)].input = Math.max(0, Number(e.target.value) || 0); renderCalcResultsOnly(); });
    for (const inp of box.querySelectorAll("[data-sc-out]")) inp.addEventListener("input", e => { scenarios[Number(inp.dataset.scOut)].output = Math.max(0, Number(e.target.value) || 0); renderCalcResultsOnly(); });
    for (const b of box.querySelectorAll("[data-sc-clear]")) b.addEventListener("click", () => { scenarios[Number(b.dataset.scClear)] = { model: "", input: 1000000, output: 250000 }; renderCalc(); renderHistory(); });
  }
  // Re-render only the result blocks while typing, so inputs keep focus.
  function renderCalcResultsOnly() {
    const box = document.getElementById("ec-calc");
    scenarios.forEach((sc, i) => {
      const col = box.querySelector('[data-sc="' + i + '"]'); if (!col) return;
      const r = scenarioCost(sc);
      const resEl = col.querySelector(".calc-result");
      if (resEl) resEl.textContent = r.ok ? money(r.total) : "—";
    });
  }

  /* ---- provider comparison ---- */
  function renderCompare() {
    const box = document.getElementById("ec-compare");
    const opts = sel => '<option value="">Select provider…</option>' + providers.map(x => '<option value="' + ui.h(x) + '"' + (x === sel ? " selected" : "") + ">" + ui.h(x) + "</option>").join("");
    const catOpts = CATS.map(c => '<option value="' + c + '"' + (c === cmpCat ? " selected" : "") + ">" + CAT_LABEL[c] + "</option>").join("");
    function stats(prov) {
      if (!prov) return null;
      const rows = catalogue.filter(c => c.provider_slug === prov && c.categories[cmpCat]).map(c => c.categories[cmpCat].price);
      if (!rows.length) return { n: 0 };
      const sorted = rows.slice().sort((a, b) => a - b);
      return { n: rows.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
    }
    const A = stats(cmpA), B = stats(cmpB);
    const colHtml = (prov, s) => '<div class="compare-col"><h3>' + ui.h(prov || "—") + "</h3>" +
      (s && s.n ? ui.kv([["Models with " + CAT_LABEL[cmpCat].toLowerCase() + " pricing", String(s.n)], ["Lowest", money(s.min)], ["Median", money(s.median)], ["Highest", money(s.max)]]) + ui.note("USD per million tokens · " + CAT_LABEL[cmpCat] + " category only.")
        : ui.emptyState("No compatible observations", prov ? "This provider has no published " + CAT_LABEL[cmpCat].toLowerCase() + " prices in the dataset. Incompatible units are never compared." : "Select a provider.")) + "</div>";
    box.innerHTML = '<div class="filters">' +
      '<div class="field"><label for="ec-a">Provider A</label><select class="input" id="ec-a">' + opts(cmpA) + "</select></div>" +
      '<div class="field"><label for="ec-b">Provider B</label><select class="input" id="ec-b">' + opts(cmpB) + "</select></div>" +
      '<div class="field"><label for="ec-cat">Category</label><select class="input" id="ec-cat">' + catOpts + "</select></div></div>" +
      '<div class="compare-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">' + colHtml(cmpA, A) + colHtml(cmpB, B) + "</div>" +
      ui.note("Only prices normalized to the same unit and category are compared. Cross-category or cross-unit comparisons are refused rather than silently converted.");
    document.getElementById("ec-a").addEventListener("change", e => { cmpA = e.target.value; syncUrl(); renderCompare(); });
    document.getElementById("ec-b").addEventListener("change", e => { cmpB = e.target.value; syncUrl(); renderCompare(); });
    document.getElementById("ec-cat").addEventListener("change", e => { cmpCat = e.target.value; syncUrl(); renderCompare(); });
  }

  /* ---- pricing history (dated observations only) ---- */
  function renderHistory() {
    const box = document.getElementById("ec-history");
    const slug = scenarios[0].model;
    if (!slug) { box.innerHTML = ui.emptyState("No model selected", "Choose a model in Scenario 1 to inspect its dated pricing observations."); return; }
    const rows = observations.filter(o => o.model_slug === slug);
    const byCat = {};
    for (const o of rows) {
      const date = (o.effective_date || o.retrieved_at || "").slice(0, 10);
      if (!date) continue;
      byCat[o.category] = byCat[o.category] || {};
      const prev = byCat[o.category][date];
      if (!prev || (o.retrieved_at || "") > (prev.retrieved_at || "")) byCat[o.category][date] = o;
    }
    const cats = Object.keys(byCat);
    if (!cats.length) { box.innerHTML = ui.emptyState("No dated observations", "No pricing observations are recorded for this model yet. History is never manufactured."); return; }
    box.innerHTML = '<div class="grid-2">' + cats.map(cat => {
      const points = Object.keys(byCat[cat]).sort().map(d => ({ label: d, value: byCat[cat][d].price }));
      return ui.panel({
        title: slug + " · " + (CAT_LABEL[cat] || cat),
        tools: ui.evidenceBadge(byCat[cat][Object.keys(byCat[cat]).sort().pop()].evidence_class),
        body: points.length >= 2
          ? ui.lineChart(points, { tone: cat === "output" ? "var(--output-amber)" : "var(--input-green)", height: 110 }) +
            ui.table({ columns: [{ key: "label", label: "Date" }, { key: "value", label: "USD / M", numeric: true, render: r => money(r.value) }], rows: points })
          : ui.emptyState("Not enough history", "A trend requires at least two dated observations. Only one is recorded (" + points[0].label + "); no fluctuation is invented."),
      });
    }).join("") + "</div>";
  }

  /* ---- catalogue ---- */
  function renderFilters() {
    document.getElementById("ec-filters").innerHTML =
      '<div class="field"><label for="ec-q">Search models</label><input class="input" id="ec-q" type="search" placeholder="model or provider…" value="' + ui.h(q) + '"></div>' +
      '<div class="field"><label for="ec-provider">Provider</label><select class="input" id="ec-provider"><option value="">All providers</option>' + providers.map(x => '<option value="' + ui.h(x) + '"' + (x === provider ? " selected" : "") + ">" + ui.h(x) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ec-sort">Sort by</label><select class="input" id="ec-sort">' +
        [["input", "Input price"], ["output", "Output price"], ["model", "Model name"]].map(([k, l]) => '<option value="' + k + '"' + (k === sortKey ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
      '<button class="btn sm" id="ec-dir" type="button" aria-pressed="' + (sortDir === -1) + '">' + (sortDir === -1 ? "Descending" : "Ascending") + "</button>";
    const qi = document.getElementById("ec-q"); let t = null;
    qi.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = qi.value.trim(); syncUrl(); renderCatalogue(); }, 200); });
    document.getElementById("ec-provider").addEventListener("change", e => { provider = e.target.value; syncUrl(); renderCatalogue(); });
    document.getElementById("ec-sort").addEventListener("change", e => { sortKey = e.target.value; syncUrl(); renderCatalogue(); });
    document.getElementById("ec-dir").addEventListener("click", () => { sortDir = -sortDir; syncUrl(); renderFilters(); renderCatalogue(); });
  }
  function renderCatalogue() {
    let rows = catalogue.filter(c => (!provider || c.provider_slug === provider) && (!q || c.model_slug.toLowerCase().includes(q.toLowerCase())));
    const val = (c, k) => k === "model" ? c.model_slug : (c.categories[k] ? c.categories[k].price : Infinity);
    rows = rows.slice().sort((a, b) => { const x = val(a, sortKey), y = val(b, sortKey); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    document.getElementById("ec-count").textContent = rows.length + " of " + catalogue.length + " models";
    const shown = rows.slice(0, 100);
    document.getElementById("ec-catalogue").innerHTML = rows.length ? ui.panel({
      title: "Published prices · USD per million tokens",
      tools: ui.evidenceBadge("reported"),
      body: ui.table({ columns: [
        { key: "model_slug", label: "Model", render: r => '<a data-link href="/models/' + encodeURIComponent(r.model_slug) + '">' + ui.h(r.model_slug) + "</a>" },
        { key: "provider_slug", label: "Provider", render: r => '<a data-link href="/providers/' + encodeURIComponent(r.provider_slug) + '">' + ui.h(r.provider_slug) + "</a>" },
        { key: "input", label: "Input", numeric: true, render: r => r.categories.input ? money(r.categories.input.price) : '<span class="gap-tag">gap</span>' },
        { key: "output", label: "Output", numeric: true, render: r => r.categories.output ? money(r.categories.output.price) : '<span class="gap-tag">gap</span>' },
        { key: "retrieved", label: "Retrieved", render: r => { const o = r.categories.input || r.categories.output; return o ? String(o.retrieved_at || "").slice(0, 10) : "—"; } },
        { key: "src", label: "Source", render: r => { const o = r.categories.input || r.categories.output; return o ? ui.sourceLink(o, o.source_id || "source") : "—"; } },
      ], rows: shown }) + (rows.length > 100 ? ui.note("Showing first 100 of " + rows.length + " matching models. Narrow the search or provider filter to see the rest.") : ""),
    }) : ui.emptyState("No models match", "No pricing observations match these filters. This is a coverage gap, not a zero price.");
  }

  function syncUrl() { setParams({ q, provider, sort: sortKey, dir: sortDir === -1 ? "desc" : "asc", a: cmpA, b: cmpB, cat: cmpCat, m: scenarios[0].model }); }

  renderCalc(); renderCompare(); renderHistory(); renderFilters(); renderCatalogue();
  return { destroy() {} };
}
