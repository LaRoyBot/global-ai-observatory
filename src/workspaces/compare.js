// Comparison Studio — countries, providers or models side by side.
// Only compatible metrics/periods are compared; gaps and incomparability are
// stated explicitly. The comparison is shareable via the URL.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate, setParams } from "../app/router.js";
import { announce } from "../app/state.js";
import { fmtCompact } from "../shared/formatting.js";

const money = n => n == null ? "—" : "$" + (n >= 1 ? n.toFixed(2) : n.toFixed(4));
const DISCLAIMER = "Synthetic demo data, not measured international token traffic";

export async function mount(ctx) {
  const main = document.getElementById("main");
  const p = ctx.params || {};
  let kind = ["countries", "providers", "models"].includes(p.kind) ? p.kind : "countries";
  let ids = (p.ids || "").split(",").filter(Boolean).slice(0, 4);

  main.innerHTML = '<div class="workspace" data-screen-label="compare">' +
    ui.workspaceHeader({ title: "Comparison Studio", sub: "Compare 2–4 countries, providers or models on compatible metrics only. Missing or incomparable values are reported as gaps — never imputed, never blended into a composite score.", actions: '<span class="mono-note">shareable via URL</span>' }) +
    '<div class="filters"><div class="field"><label for="cm-kind">Entity type</label><select class="input" id="cm-kind">' +
      [["countries", "Countries"], ["providers", "Providers"], ["models", "Models"]].map(([k, l]) => '<option value="' + k + '"' + (k === kind ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
      '<div class="field" style="min-width:260px"><label for="cm-add">Add entity</label><select class="input" id="cm-add"><option value="">Select…</option></select></div>' +
      '<button class="btn sm ghost" id="cm-clear" type="button">Clear all</button></div>' +
    '<div class="tag-row" id="cm-chips" style="margin-bottom:14px"></div>' +
    '<div id="cm-body">' + ui.loadingBlock("Loading…") + "</div></div>";

  const [countriesR, providersR, modelsR] = await Promise.all([
    apiGet("/countries", { ttlMs: 300000 }), apiGet("/providers", { ttlMs: 300000 }), apiGet("/models?limit=500", { ttlMs: 60000 }),
  ]);
  const countries = countriesR.ok ? countriesR.data : [];
  const providers = providersR.ok ? providersR.data : [];
  const models = modelsR.ok ? modelsR.data : [];
  const nameOfCountry = iso => (countries.find(c => c.iso3 === iso) || {}).name || iso;

  function entityLabel(id) {
    if (kind === "countries") return nameOfCountry(id);
    if (kind === "providers") return (providers.find(x => x.slug === id) || {}).name || id;
    return (models.find(x => x.slug === id) || {}).name || id;
  }
  function renderPicker() {
    const sel = document.getElementById("cm-add");
    let opts = [];
    if (kind === "countries") opts = countries.map(c => [c.iso3, c.name]);
    else if (kind === "providers") opts = providers.map(x => [x.slug, x.name]);
    else opts = models.map(x => [x.slug, x.slug]);
    opts.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    sel.innerHTML = '<option value="">Select…</option>' + opts.filter(([id]) => !ids.includes(id)).slice(0, 400)
      .map(([id, label]) => '<option value="' + ui.h(id) + '">' + ui.h(label) + "</option>").join("");
  }
  function renderChips() {
    document.getElementById("cm-chips").innerHTML = ids.length
      ? ids.map(id => '<span class="chip">' + ui.h(entityLabel(id)) + ' <button type="button" data-rm="' + ui.h(id) + '" aria-label="Remove ' + ui.h(entityLabel(id)) + '" style="background:none;border:0;color:inherit;cursor:pointer">✕</button></span>').join("")
      : '<span class="mono-note">Add at least two entities to compare.</span>';
    for (const b of document.querySelectorAll("[data-rm]")) b.addEventListener("click", () => { ids = ids.filter(x => x !== b.dataset.rm); syncUrl(); renderChips(); renderPicker(); load(); });
  }
  function syncUrl() { setParams({ kind, ids: ids.join(",") }); }

  function countryCol(item) {
    const c = item.country, f = item.flows, sites = (item.infrastructure.sites || []).length, regions = (item.infrastructure.regions || []).length;
    const adoption = item.adoption || [];
    return ui.kv([
      ["Region", c.region || "—"],
      ["Infrastructure sites", String(sites)],
      ["Cloud regions (availability)", String(regions)],
      ["Providers (HQ)", String((item.providers || []).length)],
    ]) +
    (f && f.metrics ? '<div class="subhead">Token flows · synthetic</div>' + ui.kv([
      ["Serving volume", fmtCompact(f.metrics.serving.total)],
      ["Consumption volume", fmtCompact(f.metrics.consuming.total)],
      ["Demo period", f.latest_period || "—"],
    ]) + '<div class="disclaimer" style="font-size:10.5px;margin-top:6px"><span class="dot"></span>' + DISCLAIMER + "</div>" : "") +
    (adoption.length ? '<div class="subhead">Adoption observations</div>' + ui.table({ columns: [
      { key: "metric_id", label: "Metric", render: r => ui.h(r.metric_id.replace(/^eurostat-/, "").replace(/-ge10$/, "")) },
      { key: "value", label: "%", numeric: true, render: r => r.value + "%" },
      { key: "reference_period", label: "Period" },
    ], rows: adoption.slice(0, 6) }) + ui.note("Only identical metrics and periods are comparable across columns.") : ui.emptyState("No adoption data", "Coverage gap for this country."));
  }
  function providerCol(item) {
    const p = item.provider;
    return ui.kv([
      ["HQ country", p.country_iso3 || "not documented"],
      ["Kind", p.kind || "—"],
      ["Models catalogued", String((item.models || []).length)],
      ["Pricing observations", String((item.pricing || []).length)],
      ["Cloud regions", String((item.regions || []).length)],
      ["Facilities", String((item.sites || []).length)],
    ]) + ui.note("Headquarters country is not inference-serving geography.");
  }
  function modelCol(item) {
    const m = item.model, pricing = item.pricing || [];
    const cat = c => pricing.find(o => o.category === c);
    const inO = cat("input"), outO = cat("output");
    const incompatible = pricing.some(o => o.unit !== "per_million_tokens");
    return ui.kv([
      ["Provider", item.provider ? item.provider.name : "—"],
      ["Released", m.release_date ? String(m.release_date).slice(0, 10) : "not documented"],
      ["Context window", m.context_window ? m.context_window.toLocaleString() : "not documented"],
      ["Input price (USD/M)", inO ? money(inO.price) : "no pricing observation", "cyan"],
      ["Output price (USD/M)", outO ? money(outO.price) : "no pricing observation", "amber"],
    ]) +
    (incompatible ? ui.note("Some observations use incompatible units and are excluded from comparison rather than converted.") : "") +
    (!inO && !outO ? ui.emptyState("No pricing", "Missing prices are gaps, never zero.") : "") +
    ui.note("Pricing compared only in USD per million tokens. Benchmark scores from different evaluations are never blended.");
  }

  async function load() {
    const body = document.getElementById("cm-body");
    if (ids.length < 2) { body.innerHTML = ui.emptyState("Add at least two entities", "Select entities above. The comparison is saved in the URL so you can share it."); return; }
    body.innerHTML = ui.loadingBlock("Comparing…");
    const res = await apiGet("/comparisons?kind=" + kind + "&ids=" + ids.map(encodeURIComponent).join(","), { ttlMs: 0 });
    if (!res.ok) { body.innerHTML = ui.errorState(res.error, "cm-retry"); return; }
    const items = res.data.items || [];
    if (items.length < ids.length) body.innerHTML = ui.note("Some selected entities were not found and are omitted: " + ids.filter(id => !items.some(it => (it.country && it.country.iso3 === id) || (it.provider && it.provider.slug === id) || (it.model && it.model.slug === id))).join(", "));
    const colFn = kind === "countries" ? countryCol : kind === "providers" ? providerCol : modelCol;
    const titleOf = it => kind === "countries" ? it.country.name : kind === "providers" ? it.provider.name : it.model.name;
    const hrefOf = it => kind === "countries" ? "/countries/" + it.country.iso3 : kind === "providers" ? "/providers/" + encodeURIComponent(it.provider.slug) : "/models/" + encodeURIComponent(it.model.slug);
    body.innerHTML = (res.data.compatibility ? ui.note(res.data.compatibility) : "") +
      '<div class="compare-grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">' +
      items.map(it => '<div class="compare-col"><h3><a data-link href="' + hrefOf(it) + '">' + ui.h(titleOf(it)) + "</a></h3>" + colFn(it) + "</div>").join("") + "</div>";
  }

  document.getElementById("cm-kind").addEventListener("change", e => { kind = e.target.value; ids = []; syncUrl(); renderPicker(); renderChips(); load(); });
  document.getElementById("cm-add").addEventListener("change", e => {
    if (!e.target.value) return;
    if (ids.length >= 4) { announce("Maximum four entities"); e.target.value = ""; return; }
    ids.push(e.target.value); syncUrl(); renderChips(); renderPicker(); load();
  });
  document.getElementById("cm-clear").addEventListener("click", () => { ids = []; syncUrl(); renderChips(); renderPicker(); load(); });
  const h = e => { if (e.target && e.target.id === "cm-retry") load(); };
  document.addEventListener("click", h);

  renderPicker(); renderChips(); await load();
  return { destroy() { document.removeEventListener("click", h); } };
}
