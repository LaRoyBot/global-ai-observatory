# Repository audit — Global AI Observatory

Audited: 2026-11-19, before platform expansion. Baseline preserved in git commit
`Baseline: existing single-file AI Token Flows globe (preserved before platform expansion)`.

## 1. Existing architecture (as found)

The repository contained **no framework, no package manifest, no backend, no database,
no tests and no git history**. It was a single deliverable:

| Path | Size | Role |
|---|---|---|
| `index.html` | ~131 KB / 2,329 lines | Complete single-file application: HTML + CSS + vanilla JS + embedded synthetic dataset |
| `_atlas_probe.json` | 107 KB | Cached Natural Earth 1:110m TopoJSON (world-atlas 2.0.2) |
| `_check.js` | 94 KB | Scratch extraction of the inline script used for `node --check` |

Runtime dependencies were **CDN-only**: D3 7.9.0, topojson-client 3.1.0, world-atlas 2.0.2.
No build step, no bundler, no server. The file opened directly via `file://`.

### Internal structure of `index.html`

22 numbered sections: configuration → embedded `FLOWS` fixture → `COUNTRY_COORDS` /
`ISO_NUMERIC` / Singapore 1:50m supplement → dataset validation → aggregation layer (`Agg`)
→ particle allocation → geographic math (`Geo`) and route construction (`ROUTES`) →
two-layer canvas rendering → particle pool and frame loop → formatting → hit testing →
tooltips → selection/spotlight → pointer & keyboard interaction → UI updates → time
explorer → guided stories → asset loading/failure handling → development validation →
UI wiring → test API → boot.

## 2. Existing globe capabilities (verified in a real browser)

| Capability | State at audit |
|---|---|
| Orthographic Earth with Natural Earth country boundaries | Working (D3 + topojson, cached base layer) |
| Drag rotation (mouse + touch), keyboard rotation | Working |
| True backside occlusion (great-circle sampling + limb bisection) | Working; antipode visibility asserted false |
| Reusable particle pool, ≤150 cap, square-root volume allocation | Working; 150 active particles asserted |
| Input (cyan, consumer→server) / output (amber, server→consumer) directions | Working |
| Timeline, prev/next, slider, playback speed, loop | Working after defect fix (see §4) |
| Country selection, spotlight, country intelligence, partner rankings | Working |
| Route inspector and tooltips with exact-value titles | Working |
| Destination/serving rankings reconciling to period totals | Working |
| Numeric self-validation (132 checks across 6 periods) | Passing |
| Reduced-motion handling, low-power mode, hidden-tab suspension | Implemented; hidden-tab suspension observed |
| CDN failure fallback (native-Canvas sphere + graticule + markers) | Working |
| Always-visible synthetic-data disclaimer | Working |

## 3. Test baseline (actually executed)

Executed in a real browser via `file://` before expansion:

- **Passed:** boot and asset load (d3/topojson/atlas all true); 132-check numeric validation;
  headline stats (4.85T total / 2.69T input / 2.15T output / 30 routes / 13 countries for 2026-06);
  prev/next/slider period changes with recomputed totals; serving vs consuming ranking switch
  (USA 1.74T / IRL 521.0B / SGP 419.0B for 2026-01 serving); India selection with correct
  directional metrics (serving 97.0B, consumption 1.399T in 2026-06); partner-mode switch;
  guided story activation; drag rotation with correct hemisphere visibility; particle cap;
  playback advancing periods after the fix; cross-fade payload shape.
- **Failed then fixed:** animation loop halted with `TypeError: Cannot read properties of
  undefined (reading 'keys')` in `drawRoutes` — `setPeriod` assigned `state.fade = 1` while the
  renderer expected `{ prev: Map, t0 }`. Fixed by capturing previous route volumes and assigning
  the correct payload (plus a defensive guard). Re-tested: frames advance, periods advance, no errors.
- **Also fixed:** the application never loaded D3/topojson at all (no script tags existed despite
  the developer guide claiming CDN loading) — it silently always ran in fallback mode. A dynamic
  loader with pinned versions, mirrors, timeouts and `?fail=` flags was added and verified.
- **Not executed at audit:** reduced-motion emulation, `?fail=` fallback paths, mobile/tablet
  touch testing, formal performance measurement on an older ThinkPad.

## 4. Preservation decisions

| Existing functionality | Decision |
|---|---|
| Working globe rendering | **Preserve** — extracted verbatim into `src/geography/globe.js` |
| Orthographic projection math, slerp, limb bisection clipping | **Preserve** unchanged |
| Reusable particle engine + allocation | **Preserve** unchanged |
| Synthetic `FLOWS` fixture (165 records, 6 periods, 13 countries) | **Retain** as `data/synthetic/flows.json`, ingested into SQLite with `evidence_class='synthetic'` |
| `COUNTRY_COORDS`, `ISO_NUMERIC`, Singapore supplement | **Preserve** in `src/geography/country-reference.js` |
| Aggregation layer (`Agg`) | **Preserve** in the engine; mirrored server-side in `server/services.js` for API responses |
| Timeline / playback / selection / tooltips / hit testing | **Preserve** in the engine; UI re-expressed through the shared component library |
| Existing styling | **Adapted** into one global token system (`src/styles/tokens.css`) |
| Global-id UI coupling (`el("stat-total")`, `refreshUI`, …) | **Refactored** to an event bus + injected data; this was the only boundary that prevented reuse across six workspaces |
| `index.html` | **Preserved untouched** at the repository root, served at `/legacy` |
| `_atlas_probe.json` | **Promoted** to `data/reference/countries-110m.json` (served locally; CDN remains a fallback) |
| `_check.js` | Scratch artefact, gitignored |

## 5. Required refactors (completed)

1. Extract the engine from global-id coupling into `createGlobe(container, opts)` with injected
   data, scoped DOM, and an event bus (`change`, `ready`, `error`, `notice`, `validation`,
   `select-marker`, `dismiss-story`).
2. Vendor D3/topojson locally (`public/vendor/`) with pinned CDN mirrors as fallback, so the
   platform does not depend on CDN availability at runtime.
3. Move the synthetic fixture out of inline JS into a versioned, classified JSON fixture.
4. Introduce a real relational store (`node:sqlite`, zero dependencies) with migrations,
   repositories and provenance columns, replacing "everything in one JS array".
5. Add an HTTP server with a typed JSON API and SPA deep-link fallback.

## 6. Dependencies and technical constraints

- **Zero npm dependencies.** Node ≥ 22.5 built-ins only (`node:http`, `node:sqlite`, `node:test`,
  `node:fs`). Verified on Node v24.18.0.
- No WebGL, no Three.js, no React/Vue/Angular, no bundler. Canvas 2D + D3 geo only.
- Older Windows ThinkPad is a supported target: capped DPR, cached base layer, ≤150 particles,
  hidden-tab suspension, lazy workspace modules, low-power mode.
- No credentials are assumed. Optional tokens are read server-side only and never bundled.

## 7. Deployment implications

The previous artefact was a static file. The platform now requires a Node process
(`npm start`) because it has a real API and database. Static hosting alone is insufficient.
`server/index.js` serves the shell, modules, vendor assets, reference data and `/api/v1/*`,
and resolves deep links to the shell. No production deployment was performed or authorised.

## 8. Risks

- **Coverage risk:** several workspaces depend on public sources whose geographic granularity is
  limited (e.g. adoption surveys). These are surfaced as explicit coverage gaps, never zeros.
- **Source drift:** public endpoints change shape; adapters carry parser versions and record
  failures per source so one outage cannot blank unrelated datasets.
- **Single-file legacy divergence:** `/legacy` is a frozen snapshot; it will not receive platform
  features. This is intentional and documented.
- **Hardware validation:** performance was measured in the available test environment, not on a
  physical older ThinkPad. That limitation is reported rather than assumed away.
