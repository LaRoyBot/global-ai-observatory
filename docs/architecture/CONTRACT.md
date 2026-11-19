# Workspace implementation contract

Every workspace is an ES module at `src/workspaces/<name>.js` exporting:

```js
export async function mount(ctx) {
  // render into document.getElementById("main")
  return { destroy() { /* remove listeners, destroy globe/map instances */ } };
}
```

`ctx` = `{ path, params, routeParams, meta, pattern }`.
- `params` — URL search params as a plain object (use for shareable filters).
- `routeParams` — path params, e.g. `{ iso: "IND" }`.
- The shell already sets the top-bar title and shows a loading block before `mount`.
- The shell calls `destroy()` on navigation. **Always** return a `destroy` that removes
  document-level listeners and destroys any globe/flat-map instance.

## Imports available (use these, do not reinvent)

```js
import * as ui from "../components/ui.js";        // panel, statRow, rankList, table, kv, tabs,
                                                  // evidenceBadge, freshnessBadge, availabilityBadge,
                                                  // statusBadge, provenance, emptyState, errorState,
                                                  // loadingBlock, note, barChart, lineChart, splitBar,
                                                  // sourceLink, workspaceHeader, h (escapeHtml), fmt*
import { apiGet, apiSend } from "../app/api.js";  // { ok, status, data, meta, error } — never throws
import * as router from "../app/router.js";       // navigate(path), setParams(params)
import { state, patch, selectCountry, subscribe, announce, savePrefs } from "../app/state.js";
import { createGlobe } from "../geography/globe.js";
import { createFlatMap } from "../geography/flatmap.js";
import { COUNTRY_COORDS } from "../geography/country-reference.js";
import { fmtCompact, fmtExact, fmtPct, fmtDate, fmtDateTime, periodLabel, periodShort, escapeHtml } from "../shared/formatting.js";
```

`apiGet` returns `{ ok:false, error }` on failure — render `ui.errorState(...)`, never a fake zero.
Results are cached (default 20 s); pass `{ ttlMs: 0 }` to force.

## API endpoints (all under `/api/v1`, envelope `{ data, meta }`)

- `/config` → `{ lowPowerDefault, credentialsConfigured:{...booleans}, ingestIntervalMinutes, version }`
- `/health` → `{ status, database, sources:[{id,status,freshness,last_success_at,failure_reason}], counts:{...} }`
- `/overview` → `{ coverage:{countries,providers,models,models_with_pricing,pricing_observations,infrastructure_sites,cloud_regions,adoption_observations,adoption_metrics,intelligence_signals,flow_records,flow_periods,data_sources}, flows:{evidence_class,disclaimer,latest_period,periods,totals,top_serving,top_consuming}, infrastructure:{by_country,regions_by_country,recent_sites,availability}, providers:{leading}, models:{recent}, economics:{highlights}, adoption:{observations,metrics}, intelligence:{latest}, sources:[...] }`
- `/flows?all=1` → all synthetic records + `periods`, `totals`, `routes`, `top_serving`, `top_consuming`, `convention`, `disclaimer`. Without `all=1`, returns one period (`?period=YYYY-MM`).
  Record shape: `{ period, origin, destination, inputTokens, outputTokens, evidence_class, attribution_basis, fixture_version }`.
- `/countries` → array of `{ iso3, iso2, numeric, name, region, subregion, lat, lon, capital, evidence_class }`
- `/countries/:iso` → `{ country, infrastructure:{sites,regions}, providers, models, flows:{latest_period,metrics:{serving,consuming},relationships,periods}, adoption, intelligence, sources }`
- `/providers`, `/providers/:slug` → `{ provider, models, pricing, regions, sites, intelligence, history }`
- `/models`, `/models/:slug` → `{ model, provider, pricing, history, intelligence }`
- `/infrastructure?country=&type=&provider=&q=&status=` → `{ sites, regions, by_country, regions_by_country, statuses, facility_types, distinctions }`
  Site: `{ id,name,operator,provider_slug,country_iso3,city,lat,lon,facility_type,status,capacity_note,accelerator_note,evidence_class,source_id,source_url,verified_at,notes }`
  Region: `{ id,provider_slug,provider_name,region_code,name,country_iso3,city,lat,lon,status,evidence_class,source_id,source_url,verified_at,notes }`
- `/economics?provider=&category=` → `{ unit, normalization, observations, catalogue:[{model_slug,provider_slug,categories:{input,output,...}}], coverage }`
  Pricing observation: `{ provider_slug,model_slug,category,price,currency,unit,price_original,unit_original,effective_date,retrieved_at,conditions,evidence_class,source_id,source_url }`. `price` is **USD per 1,000,000 tokens**.
- `/adoption?metric=&country=` → `{ metrics, observations, coverage:{countries_covered,countries_total,gaps}, warning }`
- `/intelligence?kind=&country=&provider=&q=&limit=&offset=` → `{ items, total, note }`
  Signal: `{ id,external_id,kind,headline,summary,category,authors,source_name,source_url,published_at,event_at,retrieved_at,provider_slug,model_slug,country_iso3,evidence_class,source_id }`
- `/sources` → `{ sources:[{...,datasets,limitations,runs,freshness,availability}] }`
- `/methodology`, `/methodology/:id` → `{ id,title,body_md,applies_to,updated_at }` (markdown text; render as pre-wrapped text or a minimal markdown conversion — do not inject raw HTML)
- `/comparisons?kind=countries|providers|models&ids=A,B` → `{ kind, items:[profiles], compatibility }`
- `/search?q=` → `{ query, groups:[{id,label,results:[{title,subtitle,href,external?,kind}]}] }`
- `/settings` GET/PUT → preferences object. `/views` GET/POST/DELETE.

## Globe engine API (preserved renderer)

```js
const globe = createGlobe(containerEl, { flows, countries, lowPower, autoRotate, onAnnounce });
globe.on("change", snap => {...});   // snap: period, periodIdx, periods, totals, routeCount,
                                     // countryCount, recordCount, selectedCountry, selectedRoute,
                                     // rotation, playing, speed, autoRotate, lowPower, showInput/Output/Routes,
                                     // particles, particleBudget, assets, validation, frames, ready
await globe.mount();
globe.setPeriod(i); globe.stepPeriod(±1); globe.togglePlay(); globe.setSpeed(x); globe.setLoop(bool);
globe.selectCountry(iso3, withSpotlight=true); globe.selectRoute(key); globe.clearSelections();
globe.spotlightTo(lon, lat); globe.setRotation([λ, φ]); globe.setAutoRotate(bool); globe.setLowPower(bool);
globe.setShowInput/Output/Routes(bool);
globe.setLayers([{ id, type:"markers", items:[{lon,lat,color,radius,ring,href,...}], visible:true },
                 { id, type:"choropleth", values:{ ISO3: number }, color: v => cssColor, visible:true }]);
globe.agg  // aggregation layer: periods, recordsFor, totals, byOrigin, byDestination,
           // routeVolumes, countryMetrics, rankings, partners, pct
globe.getSnapshot(); globe.getState(); globe.validate(); globe.destroy();
```
`flows` records must be `{ period, origin, destination, inputTokens, outputTokens }` with ISO3 codes
present in `countries` (`{ ISO3: { name, lon, lat } }`). Route key format: `"USA>IND"`.

## Design rules (Midnight Observatory)

- Use ONLY the tokens in `src/styles/tokens.css`. No new palettes, no per-workspace colours.
- Cyan `--input-cyan` = input/prompt. Amber `--output-amber` = output/generated. Violet `--violet` = secondary analytical dimension.
- Build UI from `ui.panel`, `ui.statRow`, `ui.rankList`, `ui.table`, `ui.kv`, `ui.tabs`.
- Every metric panel must show its evidence class (`ui.evidenceBadge`) and, where relevant,
  freshness/availability. Synthetic data must always be visibly labelled.
- Empty coverage → `ui.emptyState("No observations", "...coverage gap, not a zero...")`.
- Source failure → `ui.errorState(message, retryButtonId)` and wire the retry.
- Every visible control must work. No inert buttons, no fake dropdowns, no dead tabs.
- Links to other workspaces/profiles use `<a data-link href="/...">` (router intercepts).
- External sources use `target="_blank" rel="noopener noreferrer"`.
- Escape all interpolated text with `ui.h`.
- Add `data-screen-label="<workspace>"` on the workspace root div.
- Keyboard accessible, visible focus, touch targets ≥ 36px on mobile (CSS handles most).
- Do not use `scrollIntoView`.

## Data honesty (mandatory)

- Never present synthetic values as measured traffic or national statistics.
- Never infer serving geography from provider HQ, model-development country, billing country or cloud-region availability.
- Missing data is a coverage gap, never a zero. A failed source is never a zero.
- Keep publication time and event time separate for intelligence items.
- Do not blend incompatible pricing units or incomparable benchmark scores.
- Do not merge adoption surveys with different methodologies into one unqualified ranking.
- The flows disclaimer must remain visible: **"Synthetic demo data, not measured international token traffic"**.

## Performance

- Lazy modules are already handled by the router (`import()` per route).
- Destroy globe/map instances and document listeners in `destroy()`.
- Debounce search/filter inputs (~200 ms). Avoid per-frame DOM writes.
- Long lists: cap rendered rows (e.g. 100) and offer "show more" rather than rendering thousands.
