// Idempotent seeding of reference + synthetic data.
// Real public reference data and synthetic fixtures are kept strictly separate:
// every row carries evidence_class, and synthetic rows never enter real rankings.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import * as repo from "../repositories.js";

const readJson = rel => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { console.error("[seed] malformed " + rel + ": " + err.message); return null; }
};

const SOURCES = [
  { id: "synthetic-token-flows", name: "Synthetic AI token-flow demonstration fixture", owner: "Global AI Observatory (fictional)", url: null, access_method: "embedded_fixture", datasets: ["flow_observations"], granularity: "country-pair / monthly", update_frequency: "static fixture", license: "CC0 (fictional demonstration data)", attribution: "Label as synthetic demonstration data; never present as measured traffic.", rate_limit: null, parser_version: "1.0.0", limitations: ["Entirely fictional.", "Serving geography is a modelling convention, not observed inference location.", "Not a measurement of national AI imports or exports."] },
  { id: "natural-earth-110m", name: "Natural Earth 1:110m cultural vectors (world-atlas)", owner: "Natural Earth / world-atlas contributors", url: "https://github.com/topojson/world-atlas", access_method: "static_topojson", datasets: ["country_geometry", "country_reference_points"], granularity: "country", update_frequency: "static release v2.0.2", license: "Natural Earth public domain", attribution: "Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.", rate_limit: null, parser_version: "1.0.0", limitations: ["1:110m omits micro-states such as Singapore; a 1:50m supplement is embedded.", "Country reference points are geometry-derived centroids, not capital cities."] },
  { id: "natural-earth-50m-sg", name: "Natural Earth 1:50m Singapore outline (supplement)", owner: "Natural Earth / world-atlas contributors", url: "https://github.com/topojson/world-atlas", access_method: "static_geojson", datasets: ["country_geometry", "country_reference_points"], granularity: "country", update_frequency: "static release v2.0.2", license: "Natural Earth public domain", attribution: "Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.", rate_limit: null, parser_version: "1.0.0", limitations: ["Used only because 1:110m omits Singapore."] },
  { id: "provider-reference", name: "Curated provider / organisation reference", owner: "Global AI Observatory editorial", url: null, access_method: "curated_reference", datasets: ["providers"], granularity: "organisation", update_frequency: "manual", license: "Editorial compilation of public facts", attribution: "Provider names, headquarters countries and websites are public facts; verify against official sites before reuse.", rate_limit: null, parser_version: "1.0.0", limitations: ["Headquarters country is NOT inference-serving geography.", "Not an exhaustive catalogue."] }
];

const PROVIDERS = [
  ["openai", "OpenAI", "USA", "San Francisco", "https://openai.com", "lab"],
  ["anthropic", "Anthropic", "USA", "San Francisco", "https://www.anthropic.com", "lab"],
  ["google-deepmind", "Google DeepMind", "USA", "Mountain View", "https://deepmind.google", "lab"],
  ["meta-ai", "Meta AI (FAIR)", "USA", "Menlo Park", "https://ai.meta.com", "lab"],
  ["mistral", "Mistral AI", "FRA", "Paris", "https://mistral.ai", "lab"],
  ["xai", "xAI", "USA", "Memphis", "https://x.ai", "lab"],
  ["deepseek", "DeepSeek", "CHN", "Hangzhou", "https://www.deepseek.com", "lab"],
  ["alibaba-qwen", "Alibaba Qwen", "CHN", "Hangzhou", "https://qwen.ai", "lab"],
  ["baidu", "Baidu ERNIE", "CHN", "Beijing", "https://yiyan.baidu.com", "lab"],
  ["zhipu", "Zhipu AI", "CHN", "Beijing", "https://www.zhipuai.cn", "lab"],
  ["moonshot", "Moonshot AI", "CHN", "Beijing", "https://www.moonshot.cn", "lab"],
  ["cohere", "Cohere", "CAN", "Toronto", "https://cohere.com", "lab"],
  ["ai21", "AI21 Labs", "ISR", "Tel Aviv", "https://www.ai21.com", "lab"],
  ["stability", "Stability AI", "GBR", "London", "https://stability.ai", "lab"],
  ["allen-institute", "Allen Institute for AI", "USA", "Seattle", "https://allenai.org", "research"],
  ["mila", "Mila — Quebec AI Institute", "CAN", "Montreal", "https://mila.quebec", "research"],
  ["vector-institute", "Vector Institute", "CAN", "Toronto", "https://vectorinstitute.ai", "research"],
  ["astar", "A*STAR", "SGP", "Singapore", "https://www.a-star.edu.sg", "research"],
  ["tii", "Technology Innovation Institute", "ARE", "Abu Dhabi", "https://www.tii.ae", "research"],
  ["riken", "RIKEN AIP", "JPN", "Tokyo", "https://aip.riken.jp", "research"],
  ["kaist", "KAIST AI", "KOR", "Daejeon", "https://www.kaist.ac.kr", "research"],
  ["inria", "Inria", "FRA", "Paris", "https://www.inria.fr", "research"],
  ["max-planck", "Max Planck Institute for Intelligent Systems", "DEU", "Tübingen", "https://is.mpg.de", "research"],
  ["nvidia", "NVIDIA", "USA", "Santa Clara", "https://www.nvidia.com", "chip"],
  ["amd", "AMD", "USA", "Santa Clara", "https://www.amd.com", "chip"],
  ["intel", "Intel", "USA", "Santa Clara", "https://www.intel.com", "chip"],
  ["cerebras", "Cerebras Systems", "USA", "Sunnyvale", "https://www.cerebras.ai", "chip"],
  ["groq", "Groq", "USA", "Mountain View", "https://groq.com", "chip"],
  ["tsmc", "TSMC", "TWN", "Hsinchu", "https://www.tsmc.com", "chip"],
  ["samsung", "Samsung Electronics", "KOR", "Suwon", "https://www.samsung.com", "chip"],
  ["aws", "Amazon Web Services", "USA", "Seattle", "https://aws.amazon.com", "cloud"],
  ["azure", "Microsoft Azure", "USA", "Redmond", "https://azure.microsoft.com", "cloud"],
  ["gcp", "Google Cloud", "USA", "Mountain View", "https://cloud.google.com", "cloud"],
  ["oracle", "Oracle Cloud Infrastructure", "USA", "Austin", "https://www.oracle.com/cloud/", "cloud"],
  ["alibaba-cloud", "Alibaba Cloud", "CHN", "Hangzhou", "https://www.alibabacloud.com", "cloud"],
  ["openrouter", "OpenRouter", "USA", null, "https://openrouter.ai", "aggregator"],
  ["huggingface", "Hugging Face", "USA", "New York", "https://huggingface.co", "aggregator"],
  ["together", "Together AI", "USA", "San Francisco", "https://www.together.ai", "cloud"],
  ["fireworks", "Fireworks AI", "USA", "Redwood City", "https://fireworks.ai", "cloud"]
];

const METHODOLOGY = [
  { id: "token-flows", title: "AI token flows — geographic convention and honesty", applies_to: ["flows", "overview", "countries"], body_md: "## Convention\n\n`origin` = country where inference is **served**. `destination` = country associated with **consumption**.\n\n- Input (prompt) tokens travel **consumer → server** (green).\n- Output (generated) tokens travel **server → consumer** (amber).\n- `totalTokens = inputTokens + outputTokens`, always derived, never stored.\n\n## What this is not\n\nThis is a conceptual bilateral relationship, **not** a measurement of physical token exports or imports. Model-development country, provider headquarters, billing country, cloud-region availability and inference-serving country are **different concepts** and are never inferred from one another.\n\n## Evidence\n\nThe fixture uses deterministic divergent trajectories (growth, decline, emergence and regional shifts) — never random runtime variation. All bundled flow records are `synthetic`. Public usage statistics usually identify demand geography without identifying serving geography; where no trustworthy bilateral dataset exists, synthetic routes are retained and labelled.\n\n**Synthetic demo data, not measured international token traffic.**" },
  { id: "particle-scale", title: "Flow stream volume encoding (Globe 2.0)", applies_to: ["flows"], body_md: "## Documented encoding\n\n- Corridor width = `0.55 + 2.85 × sqrt(volume / maxVolume)` px; glow alpha = `0.025 + 0.07 × sqrt(volume / maxVolume)`; lane alpha = `min(0.55, 0.10 + 0.24 × sqrt(volume / maxVolume))`.\n- Particle radius = `clamp(1 + 2.2 × sqrt(volume / maxVolume), 1, 3.2)` px.\n- Carrier allocation weight = `volume^0.72`, distributed by largest remainder with stable tie-breaking. Budget: **≤150 carriers** (≤75 in low-power). Every visible non-zero stream gets one where budget allows.\n- Each carrier draws a leading dot plus 4–14 micro-dots that partition the interval to the previous carrier (`spacing = 1 / carrier-count`), forming granular, continuous-looking streams. Heavy streams get more carriers, so their dots are closer together.\n- Input and output use lanes rotated ±0.9° around the great-circle normal with a sinusoidal taper: they converge at both real endpoints and share the same backside horizon clipping. Speed is constant and illustrative — a monthly token total is not a packet rate.\n- Adaptive quality reduces only micro-dot count and decorative glow on slow frames; it never changes geography, selection or route visibility. The instrument reports measured FPS, allocated and currently visible carriers, quality tier and renderer.\n\nCarriers are **not** individual tokens. Exact numeric volumes are always shown independently." },
  { id: "infrastructure-status", title: "Infrastructure status and verification", applies_to: ["infrastructure"], body_md: "Facility status is one of `planned`, `announced`, `under_construction`, `operational`, `decommissioned`, `unknown`, and is only assigned when supported by a cited source.\n\nCritical distinctions kept separate:\n\n- Cloud-region availability ≠ physically verified AI data centre.\n- A data centre ≠ confirmed active AI inference.\n- Announced capacity ≠ commissioned capacity.\n- Planned infrastructure ≠ operating infrastructure.\n\nCounts are shown only with compatible denominators and documented source coverage. No fabricated global compute-capacity heatmap is produced." },
  { id: "pricing-normalization", title: "Pricing normalization and comparison integrity", applies_to: ["economics", "models", "providers"], body_md: "Every pricing observation retains the **original published price and unit** alongside a normalized amount in **USD per 1,000,000 tokens**.\n\n- Prices in incompatible units (e.g. per thousand characters) are never compared directly without an explicit, documented conversion.\n- Cached-input and batch conditions are stored as separate categories, not averaged into standard pricing.\n- Historical price changes are shown only when dated observations actually exist. Synthetic history is labelled; random fluctuations are never manufactured from current prices." },
  { id: "adoption-comparability", title: "Adoption indicators and comparability", applies_to: ["adoption", "countries"], body_md: "Each observation carries a metric definition, geographic scope, reference period, publication date, measurement method, source and evidence class.\n\n- Survey results with fundamentally different sampling methodologies are **never** merged into one unqualified global ranking.\n- Missing countries are **coverage gaps**, not zeros, and are never filled by interpolation without documented methodology.\n- Choropleths render only where a defensible metric exists for the selected period." },
  { id: "provenance", title: "Provenance, freshness and availability", applies_to: ["*"], body_md: "Three independent dimensions are tracked and never collapsed into one status field:\n\n- **Evidence class**: `measured` | `reported` | `estimated` | `synthetic`.\n- **Freshness**: `current` | `stale` | `unknown` (derived from retrieval/verification timestamps).\n- **Availability**: `available` | `partial` | `unavailable` | `failed`.\n\nA source outage is never rendered as genuine zero activity. Last-good observations are retained, and a failing source cannot blank unrelated datasets." }
];

export async function seed({ quiet = true } = {}) {
  const gaps = [];
  const counts = {};
  for (const s of SOURCES) repo.sources.upsert(s);
  for (const m of METHODOLOGY) repo.methodology.upsert(m);

  const countries = readJson("data/reference/countries.json");
  if (countries && Array.isArray(countries)) { for (const c of countries) repo.countries.upsert(c); counts.countries = countries.length; }
  else gaps.push("data/reference/countries.json missing — run scripts/build-countries.js");

  for (const [slug, name, iso3, city, website, kind] of PROVIDERS) {
    repo.providers.upsert({ slug, name, country_iso3: iso3, hq_city: city, website, kind, evidence_class: "reported", source_id: "provider-reference", source_url: website });
  }
  counts.providers = PROVIDERS.length;

  const fixture = readJson("data/synthetic/flows.json");
  if (fixture && Array.isArray(fixture.records)) {
    repo.flows.replaceFixture(fixture.records, { sourceId: "synthetic-token-flows", fixtureVersion: fixture.version || "1.0.0", evidenceClass: "synthetic" });
    counts.flow_records = fixture.records.length;
    repo.sources.recordRun("synthetic-token-flows", { started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: "success", records_written: fixture.records.length, raw_count: fixture.records.length, parser_version: "1.0.0" });
  } else gaps.push("data/synthetic/flows.json missing");

  const regions = readJson("data/reference/cloud-regions.json");
  if (regions && Array.isArray(regions)) {
    for (const r of regions) repo.infrastructure.upsertRegion(r);
    counts.cloud_regions = regions.length;
    const ids = [...new Set(regions.map(r => r.source_id).filter(Boolean))];
    for (const id of ids) if (!repo.sources.get(id)) repo.sources.upsert({ id, name: id, access_method: "curated_reference", datasets: ["cloud_regions"], status: "available", parser_version: "1.0.0" });
  } else gaps.push("data/reference/cloud-regions.json not present yet (reference-data workstream pending)");

  const sites = readJson("data/reference/infrastructure-sites.json");
  if (sites && Array.isArray(sites)) {
    for (const s of sites) repo.infrastructure.upsertSite(s);
    counts.infrastructure_sites = sites.length;
    const ids = [...new Set(sites.map(s => s.source_id).filter(Boolean))];
    for (const id of ids) if (!repo.sources.get(id)) repo.sources.upsert({ id, name: id, access_method: "curated_reference", datasets: ["infrastructure_sites"], status: "available", parser_version: "1.0.0" });
  } else gaps.push("data/reference/infrastructure-sites.json not present yet (reference-data workstream pending)");

  const adoption = readJson("data/reference/adoption-indicators.json");
  if (adoption && Array.isArray(adoption)) {
    const metrics = new Map();
    for (const a of adoption) if (!metrics.has(a.metric_id)) metrics.set(a.metric_id, { id: a.metric_id, name: a.metric_name || a.metric_id, definition: a.method || a.metric_name || a.metric_id, unit: a.unit, scope: "country", methodology: a.method || null, source_id: a.source_id });
    for (const m of metrics.values()) repo.adoption.upsertMetric(m);
    counts.adoption_observations = repo.adoption.insertMany(adoption);
    counts.adoption_metrics = metrics.size;
    const ids = [...new Set(adoption.map(a => a.source_id).filter(Boolean))];
    for (const id of ids) if (!repo.sources.get(id)) repo.sources.upsert({ id, name: id, access_method: "published_statistics", datasets: ["adoption_observations"], status: "available", parser_version: "1.0.0" });
  } else gaps.push("data/reference/adoption-indicators.json not present yet (reference-data workstream pending)");

  counts.intelligence_signals = repo.intelligence.count();
  counts.models = repo.models.count();
  counts.pricing_observations = repo.pricing.count();
  if (!quiet) console.log("[seed] complete");
  return { counts, gaps };
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  const { openDatabase } = await import("../db.js");
  const { config } = await import("../config.js");
  openDatabase(config.databasePath);
  const r = await seed({ quiet: false });
  console.log(JSON.stringify(r, null, 2));
}
