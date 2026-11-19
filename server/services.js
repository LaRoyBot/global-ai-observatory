// Shared intelligence services: freshness, availability, aggregation, search.
// Freshness, evidence quality and availability are THREE separate dimensions.
import * as repo from "./repositories.js";

export const EVIDENCE_CLASSES = ["measured", "reported", "estimated", "synthetic"];
export const FRESHNESS_STATES = ["current", "stale", "unknown"];
export const AVAILABILITY_STATES = ["available", "partial", "unavailable", "failed"];

export function freshness(retrievedAt, maxAgeDays = 30, now = Date.now()) {
  if (!retrievedAt) return "unknown";
  const t = Date.parse(retrievedAt);
  if (!Number.isFinite(t)) return "unknown";
  return (now - t) <= maxAgeDays * 86400000 ? "current" : "stale";
}

// A failed source is NEVER a numeric zero.
export function availability(sourceStatus, recordCount) {
  if (sourceStatus === "failed") return "failed";
  if (sourceStatus === "unavailable") return "unavailable";
  if (sourceStatus === "partial") return "partial";
  if (recordCount === 0) return "unavailable";
  return "available";
}

export function annotate(row, { maxAgeDays = 30, now = Date.now() } = {}) {
  const stamp = row.retrieved_at || row.verified_at || row.publication_date || null;
  return Object.assign({}, row, { freshness: freshness(stamp, maxAgeDays, now) });
}

/* ---- Token-flow aggregation (server mirror of the client Agg layer) ----
   origin = SERVING country, destination = CONSUMING country.
   inputTokens travel consumer -> server; outputTokens server -> consumer.
   totalTokens is always derived, never stored. */
export function flowTotals(records) {
  let input = 0, output = 0;
  const codes = new Set();
  for (const r of records) {
    input += r.inputTokens; output += r.outputTokens;
    codes.add(r.origin); codes.add(r.destination);
  }
  return { input, output, total: input + output, routes: records.length, countries: codes.size };
}
export function groupFlows(records, side) {
  const m = new Map();
  for (const r of records) {
    const code = side === "origin" ? r.origin : r.destination;
    let g = m.get(code);
    if (!g) { g = { code, input: 0, output: 0, total: 0, routes: 0 }; m.set(code, g); }
    g.input += r.inputTokens; g.output += r.outputTokens; g.total += r.inputTokens + r.outputTokens; g.routes++;
  }
  return [...m.values()];
}
export function rankFlows(records, side, limit = 10) {
  const t = flowTotals(records);
  return groupFlows(records, side)
    .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code))
    .map((g, i) => Object.assign({ rank: i + 1, share: t.total > 0 ? g.total / t.total : 0 }, g))
    .slice(0, limit);
}
export function routeVolumes(records) {
  const m = new Map();
  for (const r of records) {
    const key = r.origin + ">" + r.destination;
    let v = m.get(key);
    if (!v) { v = { key, origin: r.origin, destination: r.destination, input: 0, output: 0, total: 0 }; m.set(key, v); }
    v.input += r.inputTokens; v.output += r.outputTokens; v.total += r.inputTokens + r.outputTokens;
  }
  return [...m.values()];
}
export function countryFlowMetrics(code, records) {
  const serving = { outputServed: 0, inputReceived: 0, total: 0, partners: new Set() };
  const consuming = { outputReceived: 0, inputSent: 0, total: 0, partners: new Set() };
  for (const r of records) {
    if (r.origin === code) {
      serving.outputServed += r.outputTokens; serving.inputReceived += r.inputTokens;
      serving.total += r.inputTokens + r.outputTokens; serving.partners.add(r.destination);
    }
    if (r.destination === code) {
      consuming.outputReceived += r.outputTokens; consuming.inputSent += r.inputTokens;
      consuming.total += r.inputTokens + r.outputTokens; consuming.partners.add(r.origin);
    }
  }
  return {
    serving: Object.assign({}, serving, { partners: serving.partners.size }),
    consuming: Object.assign({}, consuming, { partners: consuming.partners.size })
  };
}

/* ---- Overview: every panel reports its own availability + evidence ---- */
export function overview() {
  const flowRecords = repo.flows.all({ evidence: "synthetic" });
  const periods = repo.flows.periods("synthetic");
  const latest = periods[periods.length - 1] || null;
  const latestRecords = latest ? flowRecords.filter(r => r.period === latest) : [];
  const sites = repo.infrastructure.sites();
  const regions = repo.infrastructure.regions();
  const providers = repo.providers.all();
  const models = repo.models.all({ limit: 5000 });
  const pricingRows = repo.pricing.latest({ limit: 5000 });
  const adoptionObs = repo.adoption.observations();
  const signals = repo.intelligence.list({ limit: 12 });
  const sources = repo.sources.all();
  const pricedModels = new Set(pricingRows.map(p => p.model_slug));
  return {
    generated_at: new Date().toISOString(),
    coverage: {
      countries: repo.countries.count(),
      providers: providers.length,
      models: models.length,
      models_with_pricing: pricedModels.size,
      pricing_observations: pricingRows.length,
      infrastructure_sites: sites.length,
      cloud_regions: regions.length,
      adoption_observations: adoptionObs.length,
      adoption_metrics: repo.adoption.metrics().length,
      intelligence_signals: repo.intelligence.count(),
      flow_records: flowRecords.length,
      flow_periods: periods.length,
      data_sources: sources.length
    },
    flows: {
      evidence_class: "synthetic",
      disclaimer: "Synthetic demo data, not measured international token traffic",
      latest_period: latest,
      periods,
      totals: flowTotals(latestRecords),
      top_serving: rankFlows(latestRecords, "origin", 5).map(withCountryName),
      top_consuming: rankFlows(latestRecords, "destination", 5).map(withCountryName)
    },
    infrastructure: {
      evidence_class: "reported",
      availability: availability(sites.length ? "available" : "unavailable", sites.length),
      by_country: repo.infrastructure.countsByCountry().slice(0, 8).map(withCountryName),
      regions_by_country: repo.infrastructure.regionCountsByCountry().slice(0, 8).map(withCountryName),
      recent_sites: sites.slice(0, 6)
    },
    providers: { evidence_class: "reported", availability: availability(providers.length ? "available" : "unavailable", providers.length), leading: providers.slice(0, 8) },
    models: { evidence_class: "reported", availability: availability(models.length ? "available" : "unavailable", models.length), recent: models.slice(0, 8) },
    economics: {
      evidence_class: "reported",
      availability: availability(pricingRows.length ? "available" : "unavailable", pricingRows.length),
      highlights: pricingRows.filter(p => p.category === "output").slice(0, 8)
    },
    adoption: {
      evidence_class: "reported",
      availability: availability(adoptionObs.length ? "available" : "unavailable", adoptionObs.length),
      observations: adoptionObs.slice(0, 8),
      metrics: repo.adoption.metrics()
    },
    intelligence: { evidence_class: "reported", availability: availability(signals.length ? "available" : "unavailable", signals.length), latest: signals },
    sources: sources.map(s => ({
      id: s.id, name: s.name, status: s.status, last_success_at: s.last_success_at, last_attempt_at: s.last_attempt_at,
      freshness: freshness(s.last_success_at, 7), records_written: s.records_written, failure_reason: s.failure_reason
    }))
  };
}
function withCountryName(row) {
  const c = row.code || row.country_iso3 ? repo.countries.get(row.code || row.country_iso3) : null;
  return Object.assign({}, row, { name: c ? c.name : (row.code || row.country_iso3) });
}

/* ---- Application-wide search (grouped) ---- */
export function search(q, limit = 8) {
  const term = String(q || "").trim();
  if (!term) return { query: term, groups: [] };
  const like = "%" + term + "%";
  const db = repo.countries; // repositories expose prepared queries below
  const groups = [];
  const push = (id, label, rows, href) => { if (rows.length) groups.push({ id, label, results: rows.slice(0, limit).map(r => href(r)) }); };
  push("countries", "Countries", db.all().filter(c => c.name.toLowerCase().includes(term.toLowerCase()) || c.iso3.toLowerCase().includes(term.toLowerCase())),
    c => ({ title: c.name, subtitle: c.iso3 + (c.region ? " · " + c.region : ""), href: "/countries/" + c.iso3, kind: "country" }));
  push("providers", "Providers", repo.providers.all().filter(p => p.name.toLowerCase().includes(term.toLowerCase()) || p.slug.includes(term.toLowerCase())),
    p => ({ title: p.name, subtitle: p.kind + (p.country_iso3 ? " · " + p.country_iso3 : ""), href: "/providers/" + p.slug, kind: "provider" }));
  push("models", "Models", repo.models.all({ limit: 5000 }).filter(m => m.name.toLowerCase().includes(term.toLowerCase()) || m.slug.includes(term.toLowerCase())),
    m => ({ title: m.name, subtitle: m.provider_name || m.provider_slug || "model", href: "/models/" + m.slug, kind: "model" }));
  push("infrastructure", "Infrastructure", repo.infrastructure.sites({ q: term }),
    s => ({ title: s.name, subtitle: s.operator + (s.city ? " · " + s.city : "") + " · " + s.status, href: "/infrastructure?site=" + encodeURIComponent(s.id), kind: "site" }));
  push("intelligence", "Intelligence", repo.intelligence.list({ q: term, limit: limit }),
    r => ({ title: r.headline, subtitle: r.source_name + (r.published_at ? " · " + r.published_at.slice(0, 10) : ""), href: r.source_url, external: true, kind: "signal" }));
  push("metrics", "Adoption metrics", repo.adoption.metrics().filter(m => m.name.toLowerCase().includes(term.toLowerCase()) || m.id.includes(term.toLowerCase())),
    m => ({ title: m.name, subtitle: m.unit + " · " + (m.scope || "adoption"), href: "/adoption?metric=" + encodeURIComponent(m.id), kind: "metric" }));
  return { query: term, groups };
}
