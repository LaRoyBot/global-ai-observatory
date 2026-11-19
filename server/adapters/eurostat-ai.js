// server/adapters/eurostat-ai.js
// Official Eurostat ICT-usage survey: enterprises using AI technologies.
// Dataset isoc_eb_ai, JSON-stat 2.0, public dissemination API (no credentials).
// Endpoint and response shape verified live 2026-11-20.
// Pure adapter: no storage, no file writes.
import { resilientFetch, createCircuitBreaker } from "./http.js";

export const source = {
  id: "eurostat-ai",
  name: "Eurostat — Artificial intelligence by size class of enterprise (isoc_eb_ai)",
  owner: "Eurostat (European Commission)",
  url: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_eb_ai",
  access_method: "public JSON-stat 2.0 API (no authentication)",
  datasets: ["adoption_metrics", "adoption_observations"],
  granularity: "country × indicator × enterprise size class × year",
  update_frequency: "annual survey release",
  license: "Eurostat data reuse permitted with attribution (European Commission)",
  attribution: "Source: Eurostat (isoc_eb_ai), ICT usage in enterprises survey.",
  rate_limit: "public dissemination API; client self-limits",
  parser_version: "1.0.0",
  limitations: [
    "Coverage is European Union / EEA / candidate countries only — NOT a global AI adoption measure.",
    "Survey estimates from the ICT usage survey; enterprise sample, not a census.",
    "Headline series uses enterprises with 10+ persons employed (GE10), NACE C10-S951_X_K (excludes agriculture/mining/finance).",
    "Reference years differ by country; missing cells are coverage gaps, never zeros.",
    "Not comparable with consumer-adoption surveys or non-European national statistics.",
  ],
};

const INDICATORS = ["E_AI_TANY", "E_AI_TML", "E_AI_TNLG"];
const ISO2_TO_ISO3 = {
  AT: "AUT", BE: "BEL", BG: "BGR", HR: "HRV", CY: "CYP", CZ: "CZE", DK: "DNK", EE: "EST",
  FI: "FIN", FR: "FRA", DE: "DEU", EL: "GRC", GR: "GRC", HU: "HUN", IE: "IRL", IT: "ITA",
  LV: "LVA", LT: "LTU", LU: "LUX", MT: "MLT", NL: "NLD", PL: "POL", PT: "PRT", RO: "ROU",
  SK: "SVK", SI: "SVN", ES: "ESP", SE: "SWE", IS: "ISL", LI: "LIE", NO: "NOR", CH: "CHE",
  UK: "GBR", GB: "GBR", ME: "MNE", MK: "MKD", RS: "SRB", AL: "ALB", BA: "BIH", XK: "XKX",
  TR: "TUR", UA: "UKR", MD: "MDA", GE: "GEO", AM: "ARM", AZ: "AZE",
};

export function buildUrl() {
  const p = new URLSearchParams({ format: "JSON", lang: "en", unit: "PC_ENT", size_emp: "GE10" });
  for (const i of INDICATORS) p.append("indic_is", i);
  for (const y of ["2023", "2024"]) p.append("time", y);
  return "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_eb_ai?" + p.toString();
}

/** Decode a JSON-stat 2.0 flat value index into per-dimension category codes. */
export function decodeJsonStat(doc) {
  const ids = doc.id || doc.dimension && Object.keys(doc.dimension);
  const sizes = doc.size;
  if (!Array.isArray(ids) || !Array.isArray(sizes) || ids.length !== sizes.length) throw new Error("not a JSON-stat 2.0 dataset");
  const rev = ids.map(d => {
    const idx = doc.dimension[d].category.index;
    const arr = Array.isArray(idx) ? idx.slice() : Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
    return arr;
  });
  const labels = ids.map(d => doc.dimension[d].category.label || {});
  const out = [];
  for (const key of Object.keys(doc.value || {})) {
    const v = doc.value[key];
    if (v == null) continue;
    let k = Number(key);
    const pos = new Array(ids.length);
    for (let d = ids.length - 1; d >= 0; d--) { pos[d] = k % sizes[d]; k = Math.floor(k / sizes[d]); }
    const row = {};
    ids.forEach((d, i) => { row[d] = rev[i][pos[i]]; row[d + "_label"] = labels[i][rev[i][pos[i]]] || rev[i][pos[i]]; });
    row.value = v;
    out.push(row);
  }
  return out;
}

const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 });

export async function retrieve({ fetchImpl = fetch, signal, now = () => new Date().toISOString(), timeoutMs = 30000, retries = 2 } = {}) {
  const retrievedAt = now();
  const errors = [];
  const url = buildUrl();
  const res = await resilientFetch(url, { fetchImpl, signal, timeoutMs, retries, circuitBreaker: breaker, headers: { Accept: "application/json" } });
  if (!res.ok) { errors.push({ message: "fetch failed: " + res.error, status: res.status }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  let doc;
  try { doc = JSON.parse(res.body); } catch (err) { errors.push({ message: "malformed JSON: " + err.message }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  let rows;
  try { rows = decodeJsonStat(doc); } catch (err) { errors.push({ message: err.message }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  const pubDate = (doc.updated || retrievedAt).slice(0, 10);
  const records = [];
  const metricSeen = new Set();
  let skippedAggregates = 0;
  for (const r of rows) {
    if (r.unit !== "PC_ENT" || r.size_emp !== "GE10") continue;
    const iso3 = ISO2_TO_ISO3[r.geo];
    if (!iso3) { skippedAggregates++; continue; } // EU aggregates and unmapped geos are not countries
    const metricId = "eurostat-" + String(r.indic_is).toLowerCase() + "-ge10";
    if (!metricSeen.has(metricId)) {
      metricSeen.add(metricId);
      records.push({
        kind: "adoption_metric", id: metricId,
        name: r.indic_is_label,
        definition: r.indic_is_label + ". Percentage of enterprises (10 persons employed or more) in the surveyed NACE scope, Eurostat ICT usage survey.",
        unit: "percent",
        scope: "Enterprises with 10+ persons employed; NACE C10-S951_X_K (all activities except agriculture, forestry, fishing, mining and quarrying, and the financial sector). EU/EEA/candidate countries.",
        methodology: "Eurostat isoc_eb_ai — ICT usage in enterprises survey; unit PC_ENT (percentage of enterprises); size class GE10.",
        source_id: source.id,
      });
    }
    records.push({
      kind: "adoption", metric_id: metricId, country_iso3: iso3,
      value: r.value, unit: "percent", reference_period: String(r.time),
      publication_date: pubDate,
      method: "Eurostat ICT usage in enterprises survey (isoc_eb_ai)",
      sample_note: "Enterprises with 10 persons employed or more; " + (r.nace_r2_label || "surveyed NACE scope") + ".",
      evidence_class: "reported", source_id: source.id, source_url: url, retrieved_at: retrievedAt,
    });
  }
  if (skippedAggregates) errors.push({ message: "info: skipped " + skippedAggregates + " non-country cells (EU aggregates / unmapped geos)" });
  return { records, rawCount: rows.length, errors: errors.filter(e => !/^info:/.test(e.message)), sourceId: source.id, retrievedAt, notes: errors.filter(e => /^info:/.test(e.message)).map(e => e.message) };
}
