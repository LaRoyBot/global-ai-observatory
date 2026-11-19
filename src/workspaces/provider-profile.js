// Provider profile — company overview, models, pricing, verified regions,
// infrastructure, releases and sourced pricing history.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate } from "../app/router.js";
import { fmtDateTime } from "../shared/formatting.js";

const money = n => n == null ? "—" : "$" + (n >= 1 ? n.toFixed(2) : n.toFixed(4));
const CAT_LABEL = { input: "Input", output: "Output", cached_input: "Cached input", cache_read: "Cache read", cache_write: "Cache write" };

export async function mount(ctx) {
  const main = document.getElementById("main");
  const slug = ctx.routeParams.slug || "";
  main.innerHTML = '<div class="workspace" data-screen-label="provider-profile">' + ui.loadingBlock("Loading provider profile…") + "</div>";
  const res = await apiGet("/providers/" + encodeURIComponent(slug), { ttlMs: 0 });
  if (!res.ok) {
    main.innerHTML = '<div class="workspace" data-screen-label="provider-profile">' +
      ui.workspaceHeader({ title: "Provider not found", sub: "No profile for “" + slug + "”." }) +
      (res.status === 404 ? ui.emptyState("Unknown provider", "This slug is not in the registry. Use search (Ctrl+K).") : ui.errorState(res.error, "pp-retry")) +
      '<div class="btn-row"><a class="btn sm" data-link href="/">Back to overview</a></div></div>';
    const h = e => { if (e.target.id === "pp-retry") navigate("/providers/" + encodeURIComponent(slug)); };
    document.addEventListener("click", h);
    return { destroy() { document.removeEventListener("click", h); } };
  }
  const d = res.data, p = d.provider;
  const models = d.models || [], pricing = d.pricing || [], regions = d.regions || [], sites = d.sites || [], intel = d.intelligence || [], history = d.history || [];

  /* pricing history: dated observations per category, never manufactured */
  function historyPanel() {
    const series = [];
    for (const h of history) for (const o of (h.observations || [])) series.push(o);
    const byCat = {};
    for (const o of series) {
      const date = (o.effective_date || o.retrieved_at || "").slice(0, 10);
      if (!date) continue;
      byCat[o.category] = byCat[o.category] || {};
      const prev = byCat[o.category][date];
      if (!prev || (o.retrieved_at || "") > (prev.retrieved_at || "")) byCat[o.category][date] = o;
    }
    const cats = Object.keys(byCat);
    if (!cats.length) return ui.panel({ title: "Historical pricing", body: ui.emptyState("No dated history", "No dated pricing observations are recorded for this provider. Trends are never manufactured from a single snapshot.") });
    return ui.panel({ title: "Historical pricing", tools: ui.evidenceBadge("reported"), span: 2,
      body: '<div class="grid-3">' + cats.map(cat => {
        const points = Object.keys(byCat[cat]).sort().map(dt => ({ label: dt, value: byCat[cat][dt].price }));
        return ui.panel({ title: CAT_LABEL[cat] || cat, body: points.length >= 2
          ? ui.lineChart(points, { tone: cat === "output" ? "var(--output-amber)" : "var(--input-cyan)", height: 100 })
          : ui.emptyState("Not enough history", "One dated observation (" + points[0].label + "). A trend needs at least two; none is invented.") });
      }).join("") + "</div>" });
  }

  main.innerHTML = '<div class="workspace" data-screen-label="provider-profile">' +
    ui.workspaceHeader({
      title: p.name, sub: "Provider profile · " + p.slug + (p.kind ? " · " + p.kind : ""),
      actions: (p.website ? '<a class="btn sm" href="' + ui.h(p.website) + '" target="_blank" rel="noopener noreferrer">Official site ↗</a>' : "") + '<a class="btn sm ghost" data-link href="/economics?provider=' + encodeURIComponent(p.slug) + '">Pricing workspace</a>',
      context: ui.evidenceBadge(p.evidence_class) + '<span class="mono-note">source: ' + ui.h(p.source_id || "—") + " · retrieved " + ui.h(fmtDateTime(p.retrieved_at)) + "</span>"
    }) +
    '<div class="profile-grid">' +
    ui.panel({ title: "Company overview", body: ui.kv([
      ["Headquarters country", p.country_iso3 || "not documented"], ["HQ city", p.hq_city || "not documented"],
      ["Kind", p.kind || "—"], ["Description", p.description || "not documented"],
      ["Models catalogued", String(models.length)], ["Pricing observations", String(pricing.length)],
    ]) + ui.note("Headquarters country is NOT inference-serving geography. Model counts come from public catalogues and are not exhaustive.") }) +
    ui.panel({ title: "Available models (" + models.length + ")", body: models.length ? ui.table({ columns: [
      { key: "name", label: "Model", render: r => '<a data-link href="/models/' + encodeURIComponent(r.slug) + '">' + ui.h(r.name) + "</a>" },
      { key: "release_date", label: "Released", render: r => r.release_date ? String(r.release_date).slice(0, 10) : '<span class="gap-tag">not documented</span>' },
      { key: "context_window", label: "Context", numeric: true, render: r => r.context_window ? r.context_window.toLocaleString() : "—" },
    ], rows: models.slice(0, 30) }) + (models.length > 30 ? ui.note("Showing first 30 of " + models.length + ".") : "") : ui.emptyState("No models", "No catalogue records for this provider yet.") }) +
    ui.panel({ title: "Pricing observations (" + pricing.length + ")", tools: ui.evidenceBadge("reported"), span: 2, body: pricing.length ? ui.table({ columns: [
      { key: "model_slug", label: "Model", render: r => '<a data-link href="/models/' + encodeURIComponent(r.model_slug) + '">' + ui.h(r.model_slug) + "</a>" },
      { key: "category", label: "Category", render: r => CAT_LABEL[r.category] || r.category },
      { key: "price", label: "USD / M tokens", numeric: true, render: r => money(r.price) },
      { key: "price_original", label: "Original", render: r => r.price_original != null ? r.price_original + " " + (r.unit_original || "") : "—" },
      { key: "retrieved_at", label: "Retrieved", render: r => String(r.retrieved_at || "").slice(0, 10) },
      { key: "src", label: "Source", render: r => ui.sourceLink(r, r.source_id || "source") },
    ], rows: pricing.slice(0, 40) }) + (pricing.length > 40 ? ui.note("Showing first 40 of " + pricing.length + " observations.") : "") : ui.emptyState("No pricing", "No published pricing observations for this provider. Prices are never estimated.") }) +
    ui.panel({ title: "Provider-supported regions (" + regions.length + ")", tools: '<span class="badge available"><span class="bdot"></span>availability</span>', body: regions.length ? ui.table({ columns: [
      { key: "region_code", label: "Region" }, { key: "name", label: "Name" }, { key: "country_iso3", label: "Country", render: r => r.country_iso3 || '<span class="gap-tag">not mapped</span>' }, { key: "city", label: "City", render: r => r.city || "—" },
    ], rows: regions }) + ui.note("Region availability is where the provider offers services — NOT verified AI datacentres and NOT evidence of where inference is served.") : ui.emptyState("No region records", "No sourced cloud-region records for this provider.") }) +
    ui.panel({ title: "Infrastructure announcements & sites", body: sites.length ? ui.table({ columns: [
      { key: "name", label: "Facility", render: r => '<a data-link href="/infrastructure?focus=' + encodeURIComponent(r.id) + '">' + ui.h(r.name) + "</a>" },
      { key: "country_iso3", label: "Country" }, { key: "status", label: "Status", render: r => ui.statusBadge(r.status) },
    ], rows: sites }) : ui.emptyState("No facility records", "No sourced infrastructure records name this provider as operator.") }) +
    ui.panel({ title: "Research & product releases", body: intel.length ? '<ul class="feed-list">' + intel.slice(0, 8).map(i => '<li class="feed-item"><a class="feed-headline" href="' + ui.h(i.source_url) + '" target="_blank" rel="noopener noreferrer">' + ui.h(i.headline) + '</a><div class="feed-meta"><span class="badge">' + ui.h((i.kind || "").replace(/_/g, " ")) + "</span>" + ui.h(i.source_name || "") + " · published " + ui.h(String(i.published_at || "").slice(0, 10)) + (i.event_at ? " · event " + ui.h(String(i.event_at).slice(0, 10)) : "") + "</div></li>").join("") + "</ul>" : ui.emptyState("No signals", "No attributed announcements or research link this provider yet.") }) +
    historyPanel() +
    ui.panel({ title: "Sources", body: ui.kv([["Registry source", p.source_id || "—"], ["Source URL", p.source_url || "—"], ["Retrieved", fmtDateTime(p.retrieved_at)]]) + '<div class="btn-row">' + ui.sourceLink(p, "Original source") + '<a class="btn sm ghost" data-link href="/sources">Source health</a></div>' }) +
    "</div></div>";
  return { destroy() {} };
}
