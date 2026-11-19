// Country profile — ten sections, each rendered only when data exists.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate } from "../app/router.js";
import { state, selectCountry, announce } from "../app/state.js";
import { createGlobe } from "../geography/globe.js";
import { COUNTRY_COORDS } from "../geography/country-reference.js";
import { fmtCompact, fmtExact, fmtDateTime, periodLabel } from "../shared/formatting.js";

const DISCLAIMER = "Synthetic demo data, not measured international token traffic";
const money = n => n == null ? "—" : "$" + (n >= 1 ? n.toFixed(2) : n.toFixed(4));

export async function mount(ctx) {
  const main = document.getElementById("main");
  const iso = String(ctx.routeParams.iso || "").toUpperCase();
  main.innerHTML = '<div class="workspace" data-screen-label="country-profile">' + ui.loadingBlock("Loading country profile…") + "</div>";
  const [res, flowsR, countriesR] = await Promise.all([
    apiGet("/countries/" + encodeURIComponent(iso), { ttlMs: 0 }),
    apiGet("/flows?all=1", { ttlMs: 60000 }), apiGet("/countries", { ttlMs: 300000 }),
  ]);
  if (!res.ok) {
    main.innerHTML = '<div class="workspace" data-screen-label="country-profile">' +
      ui.workspaceHeader({ title: "Country not found", sub: "No profile exists for “" + iso + "”." }) +
      (res.status === 404 ? ui.emptyState("Unknown country code", "This ISO3 code is not in the canonical reference table. Use search (Ctrl+K) or the overview to find a country.") : ui.errorState(res.error, "cp-retry")) +
      '<div class="btn-row"><a class="btn sm" data-link href="/">Back to overview</a></div></div>';
    const h = e => { if (e.target.id === "cp-retry") navigate("/countries/" + iso); };
    document.addEventListener("click", h);
    return { destroy() { document.removeEventListener("click", h); } };
  }
  const d = res.data, c = d.country;
  const coords = Object.assign({}, COUNTRY_COORDS);
  const countryRows = countriesR.ok ? countriesR.data : [];
  for (const x of countryRows) if (!coords[x.iso3]) coords[x.iso3] = { name: x.name, lon: x.lon, lat: x.lat };
  const nameOf = k => (coords[k] || {}).name || k;
  const sites = d.infrastructure.sites || [], regions = d.infrastructure.regions || [];
  const providers = d.providers || [], models = d.models || [];
  const adoption = d.adoption || [], intel = d.intelligence || [], sources = d.sources || [];
  const flows = d.flows || null;
  selectCountry(iso, "profile");

  const sections = [];
  /* 1 overview + globe focus */
  sections.push(ui.panel({
    title: "1 · Overview", tools: ui.evidenceBadge(c.evidence_class), span: 2,
    body: '<div class="infra-grid"><div class="infra-stage" id="cp-stage" style="height:300px"></div><div>' +
      ui.kv([["Country", c.name], ["ISO3 / ISO2", c.iso3 + " / " + (c.iso2 || "—")], ["Numeric", c.numeric || "—"], ["Region", c.region || "—"], ["Subregion", c.subregion || "—"], ["Capital", c.capital || "—"], ["Reference point", c.lat != null ? c.lat.toFixed(3) + ", " + c.lon.toFixed(3) : "—", "", "Country reference point used for geographic placement"]]) +
      ui.note("The reference point is a country centroid for map placement, not a facility or serving location.") + "</div></div>",
  }));
  /* 2 infrastructure */
  sections.push(ui.panel({
    title: "2 · AI infrastructure", tools: ui.evidenceBadge("reported"),
    body: sites.length ? ui.table({ columns: [
      { key: "name", label: "Facility", render: r => '<a data-link href="/infrastructure?focus=' + encodeURIComponent(r.id) + '">' + ui.h(r.name) + "</a>" },
      { key: "operator", label: "Operator" }, { key: "city", label: "City" },
      { key: "status", label: "Status", render: r => ui.statusBadge(r.status) },
      { key: "src", label: "Source", render: r => ui.sourceLink(r, r.source_id || "source") },
    ], rows: sites }) : ui.emptyState("No sourced facilities", "No publicly documented AI infrastructure records for this country yet. This is a coverage gap, not evidence of absence."),
  }));
  /* 3 cloud regions */
  sections.push(ui.panel({
    title: "3 · Cloud-region presence", tools: '<span class="badge available"><span class="bdot"></span>availability</span>',
    body: regions.length ? ui.table({ columns: [
      { key: "provider_name", label: "Provider" }, { key: "region_code", label: "Region" }, { key: "name", label: "Name" }, { key: "city", label: "City" },
    ], rows: regions }) + ui.note("Cloud-region availability is NOT a verified AI datacentre and does NOT establish where inference is served.")
      : ui.emptyState("No cloud-region records", "No mapped cloud regions for this country in the sourced dataset."),
  }));
  /* 4 ecosystem */
  sections.push(ui.panel({
    title: "4 · Model & provider ecosystem", tools: ui.evidenceBadge("reported"),
    body: (providers.length ? ui.table({ columns: [
      { key: "name", label: "Provider (HQ here)", render: r => '<a data-link href="/providers/' + encodeURIComponent(r.slug) + '">' + ui.h(r.name) + "</a>" },
      { key: "kind", label: "Kind" }, { key: "hq_city", label: "HQ city" },
    ], rows: providers }) : ui.emptyState("No providers headquartered here", "No curated provider records list this country as headquarters.")) +
      ui.note("Headquarters country is NOT inference-serving geography. Providers are listed by HQ only.") +
      (models.length ? '<div class="subhead">Models from these providers (' + models.length + ")</div>" + ui.table({ columns: [
        { key: "name", label: "Model", render: r => '<a data-link href="/models/' + encodeURIComponent(r.slug) + '">' + ui.h(r.name) + "</a>" },
        { key: "release_date", label: "Released", render: r => r.release_date ? String(r.release_date).slice(0, 10) : '<span class="gap-tag">not documented</span>' },
      ], rows: models.slice(0, 12) }) : ""),
  }));
  /* 5 token flows (synthetic) */
  if (flows && flows.metrics) {
    const m = flows.metrics;
    sections.push(ui.panel({
      title: "5 · Token-flow relationships", tools: ui.evidenceBadge("synthetic"), span: 2,
      body: '<div class="disclaimer" style="margin-bottom:10px"><span class="dot"></span>' + DISCLAIMER + "</div>" +
        '<div class="grid-3">' +
        ui.panel({ title: "Serving activity", body: ui.kv([["Output served to others", fmtCompact(m.serving.outputServed), "amber", fmtExact(m.serving.outputServed) + " tokens"], ["Input received as server", fmtCompact(m.serving.inputReceived), "cyan", fmtExact(m.serving.inputReceived) + " tokens"], ["Associated serving volume", fmtCompact(m.serving.total), "", fmtExact(m.serving.total) + " tokens"], ["Consuming partners", String(m.serving.partners)]]) }) +
        ui.panel({ title: "Consumption activity", body: ui.kv([["Output received as consumer", fmtCompact(m.consuming.outputReceived), "amber", fmtExact(m.consuming.outputReceived) + " tokens"], ["Input sent to servers", fmtCompact(m.consuming.inputSent), "cyan", fmtExact(m.consuming.inputSent) + " tokens"], ["Associated consumption volume", fmtCompact(m.consuming.total), "", fmtExact(m.consuming.total) + " tokens"], ["Serving partners", String(m.consuming.partners)]]) }) +
        ui.panel({ title: "Period", body: ui.kv([["Latest demo period", periodLabel(flows.latest_period)], ["Periods available", String((flows.periods || []).length)]]) + '<div class="btn-row"><a class="btn sm" data-link href="/flows">Explore all periods</a></div>' }) +
        "</div>" +
        (flows.relationships && flows.relationships.length ? '<div class="subhead">Bilateral relationships (' + flows.relationships.length + ")</div>" + ui.table({ columns: [
          { key: "origin", label: "Serving", render: r => nameOf(r.origin) }, { key: "destination", label: "Consuming", render: r => nameOf(r.destination) },
          { key: "input", label: "Input", numeric: true, render: r => fmtCompact(r.input) }, { key: "output", label: "Output", numeric: true, render: r => fmtCompact(r.output) },
          { key: "total", label: "Total", numeric: true, render: r => fmtCompact(r.total) },
        ], rows: flows.relationships.slice(0, 20) }) : ui.emptyState("No relationships", "This country has no bilateral records in the latest demo period.")),
    }));
  }
  /* 6 adoption */
  sections.push(ui.panel({
    title: "6 · AI adoption observations", tools: ui.evidenceBadge("reported"),
    body: adoption.length ? ui.table({ columns: [
      { key: "metric_name", label: "Metric", render: r => ui.h(r.metric_name || r.metric_id) },
      { key: "value", label: "Value", numeric: true, render: r => r.value + (r.unit === "percent" ? "%" : "") },
      { key: "reference_period", label: "Period" }, { key: "publication_date", label: "Published" },
      { key: "method", label: "Method" }, { key: "src", label: "Source", render: r => ui.sourceLink(r, r.source_id || "source") },
    ], rows: adoption }) + ui.note("Survey scope and methodology differ by indicator; values are never blended into a composite score.")
      : ui.emptyState("No adoption observations", "No sourced adoption indicator covers this country. Coverage gap, not zero adoption."),
  }));
  /* 7 research & talent */
  const research = intel.filter(i => i.kind === "research_paper");
  const labs = sites.filter(s => s.facility_type === "research_lab");
  sections.push(ui.panel({
    title: "7 · Research & talent", tools: ui.evidenceBadge("reported"),
    body: (labs.length ? '<div class="subhead">Research labs</div>' + ui.table({ columns: [{ key: "name", label: "Lab" }, { key: "city", label: "City" }, { key: "status", label: "Status", render: r => ui.statusBadge(r.status) }], rows: labs }) : "") +
      (research.length ? '<div class="subhead">Research signals</div><ul class="feed-list">' + research.slice(0, 6).map(i => '<li class="feed-item"><a class="feed-headline" href="' + ui.h(i.source_url) + '" target="_blank" rel="noopener noreferrer">' + ui.h(i.headline) + '</a><div class="feed-meta">' + ui.h(i.source_name || "") + " · " + ui.h(String(i.published_at || "").slice(0, 10)) + "</div></li>").join("") + "</ul>"
        : ui.emptyState("No country-linked research", "No research signals are attributed to this country in the current feed. arXiv metadata does not reliably carry author affiliation countries."),
  }));
  /* 8 investment & policy */
  const inv = intel.filter(i => ["infrastructure_investment", "policy_regulation", "provider_announcement", "industry"].includes(i.kind));
  sections.push(ui.panel({
    title: "8 · Investment & policy", tools: ui.evidenceBadge("reported"),
    body: inv.length ? '<ul class="feed-list">' + inv.slice(0, 8).map(i => '<li class="feed-item"><a class="feed-headline" href="' + ui.h(i.source_url) + '" target="_blank" rel="noopener noreferrer">' + ui.h(i.headline) + '</a><div class="feed-meta"><span class="badge">' + ui.h(i.kind.replace(/_/g, " ")) + "</span>" + ui.h(i.source_name || "") + " · published " + ui.h(String(i.published_at || "").slice(0, 10)) + (i.event_at ? " · event " + ui.h(String(i.event_at).slice(0, 10)) : "") + "</div></li>").join("") + "</ul>"
      : ui.emptyState("No investment or policy signals", "No attributed investment/policy items for this country yet. Coverage gap, not absence of activity."),
  }));
  /* 9 dependencies — transparent indicators only */
  const servingTotal = flows && flows.metrics ? flows.metrics.serving.total : 0;
  const consumingTotal = flows && flows.metrics ? flows.metrics.consuming.total : 0;
  const providerExposure = providers.length;
  sections.push(ui.panel({
    title: "9 · Dependencies (transparent indicators)", tools: ui.evidenceBadge("mixed" === "x" ? "reported" : "synthetic"),
    body: ui.kv([
      ["Serving concentration (synthetic)", flows && flows.metrics ? fmtCompact(servingTotal) + " associated tokens" : "no flow records", "", "Synthetic demonstration only"],
      ["Consumption concentration (synthetic)", flows && flows.metrics ? fmtCompact(consumingTotal) + " associated tokens" : "no flow records"],
      ["Cloud-region presence", String(regions.length) + " regions", "", "Availability, not inference serving"],
      ["Provider exposure (HQ)", String(providerExposure) + " providers headquartered here"],
    ]) + ui.note("These are separate, transparent indicators. No composite dependency score is computed, because the underlying concepts are not commensurable."),
  }));
  /* 10 sources & methodology */
  sections.push(ui.panel({
    title: "10 · Sources & methodology", span: 2,
    body: sources.length ? ui.table({ columns: [
      { key: "name", label: "Source" }, { key: "owner", label: "Owner" }, { key: "access_method", label: "Access" },
      { key: "license", label: "Licence" }, { key: "last_success_at", label: "Last retrieval", render: r => fmtDateTime(r.last_success_at) },
      { key: "url", label: "Link", render: r => r.url ? '<a href="' + ui.h(r.url) + '" target="_blank" rel="noopener noreferrer">source ↗</a>' : "—" },
    ], rows: sources }) : ui.emptyState("No sources", "No source records are linked to this profile.") +
      '<div class="btn-row"><a class="btn sm" data-link href="/sources">Full methodology & source health</a></div>',
  }));

  main.innerHTML = '<div class="workspace" data-screen-label="country-profile">' +
    ui.workspaceHeader({ title: c.name, sub: "Country profile · " + iso + " · " + (c.region || "") + (c.subregion ? " / " + c.subregion : ""), actions: '<a class="btn sm ghost" data-link href="/infrastructure?country=' + iso + '">Infrastructure atlas</a><a class="btn sm ghost" data-link href="/adoption?country=' + iso + '">Adoption</a>' }) +
    '<div class="profile-grid">' + sections.join("") + "</div></div>";

  /* globe focus */
  let globe = null;
  const stage = document.getElementById("cp-stage");
  if (stage && flowsR.ok) {
    globe = createGlobe(stage, { flows: flowsR.data.records, countries: coords, lowPower: state.lowPower, autoRotate: false, onAnnounce: announce });
    globe.on("error", () => {});
    globe.on("change", () => {});
    await globe.mount();
    globe.selectCountry(iso, true);
    if (c.lon != null) globe.spotlightTo(c.lon, c.lat);
  } else if (stage) {
    stage.innerHTML = ui.emptyState("Globe unavailable", "The flow dataset could not be loaded; the profile remains fully readable.");
  }
  return { destroy() { if (globe) globe.destroy(); } };
}
