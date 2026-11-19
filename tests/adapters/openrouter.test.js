// tests/adapters/openrouter.test.js
// OpenRouter adapter tests. No network: fetchImpl injected.
// SAMPLE below is trimmed from the real live response of
// GET https://openrouter.ai/api/v1/models captured on 2026-11-19
// (fields kept verbatim; long descriptions/parameter lists shortened).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { source, retrieve } from '../../server/adapters/openrouter.js';
import { createCircuitBreaker } from '../../server/adapters/http.js';

const NOW = '2026-11-19T00:00:00.000Z';
const ENDPOINT = 'https://openrouter.ai/api/v1/models';

// --- trimmed REAL sample payload -------------------------------------------
const SAMPLE = {
  data: [
    {
      id: 'google/gemini-4-neon',
      canonical_slug: 'google/gemini-4-neon-20261118',
      hugging_face_id: null,
      name: 'Google: Gemini 4 Neon',
      created: 1795006977,
      description: 'Gemini 4 Neon is a fast, mid-priced model in the Gemini 4 family from Google, built for coding and agentic work.',
      context_length: 1048576,
      architecture: {
        modality: 'text+image+file+audio+video->text',
        input_modalities: ['audio', 'file', 'image', 'text', 'video'],
        output_modalities: ['text'],
        tokenizer: 'Gemini',
        instruct_type: null,
      },
      pricing: {
        prompt: '0.000003',
        completion: '0.000015',
        image: '0.000003',
        audio: '0.000003',
        input_audio_cache: '0.00000015',
        web_search: '0.014',
        internal_reasoning: '0.000015',
        input_cache_read: '0.00000015',
        input_cache_write: '0.0000000833333333333333',
      },
      top_provider: { context_length: 1048576, max_completion_tokens: 943718, is_moderated: false },
      per_request_limits: null,
    },
    {
      id: 'inclusionai/ling-3.2-flash:free',
      canonical_slug: 'inclusionai/ling-3.2-flash-20261113',
      hugging_face_id: 'inclusionAI/Ling-3.2-flash',
      name: 'inclusionAI: Ling 3.2 Flash (free)',
      created: 1794591958,
      description: 'Ling 3.2 Flash is a hybrid reasoning model from inclusionAI that accepts text and image input, with a 1M-token context window and up to 200 images per request.',
      context_length: 1048576,
      architecture: {
        modality: 'text+image->text',
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        tokenizer: 'Other',
        instruct_type: null,
      },
      pricing: { prompt: '0', completion: '0' },
      top_provider: { context_length: 1048576, max_completion_tokens: 262144, is_moderated: false },
      per_request_limits: null,
    },
    {
      // Real sentinel case: openrouter/auto publishes "-1" (variable pricing).
      id: 'openrouter/auto',
      canonical_slug: 'openrouter/auto',
      hugging_face_id: null,
      name: 'Auto Router',
      created: 1793885889,
      description: 'Auto is OpenRouter’s flagship model router, built for general-purpose usage.',
      context_length: 2000000,
      architecture: { modality: 'text+image+file+audio+video->text+image', input_modalities: ['text', 'image', 'audio', 'file', 'video'], output_modalities: ['text', 'image'], tokenizer: 'Router', instruct_type: null },
      pricing: { prompt: '-1', completion: '-1' },
      top_provider: { context_length: null, max_completion_tokens: null, is_moderated: false },
      per_request_limits: null,
    },
  ],
  total_count: 3,
  links: {},
};

// --- helpers -----------------------------------------------------------------

function res(body, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => body };
}
const jsonRes = (obj, opts) => res(JSON.stringify(obj), opts);
const opts = (extra = {}) => ({
  now: () => NOW,
  circuitBreaker: createCircuitBreaker(), // fresh per test: no cross-test state
  rateLimitMs: 0,
  ...extra,
});
const models = (r) => r.records.filter((x) => x.kind === 'model');
const pricing = (r) => r.records.filter((x) => x.kind === 'pricing');

// --- source metadata -----------------------------------------------------------

test('source metadata is complete and honest', () => {
  assert.equal(source.id, 'openrouter');
  assert.equal(source.parser_version, '1.0.0');
  assert.deepEqual(source.datasets, ['models', 'pricing']);
  assert.equal(source.url, ENDPOINT);
  assert.ok(Array.isArray(source.limitations) && source.limitations.length > 0);
  assert.ok(source.attribution.length > 0);
});

// --- successful normalization -----------------------------------------------------

test('normalizes real sample: exact model fields', async () => {
  const fetchImpl = async () => jsonRes(SAMPLE);
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.rawCount, 3);
  assert.equal(r.sourceId, 'openrouter');
  assert.equal(r.retrievedAt, NOW);

  const ms = models(r);
  assert.equal(ms.length, 3);
  const gemini = ms.find((m) => m.external_id === 'google/gemini-4-neon');
  assert.deepEqual(gemini, {
    kind: 'model',
    external_id: 'google/gemini-4-neon',
    slug: 'google/gemini-4-neon',
    provider_slug: 'google',
    provider_name: 'Google',
    name: 'Google: Gemini 4 Neon',
    family: null,
    release_date: '2026-11-18T13:02:57.000Z', // created 1795006977 unix seconds
    context_window: 1048576,
    input_modalities: ['audio', 'file', 'image', 'text', 'video'],
    output_modalities: ['text'],
    description: SAMPLE.data[0].description,
    evidence_class: 'reported',
    source_id: 'openrouter',
    source_url: ENDPOINT,
    retrieved_at: NOW,
  });
});

test('price conversion math: per-token strings -> USD per million, originals kept', async () => {
  const fetchImpl = async () => jsonRes(SAMPLE);
  const r = await retrieve({ fetchImpl, ...opts() });
  const ps = pricing(r);
  // gemini: input/output/cached_input; free: input/output at 0; auto: none (-1 sentinel)
  assert.equal(ps.length, 5);

  const input = ps.find((p) => p.external_id === 'google/gemini-4-neon' && p.category === 'input');
  assert.equal(input.price, 3); // 0.000003 * 1e6
  assert.equal(input.price_original, 0.000003);
  assert.equal(input.unit_original, 'per_token');
  assert.equal(input.unit, 'per_million_tokens');
  assert.equal(input.currency, 'USD');
  assert.equal(input.model_slug, 'google/gemini-4-neon');
  assert.equal(input.provider_slug, 'google');
  assert.equal(input.effective_date, null);
  assert.equal(input.conditions, null);
  assert.equal(input.evidence_class, 'reported');
  assert.equal(input.source_id, 'openrouter');
  assert.equal(input.source_url, ENDPOINT);
  assert.equal(input.retrieved_at, NOW);

  const output = ps.find((p) => p.external_id === 'google/gemini-4-neon' && p.category === 'output');
  assert.equal(output.price, 15); // 0.000015 * 1e6
  assert.equal(output.price_original, 0.000015);

  const cached = ps.find((p) => p.external_id === 'google/gemini-4-neon' && p.category === 'cached_input');
  assert.equal(cached.price, 0.15); // 0.00000015 * 1e6, float noise removed
  assert.equal(cached.price_original, 0.00000015);
  assert.equal(cached.conditions, 'cached input (cache read)');

  // Non-schema pricing fields (image/audio/web_search/cache_write) are skipped.
  assert.equal(ps.some((p) => p.category === 'batch_input'), false);

  // Free model: zero prices are legitimate and kept.
  const freeInput = ps.find((p) => p.external_id === 'inclusionai/ling-3.2-flash:free' && p.category === 'input');
  assert.equal(freeInput.price, 0);
  assert.equal(freeInput.price_original, 0);

  // Variable-pricing sentinel "-1" produces no pricing records.
  assert.equal(ps.some((p) => p.external_id === 'openrouter/auto'), false);
});

test('dedupes repeated model ids (models and pricing)', async () => {
  const dup = { ...SAMPLE, data: [...SAMPLE.data, SAMPLE.data[0]] };
  const fetchImpl = async () => jsonRes(dup);
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.equal(r.rawCount, 4);
  assert.equal(models(r).length, 3);
  assert.equal(pricing(r).length, 5);
});

test('limit slices raw items client-side; rawCount reflects full payload', async () => {
  const fetchImpl = async () => jsonRes(SAMPLE);
  const r = await retrieve({ fetchImpl, limit: 1, ...opts() });
  assert.equal(r.rawCount, 3);
  assert.equal(models(r).length, 1);
  assert.equal(models(r)[0].external_id, 'google/gemini-4-neon');
  assert.equal(pricing(r).length, 3);
});

test('provenance fields present on every record', async () => {
  const fetchImpl = async () => jsonRes(SAMPLE);
  const r = await retrieve({ fetchImpl, ...opts() });
  for (const rec of r.records) {
    assert.equal(rec.source_id, 'openrouter');
    assert.equal(rec.source_url, ENDPOINT);
    assert.equal(rec.retrieved_at, NOW);
    assert.equal(rec.evidence_class, 'reported');
  }
});

// --- malformed / empty / failing ---------------------------------------------------

test('malformed JSON body -> structured error, no throw', async () => {
  const fetchImpl = async () => res('<html>gateway error</html>');
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.rawCount, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /malformed/);
});

test('wrong JSON shape -> structured error', async () => {
  const fetchImpl = async () => jsonRes({ models: [] });
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.errors.length, 1);
});

test('empty catalog is valid: zero records, zero errors', async () => {
  const fetchImpl = async () => jsonRes({ data: [], total_count: 0 });
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.rawCount, 0);
  assert.deepEqual(r.errors, []);
});

test('item missing id/name is skipped with an error entry', async () => {
  const fetchImpl = async () => jsonRes({ data: [{ name: 'no id' }, null, SAMPLE.data[0]] });
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.equal(r.rawCount, 3);
  assert.equal(models(r).length, 1);
  assert.equal(r.errors.length, 2);
});

test('missing created/context/architecture normalize to null/[]', async () => {
  const fetchImpl = async () => jsonRes({ data: [{ id: 'x/y', name: 'X: Y' }] });
  const r = await retrieve({ fetchImpl, ...opts() });
  const m = models(r)[0];
  assert.equal(m.release_date, null);
  assert.equal(m.context_window, null);
  assert.deepEqual(m.input_modalities, []);
  assert.deepEqual(m.output_modalities, []);
  assert.equal(m.description, null);
  assert.equal(pricing(r).length, 0);
});

test('failing source (network error) returns structured errors, never throws', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.rawCount, 0);
  assert.equal(r.sourceId, 'openrouter');
  assert.equal(r.retrievedAt, NOW);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /fetch failed: network_error/);
});

test('HTTP 429 with Retry-After then success still normalizes', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n === 1
      ? res('rate limited', { status: 429, headers: { 'retry-after': '0' } })
      : jsonRes(SAMPLE);
  };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.errors, []);
  assert.equal(models(r).length, 3);
  assert.equal(n, 2);
});

test('HTTP 500 exhausted -> structured failure with status', async () => {
  const fetchImpl = async () => res('down', { status: 500 });
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.errors[0].status, 500);
  assert.match(r.errors[0].message, /http_500/);
});
