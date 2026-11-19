// Workspace 6 — Intelligence & Research. An attributed feed: every item keeps
// its original source link, publication time and (separate) event time.
// Search, filters, sorting, pagination and a persisted watchlist all work.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate, setParams } from "../app/router.js";
import { state, savePrefs, announce } from "../app/state.js";
import { fmtDateTime } from "../shared/formatting.js";

const KINDS = [
  ["research_paper", "Research papers"], ["model_release", "Model releases"],
  ["provider_announcement", "Provider announcements"], ["infrastructure_investment", "Infrastructure investment"],
  ["pricing_announcement", "Pricing announcements"], ["policy_regulation", "Policy & regulation"],
  ["semiconductor", "Semiconductors"], ["industry", "Industry"],
];
const PAGE = 20;

export async function mount(ctx) {
  const main = document.getElementById("main");
  const p = ctx.params || {};
  let q = p.q || "", kind = p.kind || "", country = p.country || "", provider = p.provider || "";
  let sort = p.sort === "asc" ? "asc" : "desc", savedOnly = p.saved === "1", page = Math.max(0, Number(p.page) || 0);
  let watchlist = Array.isArray(state.prefs.watchlist) ? state.prefs.watchlist.slice() : [];

  main.innerHTML = '<div class="workspace" data-screen-label="intelligence">' +
    ui.workspaceHeader({
      title: "Intelligence & Research",
      sub: "Source-grounded research and industry signals. Original links are always preserved; publication time and event time are kept separate; summaries are drawn from the source, never generated.",
      actions: '<button class="btn sm" id="in-saved" type="button" aria-pressed="' + savedOnly + '">Saved (' + watchlist.length + ')</button><button class="btn sm" id="in-sort" type="button" aria-pressed="' + (sort === "asc") + '">' + (sort === "asc" ? "Oldest first" : "Newest first") + "</button>",
      context: '<span class="mono-note" id="in-note"></span>'
    }) +
    '<div class="filters" id="in-filters"></div>' +
    '<div class="tag-row" id="in-taxonomy" style="margin-bottom:14px"></div>' +
    '<div id="in-feed"></div>' +
    '<div class="btn-row" id="in-pager" style="justify-content:center;margin-top:16px"></div></div>';

  const [res, countriesR, providersR] = await Promise.all([
    apiGet("/intelligence?limit=500", { ttlMs: 0 }),
    apiGet("/countries", { ttlMs: 300000 }), apiGet("/providers", { ttlMs: 300000 }),
  ]);
  if (!res.ok) {
    document.getElementById("in-feed").innerHTML = ui.errorState(res.error, "in-retry");
    const h = e => { if (e.target.id === "in-retry") navigate("/intelligence"); };
    document.addEventListener("click", h);
    return { destroy() { document.removeEventListener("click", h); } };
  }
  const all = res.data.items || [];
  document.getElementById("in-note").textContent = res.data.note || "";
  const countryRows = countriesR.ok ? countriesR.data : [];
  const providerRows = providersR.ok ? providersR.data : [];
  const nameOf = iso => (countryRows.find(c => c.iso3 === iso) || {}).name || iso;
  const countriesUsed = [...new Set(all.map(i => i.country_iso3).filter(Boolean))].sort();
  const providersUsed = [...new Set(all.map(i => i.provider_slug).filter(Boolean))].sort();

  function filtered() {
    let rows = all.filter(i =>
      (!kind || i.kind === kind) &&
      (!country || i.country_iso3 === country) &&
      (!provider || i.provider_slug === provider) &&
      (!savedOnly || watchlist.includes(i.id)) &&
      (!q || (i.headline + " " + (i.summary || "") + " " + (i.source_name || "")).toLowerCase().includes(q.toLowerCase())));
    rows = rows.slice().sort((a, b) => {
      const x = a.published_at || "", y = b.published_at || "";
      return (x < y ? -1 : x > y ? 1 : 0) * (sort === "asc" ? 1 : -1);
    });
    return rows;
  }
  function syncUrl() { setParams({ q, kind, country, provider, sort, saved: savedOnly ? "1" : "", page: page ? String(page) : "" }); }

  function renderFilters() {
    document.getElementById("in-filters").innerHTML =
      '<div class="field" style="min-width:240px"><label for="in-q">Search</label><input class="input" id="in-q" type="search" placeholder="headline, summary, source…" value="' + ui.h(q) + '"></div>' +
      '<div class="field"><label for="in-kind">Topic</label><select class="input" id="in-kind"><option value="">All topics</option>' + KINDS.map(([k, l]) => '<option value="' + k + '"' + (k === kind ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="in-country">Country</label><select class="input" id="in-country"><option value="">All countries</option>' + countriesUsed.map(c => '<option value="' + c + '"' + (c === country ? " selected" : "") + ">" + ui.h(nameOf(c)) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="in-provider">Provider</label><select class="input" id="in-provider"><option value="">All providers</option>' + providersUsed.map(c => '<option value="' + ui.h(c) + '"' + (c === provider ? " selected" : "") + ">" + ui.h(c) + "</option>").join("") + "</select></div>" +
      '<button class="btn sm ghost" id="in-clear" type="button">Clear</button>';
    const qi = document.getElementById("in-q"); let t = null;
    qi.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = qi.value.trim(); page = 0; syncUrl(); renderFeed(); }, 200); });
    document.getElementById("in-kind").addEventListener("change", e => { kind = e.target.value; page = 0; syncUrl(); renderTaxonomy(); renderFeed(); });
    document.getElementById("in-country").addEventListener("change", e => { country = e.target.value; page = 0; syncUrl(); renderFeed(); });
    document.getElementById("in-provider").addEventListener("change", e => { provider = e.target.value; page = 0; syncUrl(); renderFeed(); });
    document.getElementById("in-clear").addEventListener("click", () => { q = ""; kind = ""; country = ""; provider = ""; savedOnly = false; page = 0; syncUrl(); renderFilters(); renderTaxonomy(); renderFeed(); updateSavedBtn(); });
  }
  function renderTaxonomy() {
    const counts = {};
    for (const i of all) counts[i.kind] = (counts[i.kind] || 0) + 1;
    document.getElementById("in-taxonomy").innerHTML = KINDS.map(([k, l]) =>
      '<button class="chip" type="button" data-kind="' + k + '" aria-pressed="' + (kind === k) + '">' + l + " · " + (counts[k] || 0) + "</button>").join("");
    for (const b of document.querySelectorAll("[data-kind]")) b.addEventListener("click", () => { kind = kind === b.dataset.kind ? "" : b.dataset.kind; page = 0; syncUrl(); renderFilters(); renderTaxonomy(); renderFeed(); });
  }
  function updateSavedBtn() {
    const b = document.getElementById("in-saved");
    b.textContent = "Saved (" + watchlist.length + ")"; b.setAttribute("aria-pressed", String(savedOnly));
  }
  function itemCard(i) {
    const saved = watchlist.includes(i.id);
    const links = [];
    if (i.provider_slug) links.push('<a data-link href="/providers/' + encodeURIComponent(i.provider_slug) + '">' + ui.h(i.provider_slug) + "</a>");
    if (i.model_slug) links.push('<a data-link href="/models/' + encodeURIComponent(i.model_slug) + '">' + ui.h(i.model_slug) + "</a>");
    if (i.country_iso3) links.push('<a data-link href="/countries/' + i.country_iso3 + '">' + ui.h(nameOf(i.country_iso3)) + "</a>");
    const authors = Array.isArray(i.authors) && i.authors.length ? '<div class="feed-meta">Authors: ' + ui.h(i.authors.slice(0, 6).join(", ")) + (i.authors.length > 6 ? " et al." : "") + "</div>" : "";
    return '<li class="feed-item" data-item="' + i.id + '">' +
      '<a class="feed-headline" href="' + ui.h(i.source_url) + '" target="_blank" rel="noopener noreferrer">' + ui.h(i.headline) + " ↗</a>" +
      (i.summary ? '<p class="feed-summary">' + ui.h(i.summary) + "</p>" : "") + authors +
      '<div class="feed-meta"><span class="badge">' + ui.h((i.kind || "").replace(/_/g, " ")) + "</span>" + ui.h(i.source_name || "") + " " + ui.evidenceBadge(i.evidence_class) +
        '<button class="btn sm ghost" type="button" data-save="' + i.id + '" aria-pressed="' + saved + '">' + (saved ? "★ Saved" : "☆ Save") + "</button></div>" +
      '<div class="feed-times">published ' + ui.h(fmtDateTime(i.published_at)) + (i.event_at ? " · event " + ui.h(fmtDateTime(i.event_at)) : " · event time not stated") + " · retrieved " + ui.h(fmtDateTime(i.retrieved_at)) + "</div>" +
      (links.length ? '<div class="feed-meta">Related: ' + links.join(" · ") + "</div>" : "") +
      "</li>";
  }
  function renderFeed() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (page >= pages) page = pages - 1;
    const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
    const feed = document.getElementById("in-feed");
    if (!all.length) {
      feed.innerHTML = ui.emptyState("No signals yet", "Public research and announcement feeds have not been ingested. Run npm run ingest to populate arXiv and other sources. No items, timestamps or summaries are fabricated.");
    } else if (!rows.length) {
      feed.innerHTML = ui.emptyState(savedOnly ? "No saved items match" : "No items match these filters", savedOnly ? "Save items with the ☆ button, or clear the saved filter." : "Adjust the search or filters. The feed contains " + all.length + " attributed items.");
    } else {
      feed.innerHTML = ui.panel({
        title: (savedOnly ? "Saved items" : "Feed") + " · " + rows.length + " items",
        tools: '<span class="mono-note">page ' + (page + 1) + " of " + pages + "</span>",
        body: '<ul class="feed-list">' + slice.map(itemCard).join("") + "</ul>",
      });
    }
    const pager = document.getElementById("in-pager");
    pager.innerHTML = pages > 1 ?
      '<button class="btn sm" id="in-prev" type="button"' + (page === 0 ? " disabled" : "") + ">← Newer</button>" +
      '<span class="mono-note">' + (page + 1) + " / " + pages + "</span>" +
      '<button class="btn sm" id="in-next" type="button"' + (page >= pages - 1 ? " disabled" : "") + ">Older →</button>" : "";
    const prev = document.getElementById("in-prev"), next = document.getElementById("in-next");
    if (prev) prev.addEventListener("click", () => { page = Math.max(0, page - 1); syncUrl(); renderFeed(); });
    if (next) next.addEventListener("click", () => { page = Math.min(pages - 1, page + 1); syncUrl(); renderFeed(); });
    for (const b of feed.querySelectorAll("[data-save]")) b.addEventListener("click", () => {
      const id = Number(b.dataset.save);
      if (watchlist.includes(id)) watchlist = watchlist.filter(x => x !== id); else watchlist.push(id);
      savePrefs({ watchlist }); updateSavedBtn(); renderFeed();
      announce(watchlist.includes(id) ? "Item saved" : "Item removed from saved");
    });
  }

  document.getElementById("in-saved").addEventListener("click", () => { savedOnly = !savedOnly; page = 0; syncUrl(); updateSavedBtn(); renderFeed(); });
  document.getElementById("in-sort").addEventListener("click", e => { sort = sort === "asc" ? "desc" : "asc"; e.currentTarget.textContent = sort === "asc" ? "Oldest first" : "Newest first"; e.currentTarget.setAttribute("aria-pressed", String(sort === "asc")); page = 0; syncUrl(); renderFeed(); });

  renderFilters(); renderTaxonomy(); renderFeed();
  return { destroy() {} };
}
