// server/adapters/worldbank-context.js
// World Bank WDI context indicator: individuals using the Internet (% of population).
// This is DIGITAL-INFRASTRUCTURE CONTEXT, explicitly NOT an AI adoption measure.
// Public API, no credentials. Shape verified live 2026-11-20.
import { resilientFetch, createCircuitBreaker } from "./http.js";

export const source = {
  id: "worldbank-context",
  name: "World Bank WDI — individuals using the Internet (context indicator)",
  owner: "World Bank (source: ITU)",
  url: "https://api.worldbank.org/v2/country/all/indicator/IT.NET.USER.ZS?format=json",
  access_method: "public JSON API (no authentication)",
  datasets: ["adoption_metrics", "adoption_observations"],
  granularity: "country × year",
  update_frequency: "annual (WDI release)",
  license: "World Bank open data (CC BY 4.0)",
  attribution: "Source: World Development Indicators, World Bank; underlying source ITU.",
  rate_limit: "public API; client self-limits",
  parser_version: "1.0.0",
  limitations: [
    "Internet use is a digital-infrastructure CONTEXT indicator, NOT AI adoption. It must never be presented as AI uptake.",
    "National population denominator; not enterprise or developer adoption.",
    "Latest available year varies by country; missing values are coverage gaps, never zeros.",
    "Not comparable with enterprise AI surveys such as Eurostat isoc_eb_ai.",
  ],
};

const COUNTRIES = ["USA", "CHN", "IND", "DEU", "GBR", "FRA", "JPN", "KOR", "CAN", "AUS", "BRA", "MEX", "IDN", "SGP", "ISR", "ARE", "SAU", "ZAF", "NGA", "KEN", "EGY", "TUR", "POL", "ESP", "ITA", "NLD", "CHE", "SWE", "NOR", "DNK", "FIN", "IRL", "AUT", "BEL", "PRT", "GRC", "CZE", "ROU", "HUN", "UKR", "RUS", "VNM", "THA", "MYS", "PHL", "PAK", "BGD", "ARG", "CHL", "COL", "PER", "NZL"];
const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 });

export function buildUrl() {
  return "https://api.worldbank.org/v2/country/" + COUNTRIES.join(";") + "/indicator/IT.NET.USER.ZS?format=json&date=2020:2024&per_page=1000";
}

export async function retrieve({ fetchImpl = fetch, signal, now = () => new Date().toISOString(), timeoutMs = 30000, retries = 2 } = {}) {
  const retrievedAt = now();
  const errors = [];
  const url = buildUrl();
  const res = await resilientFetch(url, { fetchImpl, signal, timeoutMs, retries, circuitBreaker: breaker, headers: { Accept: "application/json" } });
  if (!res.ok) { errors.push({ message: "fetch failed: " + res.error, status: res.status }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  let doc;
  try { doc = JSON.parse(res.body); } catch (err) { errors.push({ message: "malformed JSON: " + err.message }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  if (!Array.isArray(doc) || !Array.isArray(doc[1])) { errors.push({ message: "unexpected shape: expected [meta, rows]" }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  const meta = doc[0] || {};
  const pubDate = meta.lastupdated || retrievedAt.slice(0, 10);
  const records = [{
    kind: "adoption_metric", id: "wb-internet-users",
    name: "Individuals using the Internet (% of population) — context indicator",
    definition: "Share of the national population using the Internet. Digital-infrastructure CONTEXT for AI readiness; explicitly NOT a measure of AI adoption.",
    unit: "percent", scope: "National population, selected countries",
    methodology: "World Bank WDI indicator IT.NET.USER.ZS; underlying source ITU. Annual estimates.",
    source_id: source.id,
  }];
  let raw = 0;
  for (const row of doc[1]) {
    raw++;
    if (row.value == null || !row.countryiso3code) continue;
    records.push({
      kind: "adoption", metric_id: "wb-internet-users", country_iso3: row.countryiso3code,
      value: row.value, unit: "percent", reference_period: String(row.date),
      publication_date: pubDate, method: "World Bank WDI (ITU source)",
      sample_note: "National population denominator. Context indicator, not AI adoption.",
      evidence_class: "reported", source_id: source.id,
      source_url: "https://data.worldbank.org/indicator/IT.NET.USER.ZS", retrieved_at: retrievedAt,
    });
  }
  return { records, rawCount: raw, errors, sourceId: source.id, retrievedAt };
}
