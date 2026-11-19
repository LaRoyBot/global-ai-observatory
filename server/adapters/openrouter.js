// server/adapters/openrouter.js
// OpenRouter adapter: public model catalog (no API key required).
// Endpoint verified live 2026-11-19: GET https://openrouter.ai/api/v1/models
// Real response shape: { data: [ { id, canonical_slug, hugging_face_id, name,
//   created (unix seconds), description, context_length,
//   architecture: { modality, input_modalities, output_modalities, ... },
//   pricing: { prompt, completion, input_cache_read, ... } (strings, USD per
//   TOKEN), top_provider, supported_parameters, ... } ], total_count, links }
//
// Pure adapter: fetch -> validate -> normalize -> dedupe -> provenance.
// No storage, no file writes.

import { resilientFetch, createCircuitBreaker, parseJsonSafe } from './http.js';

export const source = {
  id: 'openrouter',
  name: 'OpenRouter Model Catalog',
  owner: 'OpenRouter, Inc.',
  url: 'https://openrouter.ai/api/v1/models',
  access_method: 'public REST API (JSON, no authentication)',
  datasets: ['models', 'pricing'],
  granularity: 'per model / per pricing category',
  update_frequency: 'continuous (catalog reflects current routing offerings)',
  license: 'metadata publicly served by OpenRouter; model weights governed by their own licenses',
  attribution: 'Data via OpenRouter (https://openrouter.ai)',
  rate_limit: 'no documented public limit for /api/v1/models; client self-limits to >=250ms between requests',
  parser_version: '1.0.0',
  limitations: [
    'Pricing is published per token as strings; normalized to USD per 1,000,000 tokens (original kept in price_original/unit_original).',
    'Only prompt/completion/input_cache_read map to the pricing categories input/output/cached_input; image, audio, web_search, reasoning and cache-write prices do not fit the category schema and are skipped.',
    'No batch pricing fields are present in the live response, so batch_input/batch_output records are never emitted.',
    'Negative prices (e.g. "-1" on openrouter/auto) are variable-pricing sentinels and are skipped.',
    'release_date is derived from the catalog "created" unix timestamp (listing date, not necessarily the original model release).',
    'family is not published by the API and is left null.',
    'effective_date for pricing is not published and is left null.',
  ],
};

const ENDPOINT = 'https://openrouter.ai/api/v1/models';
// One breaker per source; opens after 3 consecutive failed retrieves.
const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });

// pricing field -> normalized category (only fields that fit the schema)
const PRICE_CATEGORIES = [
  ['prompt', 'input', null],
  ['completion', 'output', null],
  ['input_cache_read', 'cached_input', 'cached input (cache read)'],
];

/** Normalize a per-token price string to USD per million tokens. */
function toPerMillion(priceStr) {
  const n = Number(priceStr);
  if (!Number.isFinite(n) || n < 0) return null; // "-1" = variable pricing sentinel
  // toPrecision(12) removes binary-float noise (e.g. 1.5e-7 * 1e6).
  return Number((n * 1_000_000).toPrecision(12));
}

/** "google/gemini-4-neon" -> "google"; fallback null when no namespace. */
function providerSlugOf(id) {
  const i = id.indexOf('/');
  return i > 0 ? id.slice(0, i) : null;
}

/** "Google: Gemini 4 Neon" -> "Google"; fall back to the provider slug. */
function providerNameOf(name, providerSlug) {
  const i = name.indexOf(':');
  if (i > 0) return name.slice(0, i).trim();
  return providerSlug || name;
}

function normalizeModel(m, retrievedAt) {
  const id = m.id;
  const providerSlug = providerSlugOf(id);
  const arch = m.architecture || {};
  const created = Number(m.created);
  return {
    kind: 'model',
    external_id: id,
    slug: id,
    provider_slug: providerSlug,
    provider_name: providerNameOf(String(m.name), providerSlug),
    name: String(m.name),
    family: null, // not published by the API
    release_date: Number.isFinite(created) && created > 0
      ? new Date(created * 1000).toISOString()
      : null,
    context_window: Number.isInteger(m.context_length) ? m.context_length : null,
    input_modalities: Array.isArray(arch.input_modalities) ? arch.input_modalities : [],
    output_modalities: Array.isArray(arch.output_modalities) ? arch.output_modalities : [],
    description: typeof m.description === 'string' && m.description.length > 0 ? m.description : null,
    evidence_class: 'reported',
    source_id: source.id,
    source_url: ENDPOINT,
    retrieved_at: retrievedAt,
  };
}

function normalizePricing(m, retrievedAt) {
  const out = [];
  const pricing = m.pricing;
  if (!pricing || typeof pricing !== 'object') return out;
  for (const [field, category, conditions] of PRICE_CATEGORIES) {
    const raw = pricing[field];
    if (raw == null) continue;
    const price = toPerMillion(raw);
    if (price == null) continue; // skip variable-pricing sentinels / garbage
    out.push({
      kind: 'pricing',
      external_id: m.id,
      provider_slug: providerSlugOf(m.id),
      model_slug: m.id,
      category,
      price, // USD per 1,000,000 tokens (normalized)
      currency: 'USD',
      unit: 'per_million_tokens',
      price_original: Number(raw), // as published (per token)
      unit_original: 'per_token',
      effective_date: null, // not published
      retrieved_at: retrievedAt,
      conditions,
      evidence_class: 'reported',
      source_id: source.id,
      source_url: ENDPOINT,
    });
  }
  return out;
}

/**
 * Retrieve the OpenRouter catalog and normalize to model + pricing records.
 * Optional circuitBreaker/rateLimitMs overrides exist for test isolation;
 * production callers use the module-level breaker and a 250ms self-limit.
 */
export async function retrieve({
  fetchImpl = fetch,
  signal,
  now = () => new Date().toISOString(),
  limit,
  circuitBreaker = breaker,
  rateLimitMs = 250,
} = {}) {
  const retrievedAt = now();
  const errors = [];

  const res = await resilientFetch(ENDPOINT, {
    fetchImpl,
    signal,
    circuitBreaker,
    rateLimitMs,
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    errors.push({ message: `fetch failed: ${res.error}`, status: res.status, attempts: res.attempts });
    return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt };
  }

  const payload = res.json ?? parseJsonSafe(res.body);
  if (!payload || !Array.isArray(payload.data)) {
    errors.push({ message: 'malformed response: expected { data: [...] }' });
    return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt };
  }

  const rawItems = Number.isInteger(limit) && limit >= 0 ? payload.data.slice(0, limit) : payload.data;
  const rawCount = payload.data.length;

  const models = new Map(); // dedupe by model id
  const pricing = new Map(); // dedupe by id + category
  for (const m of rawItems) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.name !== 'string') {
      errors.push({ message: 'skipped item: missing id or name' });
      continue;
    }
    if (!models.has(m.id)) models.set(m.id, normalizeModel(m, retrievedAt));
    for (const p of normalizePricing(m, retrievedAt)) {
      const key = `${p.external_id}::${p.category}`;
      if (!pricing.has(key)) pricing.set(key, p);
    }
  }

  return {
    records: [...models.values(), ...pricing.values()],
    rawCount,
    errors,
    sourceId: source.id,
    retrievedAt,
  };
}
