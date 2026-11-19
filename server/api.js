// Typed-ish JSON API boundary. Every response carries provenance metadata.
// Errors use a consistent envelope; a failing source never blanks unrelated data.
import * as repo from "./repositories.js";
import * as svc from "./services.js";
import { publicConfig } from "./config.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, Object.assign({}, JSON_HEADERS, { "content-length": Buffer.byteLength(text) }));
  res.end(text);
}
const ok = (res, data, meta) => sendJson(res, 200, Object.assign({ data, meta: Object.assign({ generated_at: new Date().toISOString() }, meta || {}) }));
const notFound = (res, what) => sendJson(res, 404, { error: { code: "not_found", message: what + " not found" } });
const badRequest = (res, message) => sendJson(res, 400, { error: { code: "bad_request", message } });

function countryProfile(iso3) {
  const c = repo.countries.get(iso3);
  if (!c) return null;
  const flowRecords = repo.flows.all({ evidence: "synthetic" });
  const periods = repo.flows.periods("synthetic");
  const latest = periods[periods.length - 1];
  const latestRecords = latest ? flowRecords.filter(r => r.period === latest) : [];
  const related = flowRecords.filter(r => r.origin === c.iso3 || r.destination === c.iso3);
  return {
    country: c,
    infrastructure: { sites: repo.infrastructure.sites({ country: c.iso3 }), regions: repo.infrastructure.regions({ country: c.iso3 }) },
    providers: repo.providers.all().filter(p => p.country_iso3 === c.iso3),
    models: repo.models.all({ limit: 5000 }).filter(m => {
      const p = m.provider_slug ? repo.providers.get(m.provider_slug) : null;
      return p && p.country_iso3 === c.iso3;
    }),
    flows: {
      evidence_class: "synthetic",
      disclaimer: "Synthetic demo data, not measured international token traffic",
      latest_period: latest,
      metrics: svc.countryFlowMetrics(c.iso3, latestRecords),
      relationships: svc.routeVolumes(related).filter(r => r.origin === c.iso3 || r.destination === c.iso3),
      periods
    },
    adoption: repo.adoption.observations({ country: c.iso3 }),
    intelligence: repo.intelligence.list({ country: c.iso3, limit: 20 }),
    sources: repo.sources.all().filter(s => s.status !== "unknown").slice(0, 12)
  };
}

function providerProfile(slug) {
  const p = repo.providers.get(slug);
  if (!p) return null;
  const models = repo.models.all({ provider: slug, limit: 5000 });
  const pricingRows = repo.pricing.latest({ provider: slug, limit: 5000 });
  return {
    provider: p,
    models,
    pricing: pricingRows,
    regions: repo.infrastructure.regions({ provider: slug }),
    sites: repo.infrastructure.sites({ provider: slug }),
    intelligence: repo.intelligence.list({ provider: slug, limit: 20 }),
    history: models.slice(0, 12).map(m => ({ model_slug: m.slug, observations: repo.pricing.history(m.slug) }))
  };
}

function modelProfile(slug) {
  const m = repo.models.get(slug);
  if (!m) return null;
  return {
    model: m,
    provider: m.provider_slug ? repo.providers.get(m.provider_slug) : null,
    pricing: repo.pricing.forModel(slug),
    history: repo.pricing.history(slug),
    intelligence: repo.intelligence.list({ limit: 300 }).filter(r => r.model_slug === slug || (r.headline || "").toLowerCase().includes(m.name.toLowerCase())).slice(0, 12)
  };
}

export async function handleApi(req, res, url) {
  const parts = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean)
    .map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const [resource, id, sub] = parts;
  const q = url.searchParams;
  try {
    switch (resource) {
      case "config": return ok(res, publicConfig());
      case "health": {
        const sources = repo.sources.all();
        return ok(res, {
          status: "ok",
          database: "ok",
          sources: sources.map(s => ({ id: s.id, status: s.status, freshness: svc.freshness(s.last_success_at, 7), last_success_at: s.last_success_at, failure_reason: s.failure_reason })),
          counts: { countries: repo.countries.count(), providers: repo.providers.count(), models: repo.models.count(), flows: repo.flows.count(), pricing: repo.pricing.count(), adoption: repo.adoption.count(), intelligence: repo.intelligence.count() }
        });
      }
      case "overview": return ok(res, svc.overview());
      case "search": return ok(res, svc.search(q.get("q") || "", Number(q.get("limit")) || 8));
      case "countries": {
        if (!id) return ok(res, repo.countries.all());
        const profile = countryProfile(id);
        return profile ? ok(res, profile) : notFound(res, "Country " + id);
      }
      case "providers": {
        if (!id) return ok(res, repo.providers.all());
        const profile = providerProfile(id);
        return profile ? ok(res, profile) : notFound(res, "Provider " + id);
      }
      case "models": {
        if (!id) return ok(res, repo.models.all({ provider: q.get("provider") || undefined, limit: Number(q.get("limit")) || 500 }));
        const profile = modelProfile(id);
        return profile ? ok(res, profile) : notFound(res, "Model " + id);
      }
      case "flows": {
        const evidence = q.get("evidence") || "synthetic";
        const records = repo.flows.all({ evidence });
        const periods = repo.flows.periods(evidence);
        const all = q.get("all") === "1";
        const period = all ? null : (q.get("period") || periods[periods.length - 1] || null);
        const subset = all ? records : (period ? records.filter(r => r.period === period) : records);
        return ok(res, {
          evidence_class: evidence,
          disclaimer: evidence === "synthetic" ? "Synthetic demo data, not measured international token traffic" : null,
          convention: { origin: "serving country", destination: "consuming country", input_direction: "consumer -> server", output_direction: "server -> consumer" },
          periods, period, records: subset,
          totals: svc.flowTotals(subset),
          routes: svc.routeVolumes(subset),
          top_serving: svc.rankFlows(subset, "origin", 10),
          top_consuming: svc.rankFlows(subset, "destination", 10)
        }, { record_count: subset.length });
      }
      case "infrastructure": {
        const sites = repo.infrastructure.sites({ country: q.get("country") || undefined, type: q.get("type") || undefined, provider: q.get("provider") || undefined, q: q.get("q") || undefined, status: q.get("status") || undefined });
        const regions = repo.infrastructure.regions({ country: q.get("country") || undefined, provider: q.get("provider") || undefined });
        if (id === "sites" && sub) { const s = repo.infrastructure.site(sub); return s ? ok(res, s) : notFound(res, "Site " + sub); }
        return ok(res, {
          sites, regions,
          by_country: repo.infrastructure.countsByCountry(),
          regions_by_country: repo.infrastructure.regionCountsByCountry(),
          statuses: ["planned", "announced", "under_construction", "operational", "decommissioned", "unknown"],
          facility_types: ["ai_datacentre", "cloud_region_facility", "research_lab", "compute_facility", "organisation_hq", "infrastructure_project", "accelerator_vendor"],
          distinctions: [
            "Cloud-region availability is not a physically verified AI data centre.",
            "A data centre is not confirmed to be running AI inference.",
            "Announced capacity is not commissioned capacity.",
            "Planned infrastructure is not operating infrastructure."
          ]
        });
      }
      case "economics": {
        const rows = repo.pricing.latest({ provider: q.get("provider") || undefined, category: q.get("category") || undefined, limit: Number(q.get("limit")) || 3000 });
        const byModel = new Map();
        for (const r of rows) {
          let g = byModel.get(r.model_slug);
          if (!g) { g = { model_slug: r.model_slug, provider_slug: r.provider_slug, categories: {}, retrieved_at: r.retrieved_at, source_url: r.source_url, evidence_class: r.evidence_class }; byModel.set(r.model_slug, g); }
          if (!g.categories[r.category] || g.categories[r.category].retrieved_at < r.retrieved_at) g.categories[r.category] = r;
        }
        return ok(res, {
          unit: "USD per 1,000,000 tokens",
          normalization: "Original published price and unit are retained alongside the normalized amount. Prices in incompatible units are never compared directly.",
          observations: rows,
          catalogue: [...byModel.values()],
          history: id ? repo.pricing.history(id) : undefined,
          coverage: { models: byModel.size, observations: rows.length, providers: new Set(rows.map(r => r.provider_slug)).size }
        });
      }
      case "adoption": {
        const metrics = repo.adoption.metrics();
        const observations = repo.adoption.observations({ metric: q.get("metric") || undefined, country: q.get("country") || undefined });
        const covered = new Set(observations.map(o => o.country_iso3));
        const all = repo.countries.all();
        return ok(res, {
          metrics, observations,
          coverage: { countries_covered: covered.size, countries_total: all.length, gaps: all.filter(c => !covered.has(c.iso3)).map(c => c.iso3) },
          warning: "Observations from different survey methodologies are never merged into one unqualified global ranking. Missing countries are gaps, not zeros."
        });
      }
      case "intelligence":
      case "research": {
        const rows = repo.intelligence.list({ kind: q.get("kind") || (resource === "research" ? "research_paper" : undefined), country: q.get("country") || undefined, provider: q.get("provider") || undefined, q: q.get("q") || undefined, limit: Number(q.get("limit")) || 100, offset: Number(q.get("offset")) || 0 });
        return ok(res, { items: rows, total: repo.intelligence.count(), note: "Publication time and event time are stored separately. Summaries are source-grounded; original links are always preserved." });
      }
      case "sources": {
        const all = repo.sources.all();
        if (id) { const s = all.find(x => x.id === id); return s ? ok(res, s) : notFound(res, "Source " + id); }
        return ok(res, { sources: all.map(s => Object.assign({}, s, { freshness: svc.freshness(s.last_success_at, 7), availability: svc.availability(s.status, s.records_written) })) });
      }
      case "methodology": {
        if (id) { const m = repo.methodology.get(id); return m ? ok(res, m) : notFound(res, "Methodology " + id); }
        return ok(res, repo.methodology.all());
      }
      case "comparisons": {
        const kind = q.get("kind") || "countries";
        const ids = (q.get("ids") || "").split(",").filter(Boolean);
        if (ids.length < 2) return badRequest(res, "Provide at least two ids via ?ids=A,B");
        if (kind === "countries") return ok(res, { kind, items: ids.map(i => countryProfile(i)).filter(Boolean), compatibility: "Only identical metrics and periods are compared; missing values are reported as gaps." });
        if (kind === "providers") return ok(res, { kind, items: ids.map(i => providerProfile(i)).filter(Boolean) });
        if (kind === "models") return ok(res, { kind, items: ids.map(i => modelProfile(i)).filter(Boolean), compatibility: "Pricing compared only in USD per million tokens; benchmark scores from different evaluations are never blended." });
        return badRequest(res, "Unsupported comparison kind: " + kind);
      }
      case "settings": {
        if (req.method === "GET") return ok(res, repo.preferences.get());
        if (req.method === "PUT" || req.method === "POST") {
          let body = "";
          for await (const chunk of req) { body += chunk; if (body.length > 1e6) break; }
          let parsed; try { parsed = JSON.parse(body || "{}"); } catch { return badRequest(res, "Invalid JSON body"); }
          return ok(res, repo.preferences.set(parsed));
        }
        return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use GET or PUT" } });
      }
      case "views": {
        if (req.method === "GET") return ok(res, repo.preferences.views());
        if (req.method === "POST") {
          let body = ""; for await (const chunk of req) body += chunk;
          let parsed; try { parsed = JSON.parse(body || "{}"); } catch { return badRequest(res, "Invalid JSON body"); }
          if (!parsed.name || !parsed.workspace) return badRequest(res, "name and workspace are required");
          repo.preferences.saveView(parsed);
          return ok(res, repo.preferences.views());
        }
        if (req.method === "DELETE" && id) { repo.preferences.deleteView(Number(id)); return ok(res, repo.preferences.views()); }
        return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Unsupported method" } });
      }
      default: return notFound(res, "API resource " + (resource || ""));
    }
  } catch (err) {
    console.error("[api] " + url.pathname, err);
    return sendJson(res, 500, { error: { code: "internal_error", message: err.message || String(err) } });
  }
}
