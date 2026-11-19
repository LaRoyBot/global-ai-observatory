// server/adapters/arxiv.js
// arXiv adapter: recent cs.AI / cs.LG / cs.CL submissions via the Atom API.
// Endpoint verified live 2026-11-19. NOTE: the plain-http URL
// (http://export.arxiv.org/api/query) returned an empty body in testing;
// https://export.arxiv.org/api/query works and is used here.
// Real response: Atom XML <feed> with <entry> blocks containing <id>
// (http://arxiv.org/abs/XXXX.XXXXXvN), <title>, <published>, <updated>,
// <summary>, <author><name>, <category term>, <arxiv:primary_category>.
//
// Parsing is regex-based (dependency-free) and tested against real captured
// XML embedded in tests/adapters/arxiv.test.js.
// Pure adapter: no storage, no file writes.

import { resilientFetch, createCircuitBreaker } from './http.js';

export const source = {
  id: 'arxiv',
  name: 'arXiv API (cs.AI / cs.LG / cs.CL)',
  owner: 'Cornell University (arXiv)',
  url: 'https://export.arxiv.org/api/query',
  access_method: 'public Atom XML API (no authentication)',
  datasets: ['research'],
  granularity: 'per paper (latest submissions, sorted by submittedDate desc)',
  update_frequency: 'daily announcement cycles ( Sun-Thu ); API reflects live index',
  license: 'arXiv metadata freely usable; papers under their own arXiv licenses',
  attribution: 'Data via arXiv API (https://arxiv.org/help/api), operated by Cornell University',
  rate_limit: 'arXiv asks for <=1 request per 3 seconds; client self-limits to 3000ms between requests',
  parser_version: '1.0.0',
  limitations: [
    'Regex-based Atom parsing handles the arXiv feed dialect, not arbitrary XML (no CDATA/nested-markup support beyond entity decoding).',
    'summary is the paper abstract truncated to <=400 characters at a word boundary; it is source-grounded, not generated.',
    'published_at is the v1 <published> timestamp; event_at carries <updated> only when it differs (i.e. a revision).',
    'provider_slug and country_iso3 are not reliably derivable from the feed and are left null.',
    'Only the newest max_results submissions are retrieved; no historical backfill.',
  ],
};

const DEFAULT_MAX_RESULTS = 50;
const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });

export function buildQueryUrl(limit) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_MAX_RESULTS;
  return 'https://export.arxiv.org/api/query'
    + '?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL'
    + '&sortBy=submittedDate&sortOrder=descending'
    + `&max_results=${max}`;
}

/** Decode the XML entities arXiv actually emits. */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // ampersand last so "&amp;lt;" decodes correctly
}

/** Collapse whitespace (arXiv wraps titles/abstracts across lines). */
function cleanText(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/** First match of <tag ...>content</tag> inside a block, decoded; null if absent. */
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? cleanText(m[1]) : null;
}

/** Truncate to <=400 chars at a word boundary, marking the cut with an ellipsis. */
function truncateSummary(text, max = 400) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1); // leave room for the ellipsis
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : cut.length).trimEnd()}…`;
}

/** "http://arxiv.org/abs/2611.24936v1" -> "2611.24936v1" */
function externalIdOf(absUrl) {
  const m = absUrl.match(/arxiv\.org\/abs\/(.+)$/);
  return m ? m[1] : absUrl;
}

function toIsoOrNull(s) {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Parse one <entry> block into a normalized research record (or null). */
export function parseEntry(block, retrievedAt, sourceUrl) {
  const idUrl = tagText(block, 'id');
  const title = tagText(block, 'title');
  const published = toIsoOrNull(tagText(block, 'published'));
  if (!idUrl || !title || !published) return null; // required fields missing

  const updated = toIsoOrNull(tagText(block, 'updated'));
  const summaryRaw = tagText(block, 'summary') || '';
  const authors = [...block.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
    .map((m) => cleanText(m[1]));

  // Prefer the rel="alternate" (abstract page) link; fall back to the id URL.
  const alt = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)
    || block.match(/<link[^>]*href="([^"]+)"[^>]*rel="alternate"/);
  const absUrl = alt ? decodeEntities(alt[1]) : idUrl;

  return {
    kind: 'research',
    external_id: externalIdOf(idUrl),
    headline: title,
    summary: truncateSummary(summaryRaw),
    category: 'research_paper',
    authors,
    published_at: published,
    // event_at marks a revision: only set when <updated> differs from <published>.
    event_at: updated && updated !== published ? updated : null,
    source_url: absUrl,
    provider_slug: null,
    country_iso3: null,
    evidence_class: 'reported',
    source_id: source.id,
    retrieved_at: retrievedAt,
  };
}

/** Parse the Atom feed into entries; returns [] when no <entry> blocks exist. */
export function parseFeed(xml) {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
}

/**
 * Retrieve recent arXiv submissions and normalize to research records.
 * Optional circuitBreaker/rateLimitMs overrides exist for test isolation.
 */
export async function retrieve({
  fetchImpl = fetch,
  signal,
  now = () => new Date().toISOString(),
  limit,
  circuitBreaker = breaker,
  rateLimitMs = 3000, // arXiv API guidance: 1 request / 3 seconds
} = {}) {
  const retrievedAt = now();
  const errors = [];
  const url = buildQueryUrl(limit);

  const res = await resilientFetch(url, {
    fetchImpl,
    signal,
    circuitBreaker,
    rateLimitMs,
    headers: { Accept: 'application/atom+xml' },
  });

  if (!res.ok) {
    errors.push({ message: `fetch failed: ${res.error}`, status: res.status, attempts: res.attempts });
    return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt };
  }

  const xml = res.body || '';
  if (!/<feed[\s>]/.test(xml)) {
    errors.push({ message: 'malformed response: expected an Atom <feed> document' });
    return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt };
  }

  const blocks = parseFeed(xml);
  const seen = new Map(); // dedupe by external_id (keep first occurrence)
  for (const block of blocks) {
    const rec = parseEntry(block, retrievedAt, url);
    if (!rec) {
      errors.push({ message: 'skipped entry: missing id, title or published timestamp' });
      continue;
    }
    if (!seen.has(rec.external_id)) seen.set(rec.external_id, rec);
  }

  return {
    records: [...seen.values()],
    rawCount: blocks.length,
    errors,
    sourceId: source.id,
    retrievedAt,
  };
}
