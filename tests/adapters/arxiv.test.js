// tests/adapters/arxiv.test.js
// arXiv adapter tests. No network: fetchImpl injected.
// REAL_XML below is trimmed from the live Atom response of
// https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL
//   &sortBy=submittedDate&sortOrder=descending
// captured on 2026-11-19 (entry text verbatim; long abstracts shortened;
// feed-level metadata trimmed). The v2 entry mirrors arXiv's real revision
// behaviour (same paper id, later <updated>), and the last two entries are
// synthetic edge cases for entity decoding / missing required fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { source, retrieve, buildQueryUrl } from '../../server/adapters/arxiv.js';
import { createCircuitBreaker } from '../../server/adapters/http.js';

const NOW = '2026-11-19T00:00:00.000Z';

const ENTRY_1 = `
  <entry>
    <id>http://arxiv.org/abs/2611.24936v1</id>
    <title>Jailbreak Detection on Large Language Models via Contrastive Prototype Structures</title>
    <updated>2026-11-18T18:56:12Z</updated>
    <link href="https://arxiv.org/abs/2611.24936v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2611.24936v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>Jailbreak attempts and harmful prompts remain a challenge for the safe deployment of large language models. We study whether contrastively learned representations can support safety detection without training an additional downstream classifier. We propose Jailbreak Detection with Prototype Inference (JDPI), which uses binary safety labels to construct harmful and benign prototypes and makes predictions from relative prototype distances. JDPI uses only binary safety labels for encoder adaptation, prototype construction, and validation. In our setup, it uses fewer labeled examples than the classifier baseline (Method A) by avoiding the separate split used to train the downstream classifier. Across four benchmarks covering different input formats, contrastive fine-tuning improves JDPI's detection accuracy by 9.1-18.0 percentage points.</summary>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-11-18T18:56:12Z</published>
    <arxiv:primary_category term="cs.CL"/>
    <author>
      <name>Yan Qiu</name>
    </author>
    <author>
      <name>Yuanyuan Li</name>
    </author>
  </entry>`;

const ENTRY_2 = `
  <entry>
    <id>http://arxiv.org/abs/2611.24932v1</id>
    <title>Knowing What You Know: A Trait Theory of Reviewer Value in Human-AI Cognitive Systems</title>
    <updated>2026-11-18T18:55:07Z</updated>
    <link href="https://arxiv.org/abs/2611.24932v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2611.24932v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>When a capable model and a human reviewer cooperate on the same decision, which human still adds value? We argue this is a question about a single cognitive trait, metacognitive calibration: the alignment between a reviewer's behavioral confidence and the actual correctness of their judgments.</summary>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-11-18T18:55:07Z</published>
    <arxiv:comment>Accepted at the Thirteenth Annual Conference on Advances in Cognitive Systems (ACS)</arxiv:comment>
    <arxiv:primary_category term="cs.AI"/>
    <author>
      <name>Priyanka Sinha</name>
    </author>
    <author>
      <name>Sugam Pandey</name>
    </author>
  </entry>`;

// Revision of entry 1: same paper, v2, <updated> later than <published>.
const ENTRY_1_V2 = ENTRY_1
  .replace('2611.24936v1', '2611.24936v2')
  .replace('<updated>2026-11-18T18:56:12Z</updated>', '<updated>2026-11-19T10:00:00Z</updated>');

// Synthetic edge cases: XML entities in title/summary; missing <published>.
const ENTRY_ENTITIES = `
  <entry>
    <id>http://arxiv.org/abs/2611.00001v1</id>
    <title>Attention &amp; Alignment: &lt;Benchmarks&gt; for &quot;Safe&quot; Agents &#38; Humans</title>
    <updated>2026-11-17T00:00:00Z</updated>
    <link href="https://arxiv.org/abs/2611.00001v1" rel="alternate" type="text/html"/>
    <summary>We study A &amp; B with &#60;tags&#62; and &apos;quotes&apos;.</summary>
    <published>2026-11-17T00:00:00Z</published>
    <author><name>Ada Lovelace</name></author>
  </entry>`;

const ENTRY_NO_PUBLISHED = `
  <entry>
    <id>http://arxiv.org/abs/2611.00002v1</id>
    <title>Entry Without A Published Timestamp</title>
    <updated>2026-11-17T00:00:00Z</updated>
    <summary>Missing required published field.</summary>
  </entry>`;

const feed = (entries) => `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/test</id>
  <title>arXiv Query: search_query=cat:cs.AI OR cat:cs.LG OR cat:cs.CL&amp;id_list=&amp;start=0&amp;max_results=50</title>
  <updated>2026-11-19T18:45:38Z</updated>
  <opensearch:itemsPerPage>50</opensearch:itemsPerPage>
  <opensearch:totalResults>490669</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>${entries}
</feed>`;

const REAL_XML = feed(ENTRY_1 + ENTRY_2);

// --- helpers -----------------------------------------------------------------

function res(body, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => body };
}
const opts = (extra = {}) => ({
  now: () => NOW,
  circuitBreaker: createCircuitBreaker(),
  rateLimitMs: 0,
  ...extra,
});

// --- source metadata & URL ------------------------------------------------------

test('source metadata is complete; uses https endpoint', () => {
  assert.equal(source.id, 'arxiv');
  assert.equal(source.parser_version, '1.0.0');
  assert.deepEqual(source.datasets, ['research']);
  assert.ok(source.url.startsWith('https://export.arxiv.org/api/query'));
  assert.ok(source.limitations.length > 0);
});

test('buildQueryUrl uses required categories, sort and max_results', () => {
  const url = buildQueryUrl();
  assert.ok(url.includes('search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL'));
  assert.ok(url.includes('sortBy=submittedDate'));
  assert.ok(url.includes('sortOrder=descending'));
  assert.ok(url.includes('max_results=50'));
  assert.ok(buildQueryUrl(7).includes('max_results=7'));
});

// --- successful normalization ------------------------------------------------------

test('parses real captured XML into exact normalized research records', async () => {
  const fetchImpl = async (url) => {
    assert.ok(url.startsWith('https://export.arxiv.org/api/query?'));
    return res(REAL_XML);
  };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.rawCount, 2);
  assert.equal(r.sourceId, 'arxiv');
  assert.equal(r.retrievedAt, NOW);
  assert.equal(r.records.length, 2);

  const p1 = r.records[0];
  assert.equal(p1.kind, 'research');
  assert.equal(p1.external_id, '2611.24936v1');
  assert.equal(p1.headline, 'Jailbreak Detection on Large Language Models via Contrastive Prototype Structures');
  assert.equal(p1.category, 'research_paper');
  assert.deepEqual(p1.authors, ['Yan Qiu', 'Yuanyuan Li']);
  assert.equal(p1.published_at, '2026-11-18T18:56:12.000Z');
  assert.equal(p1.event_at, null); // updated == published -> no revision event
  assert.equal(p1.source_url, 'https://arxiv.org/abs/2611.24936v1');
  assert.equal(p1.provider_slug, null);
  assert.equal(p1.country_iso3, null);
  assert.equal(p1.evidence_class, 'reported');
  assert.equal(p1.source_id, 'arxiv');
  assert.equal(p1.retrieved_at, NOW);

  // Summary is source-grounded: a truncation of the real abstract, <=400 chars.
  assert.ok(p1.summary.length <= 400, `summary length ${p1.summary.length}`);
  assert.ok(p1.summary.startsWith('Jailbreak attempts and harmful prompts remain a challenge'));
  assert.ok(p1.summary.endsWith('…')); // long abstract was cut at a word boundary
  assert.ok(!p1.summary.includes('  ')); // whitespace collapsed

  const p2 = r.records[1];
  assert.equal(p2.external_id, '2611.24932v1');
  assert.deepEqual(p2.authors, ['Priyanka Sinha', 'Sugam Pandey']);
  assert.equal(p2.published_at, '2026-11-18T18:55:07.000Z');
  assert.ok(p2.summary.length <= 400);
  assert.ok(p2.summary.startsWith('When a capable model and a human reviewer cooperate'));
});

test('short abstracts are kept verbatim (no ellipsis)', async () => {
  const fetchImpl = async () => res(feed(ENTRY_2));
  const r = await retrieve({ fetchImpl, ...opts() });
  const p = r.records[0];
  assert.ok(!p.summary.endsWith('…'));
  assert.ok(p.summary.includes('metacognitive calibration'));
});

test('revision entry: event_at carries <updated> when it differs from <published>', async () => {
  const fetchImpl = async () => res(feed(ENTRY_1_V2));
  const r = await retrieve({ fetchImpl, ...opts() });
  const p = r.records[0];
  assert.equal(p.external_id, '2611.24936v2');
  assert.equal(p.published_at, '2026-11-18T18:56:12.000Z'); // v1 publication kept
  assert.equal(p.event_at, '2026-11-19T10:00:00.000Z');
});

test('XML entities are decoded in titles and summaries', async () => {
  const fetchImpl = async () => res(feed(ENTRY_ENTITIES));
  const r = await retrieve({ fetchImpl, ...opts() });
  const p = r.records[0];
  assert.equal(p.headline, 'Attention & Alignment: <Benchmarks> for "Safe" Agents & Humans');
  assert.equal(p.summary, "We study A & B with <tags> and 'quotes'.");
});

test('dedupes repeated paper ids', async () => {
  const fetchImpl = async () => res(feed(ENTRY_1 + ENTRY_1 + ENTRY_2));
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.equal(r.rawCount, 3);
  assert.equal(r.records.length, 2);
});

test('limit is passed through as max_results', async () => {
  let seenUrl = null;
  const fetchImpl = async (url) => { seenUrl = url; return res(REAL_XML); };
  await retrieve({ fetchImpl, limit: 5, ...opts() });
  assert.ok(seenUrl.includes('max_results=5'));
});

// --- malformed / empty / failing ------------------------------------------------------

test('entry missing required fields is skipped with an error', async () => {
  const fetchImpl = async () => res(feed(ENTRY_NO_PUBLISHED + ENTRY_1));
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.equal(r.rawCount, 2);
  assert.equal(r.records.length, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /missing id, title or published/);
});

test('empty body -> structured error, no throw', async () => {
  const fetchImpl = async () => res('');
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /malformed/);
});

test('HTML error page instead of Atom feed -> structured error', async () => {
  const fetchImpl = async () => res('<html><body>503 Service Unavailable</body></html>', { status: 200 });
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.errors.length, 1);
});

test('valid feed with zero entries is not an error', async () => {
  const fetchImpl = async () => res(feed(''));
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.rawCount, 0);
  assert.deepEqual(r.errors, []);
});

test('failing source returns structured errors rather than throwing', async () => {
  const fetchImpl = async () => { throw new Error('socket hang up'); };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.records, []);
  assert.equal(r.sourceId, 'arxiv');
  assert.equal(r.retrievedAt, NOW);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /fetch failed: network_error/);
});

test('HTTP 429 with Retry-After then success still parses', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n === 1 ? res('', { status: 429, headers: { 'retry-after': '0' } }) : res(REAL_XML);
  };
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.records.length, 2);
});

test('provenance fields present on every record', async () => {
  const fetchImpl = async () => res(feed(ENTRY_1 + ENTRY_2 + ENTRY_1_V2));
  const r = await retrieve({ fetchImpl, ...opts() });
  assert.equal(r.records.length, 3);
  for (const rec of r.records) {
    assert.equal(rec.source_id, 'arxiv');
    assert.equal(rec.retrieved_at, NOW);
    assert.equal(rec.evidence_class, 'reported');
    assert.ok(rec.source_url.startsWith('https://arxiv.org/abs/'));
  }
});
