// tests/adapters/huggingface.test.js
// Hugging Face adapter tests. No network: fetchImpl injected.
// SAMPLE below is trimmed from the real live response of
// GET https://huggingface.co/api/models?sort=downloads&direction=-1&limit=3&full=true
// captured on 2026-11-19 (scalar fields verbatim; tags/siblings lists shortened).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { source, retrieve, buildQueryUrl } from '../../server/adapters/huggingface.js';
import { createCircuitBreaker } from '../../server/adapters/http.js';

const NOW = '2026-11-19T00:00:00.000Z';

// --- trimmed REAL sample payload -------------------------------------------
const SAMPLE = [
  {
    _id: '621ffdc136468d709f180294',
    id: 'sentence-transformers/all-MiniLM-L6-v2',
    author: 'sentence-transformers',
    gated: false,
    lastModified: '2026-06-01T06:29:13.000Z',
    likes: 6148,
    private: false,
    sha: '1110a243fdf4706b3f48f1d95db1a4f5529b4d41',
    downloads: 167728168,
    tags: ['sentence-transformers', 'pytorch', 'bert', 'feature-extraction', 'sentence-similarity', 'en', 'license:apache-2.0', 'region:us'],
    pipeline_tag: 'sentence-similarity',
    library_name: 'sentence-transformers',
    createdAt: '2022-03-02T23:29:05.000Z',
    modelId: 'sentence-transformers/all-MiniLM-L6-v2',
    siblings: [{ rfilename: 'config.json' }, { rfilename: 'model.safetensors' }],
  },
  {
    _id: '65dee9413aec0530562b4f09',
    id: 'argmaxinc/whisperkit-coreml',
    author: 'argmaxinc',
    gated: false,
    lastModified: '2026-08-19T16:57:48.000Z',
    likes: 275,
    private: false,
    sha: '0f63a7800b00dd0226abd051b906c246e1907482',
    downloads: 84267005,
    tags: ['whisperkit', 'coreml', 'whisper', 'asr', 'quantized', 'automatic-speech-recognition', 'license:mit', 'region:us'],
    pipeline_tag: 'automatic-speech-recognition',
    library_name: 'whisperkit',
    createdAt: '2024-02-28T08:05:21.000Z',
    modelId: 'argmaxinc/whisperkit-coreml',
    siblings: [{ rfilename: '.gitattributes' }, { rfilename: '.gitignore' }],
  },
  {
    _id: '621ffdc136468d709f17a20e',
    id: 'cross-encoder/ms-marco-MiniLM-L6-v2',
    author: 'cross-encoder',
    gated: false,
    lastModified: '2026-08-09T15:22:24.000Z',
    likes: 452,
    private: false,
    sha: '233902d25c440f23af6f7d6e94d2946bac0bee0a',
    downloads: 56284496,
    tags: ['sentence-transformers', 'pytorch', 'jax', 'onnx', 'safetensors', 'openvino', 'bert', 'text-classification', 'transformers', 'text-ranking'],
    pipeline_tag: 'text-ranking',
    library_name: 'sentence-transformers',
    createdAt: '2022-03-02T23:29:05.000Z',
    modelId: 'cross-encoder/ms-marco-MiniLM-L6-v2',
    siblings: [{ rfilename: '.gitattributes' }, { rfilename: 'README.md' }],
  },
];

// --- helpers -----------------------------------------------------------------

function res(body, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => body };
}
const jsonRes = (obj, opts) => res(JSON.stringify(obj), opts);
const opts = (extra = {}) => ({
  now: () => NOW,
  circuitBreaker: createCircuitBreaker(),
  rateLimitMs: 0,
  ...extra,
});

// --- source metadata & URL ------------------------------------------------------

test('source metadata is complete', () => {
  assert.equal(source.id, 'huggingface');
  assert.equal(source.parser_version, '1.0.0');
  assert.deepEqual(source.datasets, ['models']);
  assert.equal(source.url, 'https://huggingface.co/api/models');
  assert.ok(source.limitations.length > 0);
});

test('buildQueryUrl sorts by downloads desc with full=true', () => {
  const url = buildQueryUrl();
  assert.ok(url.includes('sort=downloads'));
  assert.ok(url.includes('direction=-1'));
  assert.ok(url.includes('limit=50'));
  assert.ok(url.includes('full=true'));
  assert.ok(buildQueryUrl(10).includes('limit=10'));
});

// --- successful normalization ------------------------------------------------------

test('normalizes real sample: exact model fields, no fabricated dates/contexts', async () => {
  let seenUrl = null;
  const fetchImpl = async (url) => { seenUrl = url; return jsonRes(SAMPLE); };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.ok(seenUrl.includes('sort=downloads'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.rawCount, 3);
  assert.equal(r.sourceId, 'huggingface');
  assert.equal(r.retrievedAt, NOW);
  assert.equal(r.records.length, 3);

  const m = r.records[0];
  assert.deepEqual(m, {
    kind: 'model',
    external_id: 'sentence-transformers/all-MiniLM-L6-v2',
    slug: 'sentence-transformers/all-MiniLM-L6-v2',
    provider_slug: 'sentence-transformers',
    provider_name: 'sentence-transformers',
    name: 'all-MiniLM-L6-v2',
    family: null,
    release_date: '2022-03-02T23:29:05.000Z', // createdAt, verbatim from API
    context_window: null, // NOT exposed by the list API -> null, never invented
    input_modalities: ['text'],
    output_modalities: ['text'],
    description: null, // not exposed by the list API
    evidence_class: 'reported',
    source_id: 'huggingface',
    source_url: 'https://huggingface.co/api/models?sort=downloads&direction=-1&full=true',
    retrieved_at: NOW,
  });
});

test('pipeline_tag modality mapping: ASR -> audio in / text out', async () => {
  const fetchImpl = async () => jsonRes(SAMPLE);
  const r = await retrieve({ fetchImpl, ...opts() });
  const asr = r.records.find((m) => m.external_id === 'argmaxinc/whisperkit-coreml');
  assert.deepEqual(asr.input_modalities, ['audio']);
  assert.deepEqual(asr.output_modalities, ['text']);
  assert.equal(asr.release_date, '2024-02-28T08:05:21.000Z');
  const rank = r.records.find((m) => m.external_id === 'cross-encoder/ms-marco-MiniLM-L6-v2');
  assert.deepEqual(rank.input_modalities, ['text']);
  assert.deepEqual(rank.output_modalities, ['text']);
});

test('unknown or absent pipeline_tag yields empty modality arrays', async () => {
  const fetchImpl = async () => jsonRes([
    { id: 'org/unknown-pipeline', pipeline_tag: 'some-future-task', createdAt: '2025-01-01T00:00:00.000Z' },
    { id: 'org/no-pipeline' },
  ]);
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.errors, []);
  for (const m of r.records) {
    assert.deepEqual(m.input_modalities, []);
    assert.deepEqual(m.output_modalities, []);
  }
  assert.equal(r.records[1].release_date, null); // absent createdAt -> null
});

test('dedupes repeated model ids', async () => {
  const fetchImpl = async () => jsonRes([...SAMPLE, SAMPLE[0]]);
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.equal(r.rawCount, 4);
  assert.equal(r.records.length, 3);
});

test('limit is passed through to the API URL', async () => {
  let seenUrl = null;
  const fetchImpl = async (url) => { seenUrl = url; return jsonRes(SAMPLE); };
  await retrieve({ fetchImpl, limit: 3, ...opts() });
  assert.ok(seenUrl.includes('limit=3'));
});

test('provenance fields present on every record', async () => {
  const fetchImpl = async () => jsonRes(SAMPLE);
  const r = await retrieve({ fetchImpl, ...opts() });
  for (const rec of r.records) {
    assert.equal(rec.source_id, 'huggingface');
    assert.ok(rec.source_url.startsWith('https://huggingface.co/api/models'));
    assert.equal(rec.retrieved_at, NOW);
    assert.equal(rec.evidence_class, 'reported');
  }
});

// --- malformed / empty / failing ------------------------------------------------------

test('malformed JSON body -> structured error, no throw', async () => {
  const fetchImpl = async () => res('<html>error</html>');
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.rawCount, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /malformed/);
});

test('non-array JSON -> structured error', async () => {
  const fetchImpl = async () => jsonRes({ error: 'rate limited' });
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.errors.length, 1);
});

test('empty array is valid: zero records, zero errors', async () => {
  const fetchImpl = async () => jsonRes([]);
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.rawCount, 0);
  assert.deepEqual(r.errors, []);
});

test('items missing id or marked private are skipped with errors', async () => {
  const fetchImpl = async () => jsonRes([{ likes: 1 }, null, { id: 'org/secret', private: true }, SAMPLE[0]]);
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.equal(r.rawCount, 4);
  assert.equal(r.records.length, 1);
  assert.equal(r.errors.length, 3);
});

test('failing source returns structured errors rather than throwing', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND'); };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.sourceId, 'huggingface');
  assert.equal(r.retrievedAt, NOW);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /fetch failed: network_error/);
});

test('HTTP 500 retry then success still normalizes', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n === 1 ? res('oops', { status: 500 }) : jsonRes(SAMPLE);
  };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.records.length, 3);
  assert.equal(n, 2);
});

test('HTTP 429 exhausted -> structured failure with status', async () => {
  const fetchImpl = async () => res('slow down', { status: 429, headers: { 'retry-after': '0' } });
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.errors[0].status, 429);
  assert.match(r.errors[0].message, /http_429/);
});
