// Ingestion orchestrator. Adapters are optional modules: a missing or failing
// adapter records a source run and never blanks unrelated datasets.
import fs from "node:fs";
import path from "node:path";
import { ROOT, config } from "../config.js";
import * as repo from "../repositories.js";

const ADAPTERS = [
  { file: "../adapters/openrouter.js", kinds: ["model", "pricing"] },
  { file: "../adapters/huggingface.js", kinds: ["model"] },
  { file: "../adapters/arxiv.js", kinds: ["research"] },
  { file: "../adapters/infrastructure-reference.js", kinds: ["site"] },
  { file: "../adapters/aws-regions.js", kinds: ["region"] },
  { file: "../adapters/eurostat-ai.js", kinds: ["adoption_metric", "adoption"] },
  { file: "../adapters/worldbank-context.js", kinds: ["adoption_metric", "adoption"] }
];

async function loadAdapter(rel) {
  const file = path.join(ROOT, "server", rel.replace("../", ""));
  if (!fs.existsSync(file)) return null;
  try { return await import(rel); } catch (err) { console.error("[ingest] adapter load failed " + rel + ": " + err.message); return null; }
}

export async function runIngestion({ reason = "manual", fetchImpl = fetch, only = null } = {}) {
  const summary = { reason, started_at: new Date().toISOString(), sources: [], totals: { models: 0, pricing: 0, research: 0, sites: 0, regions: 0, adoption: 0 } };
  for (const spec of ADAPTERS) {
    const mod = await loadAdapter(spec.file);
    const startedAt = new Date().toISOString();
    if (!mod || typeof mod.retrieve !== "function") {
      const id = spec.file.split("/").pop().replace(".js", "");
      repo.sources.upsert({ id, name: id + " adapter (not installed)", access_method: "missing_adapter", datasets: spec.kinds, status: "unavailable", limitations: ["Adapter module not present in this checkout."] });
      repo.sources.recordRun(id, { started_at: startedAt, status: "failed", error: "Adapter module not present", parser_version: null });
      summary.sources.push({ id, status: "unavailable", error: "adapter missing" });
      continue;
    }
    const source = mod.source || { id: spec.file.split("/").pop().replace(".js", "") };
    if (only && source.id !== only) continue;
    repo.sources.upsert(Object.assign({ status: "unknown" }, source));
    try {
      const result = await mod.retrieve({ fetchImpl, timeoutMs: config.ingestTimeoutMs, retries: config.ingestMaxRetries, limit: 200 });
      let models = 0, pricing = 0, research = 0, sites = 0, regions = 0, adoption = 0, rejected = 0;
      const providerIds = new Map();
      for (const rec of result.records || []) {
        if (rec.kind === "model") {
          let providerId = null;
          if (rec.provider_slug) {
            if (!providerIds.has(rec.provider_slug)) {
              providerIds.set(rec.provider_slug, repo.providers.upsert({ slug: rec.provider_slug, name: rec.provider_name || rec.provider_slug, kind: "lab", evidence_class: "reported", source_id: source.id, source_url: rec.source_url, retrieved_at: rec.retrieved_at }));
            }
            providerId = providerIds.get(rec.provider_slug);
          }
          repo.models.upsert(Object.assign({}, rec, { provider_id: providerId, source_id: source.id }));
          models++;
        } else if (rec.kind === "pricing") {
          pricing += repo.pricing.insertMany([Object.assign({}, rec, { source_id: source.id })]);
        } else if (rec.kind === "research") {
          research += repo.intelligence.insertMany([Object.assign({}, rec, { kind: "research_paper", source_name: source.name || source.id, source_id: source.id })]);
        } else if (rec.kind === "site") {
          repo.infrastructure.upsertSite(Object.assign({}, rec, { source_id: source.id })); sites++;
        } else if (rec.kind === "region") {
          // A region whose mapped country is outside the canonical reference
          // table is still recorded, with country left null rather than guessed.
          const r = Object.assign({}, rec, { source_id: source.id });
          if (r.country_iso3 && !repo.countries.get(r.country_iso3)) {
            r.notes = (r.notes || "") + " Mapped country " + r.country_iso3 + " is not in the canonical reference table; country left null.";
            r.country_iso3 = null; r.lat = null; r.lon = null; rejected++;
          }
          repo.infrastructure.upsertRegion(r); regions++;
        } else if (rec.kind === "adoption_metric") {
          repo.adoption.upsertMetric(Object.assign({}, rec, { source_id: source.id }));
        } else if (rec.kind === "adoption") {
          // Referential integrity: an observation for a country outside the
          // canonical reference table is rejected, never silently coerced.
          if (!repo.countries.get(rec.country_iso3)) { rejected++; continue; }
          adoption += repo.adoption.insertMany([Object.assign({}, rec, { source_id: source.id })]);
        }
      }
      const written = models + pricing + research + sites + regions + adoption;
      const status = (result.errors && result.errors.length) ? (written > 0 ? "partial" : "failed") : "success";
      repo.sources.recordRun(source.id, { started_at: startedAt, finished_at: new Date().toISOString(), status, records_written: written, raw_count: result.rawCount || 0, error: (result.errors || []).join("; ") || null, parser_version: source.parser_version });
      summary.totals.models += models; summary.totals.pricing += pricing; summary.totals.research += research;
      summary.totals.sites += sites; summary.totals.regions += regions; summary.totals.adoption += adoption;
      summary.sources.push({ id: source.id, status, models, pricing, research, sites, regions, adoption, rejected, raw: result.rawCount || 0, errors: result.errors || [] });
    } catch (err) {
      repo.sources.recordRun(source.id, { started_at: startedAt, finished_at: new Date().toISOString(), status: "failed", error: err.message || String(err), parser_version: source.parser_version });
      summary.sources.push({ id: source.id, status: "failed", error: err.message || String(err) });
    }
  }
  summary.finished_at = new Date().toISOString();
  return summary;
}

if (process.argv[1] && process.argv[1].endsWith("ingest.js")) {
  const { openDatabase } = await import("../db.js");
  openDatabase(config.databasePath);
  const r = await runIngestion({ reason: "cli" });
  console.log(JSON.stringify(r, null, 2));
}
