// server/adapters/huggingface.js
// Hugging Face adapter: most-downloaded public models.
// Endpoint verified live 2026-11-19:
// GET https://huggingface.co/api/models?sort=downloads&direction=-1&limit=50&full=true
// Real response: JSON array of objects with { _id, id ("org/name"), author,
// gated, lastModified, likes, private, sha, downloads, tags, pipeline_tag,
// library_name, createdAt, modelId, siblings }. No context-window or
// description fields are present in the list response.
//
// Pure adapter: fetch -> validate -> normalize -> dedupe -> provenance.
// No storage, no file writes.

import { resilientFetch, createCircuitBreaker, parseJsonSafe } from './http.js';

export const source = {
  id: 'huggingface',
  name: 'Hugging Face Model Hub (top downloads)',
  owner: 'Hugging Face, Inc.',
  url: 'https://huggingface.co/api/models',
  access_method: 'public REST API (JSON, no authentication)',
  datasets: ['models'],
  granularity: 'per model repository (top 50 by downloads by default)',
  update_frequency: 'continuous (hub metadata reflects live repository state)',
  license: 'hub metadata publicly served; each model carries its own license tag',
  attribution: 'Data via Hugging Face (https://huggingface.co)',
  rate_limit: 'no documented public limit for anonymous model listing; client self-limits to >=250ms between requests',
  parser_version: '1.0.0',
  limitations: [
    'release_date uses createdAt (repository creation timestamp) — a proxy for release, not an authoritative model release date.',
    'context_window is not exposed by the list API and is always null (never fabricated).',
    'description is not exposed by the list API and is always null.',
    'input/output modalities are mapped from the documented pipeline_tag semantics; unknown or absent pipeline_tag yields empty arrays.',
    'family is not published as a structured field and is left null.',
    'Ranking is by all-time downloads, which biases toward older, popular models.',
  ],
};

const ENDPOINT = 'https://huggingface.co/api/models';
const DEFAULT_LIMIT = 50;
const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });

// Documented HF pipeline_tag -> [input, output] modality mapping.
// Conservative: only well-defined pipelines are mapped; anything else -> [].
const PIPELINE_MODALITIES = {
  'text-generation': [['text'], ['text']],
  'text2text-generation': [['text'], ['text']],
  summarization: [['text'], ['text']],
  translation: [['text'], ['text']],
  'text-classification': [['text'], ['text']],
  'token-classification': [['text'], ['text']],
  'fill-mask': [['text'], ['text']],
  'question-answering': [['text'], ['text']],
  'table-question-answering': [['text'], ['text']],
  'zero-shot-classification': [['text'], ['text']],
  'sentence-similarity': [['text'], ['text']],
  'text-ranking': [['text'], ['text']],
  'feature-extraction': [['text'], ['text']],
  'automatic-speech-recognition': [['audio'], ['text']],
  'audio-classification': [['audio'], ['text']],
  'audio-to-audio': [['audio'], ['audio']],
  'text-to-speech': [['text'], ['audio']],
  'text-to-image': [['text'], ['image']],
  'text-to-video': [['text'], ['video']],
  'image-classification': [['image'], ['text']],
  'object-detection': [['image'], ['text']],
  'image-segmentation': [['image'], ['image']],
  'image-to-text': [['image'], ['text']],
  'image-text-to-text': [['image', 'text'], ['text']],
  'zero-shot-image-classification': [['image'], ['text']],
  'visual-question-answering': [['image', 'text'], ['text']],
  'image-to-image': [['image'], ['image']],
};

function modalitiesOf(pipelineTag) {
  const mapped = PIPELINE_MODALITIES[pipelineTag];
  return mapped ? { input: [...mapped[0]], output: [...mapped[1]] } : { input: [], output: [] };
}

function toIsoOrNull(s) {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeModel(m, retrievedAt) {
  const id = m.id;
  const slash = id.indexOf('/');
  const providerSlug = slash > 0 ? id.slice(0, slash) : (typeof m.author === 'string' ? m.author : null);
  const displayName = slash > 0 ? id.slice(slash + 1) : id;
  const { input, output } = modalitiesOf(m.pipeline_tag);
  return {
    kind: 'model',
    external_id: id,
    slug: id,
    provider_slug: providerSlug,
    provider_name: providerSlug || displayName,
    name: displayName,
    family: null, // no structured family field in the API
    release_date: toIsoOrNull(m.createdAt), // repo creation; null when absent
    context_window: null, // not exposed by the list API — never fabricated
    input_modalities: input,
    output_modalities: output,
    description: null, // not exposed by the list API
    evidence_class: 'reported',
    source_id: source.id,
    source_url: `${ENDPOINT}?sort=downloads&direction=-1&full=true`,
    retrieved_at: retrievedAt,
  };
}

export function buildQueryUrl(limit) {
  const n = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  return `${ENDPOINT}?sort=downloads&direction=-1&limit=${n}&full=true`;
}

/**
 * Retrieve top-downloaded HF models and normalize to model records.
 * Optional circuitBreaker/rateLimitMs overrides exist for test isolation.
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
  const url = buildQueryUrl(limit);

  const res = await resilientFetch(url, {
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
  if (!Array.isArray(payload)) {
    errors.push({ message: 'malformed response: expected a JSON array of models' });
    return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt };
  }

  const rawCount = payload.length;
  const seen = new Map(); // dedupe by model id
  for (const m of payload) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || m.private === true) {
      errors.push({ message: 'skipped item: missing id or private model' });
      continue;
    }
    if (!seen.has(m.id)) seen.set(m.id, normalizeModel(m, retrievedAt));
  }

  return {
    records: [...seen.values()],
    rawCount,
    errors,
    sourceId: source.id,
    retrievedAt,
  };
}
