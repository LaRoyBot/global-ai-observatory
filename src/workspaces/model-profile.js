// Model profile — release info, capabilities, pricing, history, related signals.
// Benchmarks are shown only if present in the data; none are invented or blended.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate } from "../app/router.js";
import { fmtDateTime } from "../shared/formatting.js";

const money = n => n == null ? "—" : "$" + (n >= 1 ? n.toFixed(2) : n.toFixed(4));
const CAT_LABEL = { input: "Input", output: "Output", cached_input: "Cached input", cache_read: "Cache read", cache_write: "Cache write" };

export async function mount(ctx) {
  const main = document.getElementById("main");
  const slug = ctx.routeParams.slug || "";
  main.innerHTML = '<div class="workspace" data-screen-label="model-profile">' + ui.loadingBlock("Loading model profile…") + "</div>";
  const res = await apiGet("/models/" + encodeURIComponent(slug), { ttlMs: 0 });
  if (!res.ok) {
    main.innerHTML = '<div class="workspace" data-screen-label="model-profile">' +
      ui.workspaceHeader({ title: "Model not found", sub: "No profile for “" + slug + "”." }) +
      (res.status === 404 ? ui.emptyState("Unknown model", "This slug is not in the catalogue. Use search (Ctrl+K) or the Economics workspace.") : ui.errorState(res.error, "mp-retry")) +
      '<div class="btn-row"><a class="btn sm" data-link href="/economics">Back to economics</a></div></div>';
    const h = e => { if (e.target.id === "mp-retry") navigate("/models/" + encodeURIComponent(slug)); };
    document.addEventListener("click", h);
    return { destroy() { document.removeEventListener("click", h); } };
  }
  const d = res.data, m = d.model, p = d.provider;
  const pricing = d.pricing || [], history = d.history || [], intel = d.intelligence || [];
  const caps = [].concat(m.input_modalities || [], m.output_modalities || []);

  const byCat = {};
  for (const o of history) {
    const date = (o.effective_date || o.retrieved_at || "").slice(0, 10);
    if (!date) continue;
    byCat[o.category] = byCat[o.category] || {};
    const prev = byCat[o.category][date];
    if (!prev || (o.retrieved_at || "") > (prev.retrieved_at || "")) byCat[o.category][date] = o;
  }
  const histCats = Object.keys(byCat);

  main.innerHTML = '<div class="workspace" data-screen-label="model-profile">' +
    ui.workspaceHeader({
      title: m.name, sub: "Model profile · " + m.slug,
      actions: (p ? '<a class="btn sm" data-link href="/providers/' + encodeURIComponent(p.slug) + '">' + ui.h(p.name) + "</a>" : "") + '<a class="btn sm ghost" data-link href="/economics?q=' + encodeURIComponent(m.slug) + '">Compare pricing</a>',
      context: ui.evidenceBadge(m.evidence_class) + '<span class="mono-note">source: ' + ui.h(m.source_id || "—") + "</span>"
    }) +
    '<div class="profile-grid">' +
    ui.panel({ title: "Release information", body: ui.kv([
      ["Provider", p ? p.name : "not documented"],
      ["Family", m.family || "not documented"],
      ["Release date", m.release_date ? String(m.release_date).slice(0, 10) : "not documented"],
      ["Context window", m.context_window ? m.context_window.toLocaleString() + " tokens" : "not documented"],
      ["Capabilities", caps.length ? caps.join(", ") : "not documented"],
      ["External id", m.external_id || "—"],
    ]) + ui.note("Fields marked “not documented” are absent from the source record; they are never guessed.") }) +
    ui.panel({ title: "Pricing (" + pricing.length + " observations)", tools: ui.evidenceBadge("reported"), body: pricing.length ? ui.table({ columns: [
      { key: "category", label: "Category", render: r => CAT_LABEL[r.category] || r.category },
      { key: "price", label: "USD / M tokens", numeric: true, render: r => money(r.price) },
      { key: "price_original", label: "Original", render: r => r.price_original != null ? r.price_original + " " + (r.unit_original || "") : "—" },
      { key: "retrieved_at", label: "Retrieved", render: r => String(r.retrieved_at || "").slice(0, 10) },
      { key: "src", label: "Source", render: r => ui.sourceLink(r, r.source_id || "source") },
    ], rows: pricing }) : ui.emptyState("No pricing observation", "No published price is recorded for this model. It is never estimated or treated as free.") }) +
    ui.panel({ title: "Benchmarks", body: ui.emptyState("No benchmark data", "No benchmark observations are stored for this model. Scores from different evaluations are never blended, and none are fabricated.") }) +
    ui.panel({ title: "Pricing history", span: 2, body: histCats.length ? '<div class="grid-3">' + histCats.map(cat => {
      const points = Object.keys(byCat[cat]).sort().map(dt => ({ label: dt, value: byCat[cat][dt].price }));
      return ui.panel({ title: CAT_LABEL[cat] || cat, body: points.length >= 2
        ? ui.lineChart(points, { tone: cat === "output" ? "var(--output-amber)" : "var(--input-cyan)", height: 100 })
        : ui.emptyState("Not enough history", "One dated observation (" + points[0].label + "). No trend is manufactured.") });
    }).join("") + "</div>" : ui.emptyState("No dated history", "No dated pricing observations for this model yet.") }) +
    ui.panel({ title: "Related research & announcements", span: 2, body: intel.length ? '<ul class="feed-list">' + intel.slice(0, 8).map(i => '<li class="feed-item"><a class="feed-headline" href="' + ui.h(i.source_url) + '" target="_blank" rel="noopener noreferrer">' + ui.h(i.headline) + '</a><div class="feed-meta">' + ui.h(i.source_name || "") + " · published " + ui.h(String(i.published_at || "").slice(0, 10)) + "</div></li>").join("") + "</ul>" : ui.emptyState("No related signals", "No feed items reference this model yet.") }) +
    ui.panel({ title: "Sources", body: (m.source_url ? '<div class="btn-row">' + ui.sourceLink(m, "Original catalogue entry") + "</div>" : ui.note("No source URL recorded.")) + '<div class="btn-row"><a class="btn sm ghost" data-link href="/sources">Source health & methodology</a></div>' }) +
    "</div></div>";
  return { destroy() {} };
}
