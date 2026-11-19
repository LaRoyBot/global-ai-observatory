
"use strict";
/* =====================================================================
   GLOBAL AI OBSERVATORY — application source
   Sections:
     1. Configuration & design tokens
     2. FLOWS demonstration dataset (replaceable)
     3. COUNTRY_COORDS geographic lookup (replaceable)
     4. Dataset validation
     5. Aggregation layer (single source of numeric truth)
     6. Particle allocation (deterministic, sqrt scale, budgeted)
     7. Geographic math, visibility & route construction
     8. Rendering (layered canvas + static fallback)
     9. Particle system
    10. Interaction (drag, hover, click, keyboard)
    11. UI updates (summary, panel, rankings, inspector, tooltip)
    12. Timeline & playback
    13. Boot, asset loading, failure handling, lifecycle
    14. Development validation & test API
   ===================================================================== */

/* ---------- 1. CONFIGURATION ---------- */
const CFG = {
  colors: {
    background:"#070B13", globe:"#101C2B", countryFill:"#16283A",
    countryOutline:"#577084", textSecondary:"#93A4B7", textMuted:"#607286",
    input:"#59C9F5", output:"#FFB56B", selection:"#C0E8FF",
    atmosphere:"rgba(63,154,224,0.14)", route:"122,160,196",
    graticule:"rgba(147,164,183,0.07)"
  },
  particleBudget: 150,        // hard cap, normal mode
  particleBudgetLow: 75,      // hard cap, low-power mode
  radiusBase: 1, radiusGain: 2.2, radiusMin: 1, radiusMax: 3.2,
  dprCap: 2, dprCapLow: 1,
  autoRotateDegPerSec: 0.9,
  playbackBaseMs: 2400,       // ms per period at 1x
  crossfadeMs: 600,           // route intensity transition between periods
  spotlightMs: 900,
  idleResumeMs: 2500,         // auto-rotation resume delay after interaction
  assetTimeoutMs: 12000,
  urls: {
    d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
    topojson: "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
    atlas: "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
  }
};

/* ---------- 2. FLOWS — EMBEDDED SYNTHETIC DEMONSTRATION DATASET ----------
   FICTIONAL DATA. Not measured traffic, not provider data, not national
   statistics. Replace this array to change the entire experience; every
   number shown anywhere in the app is derived from these records.

   Schema (exact):
     { period:"YYYY-MM", origin:"ISO3", destination:"ISO3",
       inputTokens:<int >= 0>, outputTokens:<int >= 0> }

   Convention:
     origin      = SERVING country (where inference is served)
     destination = CONSUMING country (where consumption is associated)
     inputTokens  = prompt tokens, conceptually travelling destination→origin
     outputTokens = generated tokens, conceptually travelling origin→destination
     totalTokens  = inputTokens + outputTokens (computed, never stored)

   Demo shape: 6 monthly periods (2026-01…2026-06), 13 countries,
   30 bilateral relationships. Serving hubs: USA, IRL, SGP, plus emerging
   ARE and IND. India appears in 7 relationships. Volumes grow over time;
   some routes emerge mid-series (SGP→ARE from Feb, ARE→IND from Mar,
   ARE→GBR & IND→ARE from Apr, IND→SGP from May, BRA→USA from Mar).
------------------------------------------------------------------------ */
const FLOWS = [
  // ---- 2026-01 ----
  {period:"2026-01",origin:"USA",destination:"IND",inputTokens:180000000000,outputTokens:140000000000},
  {period:"2026-01",origin:"USA",destination:"GBR",inputTokens:140000000000,outputTokens:105000000000},
  {period:"2026-01",origin:"USA",destination:"DEU",inputTokens:110000000000,outputTokens:85000000000},
  {period:"2026-01",origin:"USA",destination:"JPN",inputTokens:120000000000,outputTokens:95000000000},
  {period:"2026-01",origin:"USA",destination:"BRA",inputTokens:70000000000,outputTokens:52000000000},
  {period:"2026-01",origin:"USA",destination:"CAN",inputTokens:95000000000,outputTokens:72000000000},
  {period:"2026-01",origin:"USA",destination:"AUS",inputTokens:60000000000,outputTokens:46000000000},
  {period:"2026-01",origin:"USA",destination:"KOR",inputTokens:55000000000,outputTokens:42000000000},
  {period:"2026-01",origin:"USA",destination:"FRA",inputTokens:75000000000,outputTokens:58000000000},
  {period:"2026-01",origin:"USA",destination:"SGP",inputTokens:48000000000,outputTokens:38000000000},
  {period:"2026-01",origin:"USA",destination:"ARE",inputTokens:32000000000,outputTokens:24000000000},
  {period:"2026-01",origin:"IRL",destination:"GBR",inputTokens:90000000000,outputTokens:68000000000},
  {period:"2026-01",origin:"IRL",destination:"DEU",inputTokens:72000000000,outputTokens:55000000000},
  {period:"2026-01",origin:"IRL",destination:"IND",inputTokens:60000000000,outputTokens:45000000000},
  {period:"2026-01",origin:"IRL",destination:"FRA",inputTokens:45000000000,outputTokens:34000000000},
  {period:"2026-01",origin:"IRL",destination:"BRA",inputTokens:30000000000,outputTokens:22000000000},
  {period:"2026-01",origin:"SGP",destination:"IND",inputTokens:105000000000,outputTokens:80000000000},
  {period:"2026-01",origin:"SGP",destination:"AUS",inputTokens:52000000000,outputTokens:40000000000},
  {period:"2026-01",origin:"SGP",destination:"JPN",inputTokens:46000000000,outputTokens:36000000000},
  {period:"2026-01",origin:"SGP",destination:"KOR",inputTokens:34000000000,outputTokens:26000000000},
  {period:"2026-01",origin:"DEU",destination:"GBR",inputTokens:28000000000,outputTokens:21000000000},
  {period:"2026-01",origin:"JPN",destination:"USA",inputTokens:40000000000,outputTokens:32000000000},
  {period:"2026-01",origin:"GBR",destination:"IND",inputTokens:36000000000,outputTokens:27000000000},
  {period:"2026-01",origin:"KOR",destination:"JPN",inputTokens:14000000000,outputTokens:11000000000},
  // ---- 2026-02 ----
  {period:"2026-02",origin:"USA",destination:"IND",inputTokens:205000000000,outputTokens:162000000000},
  {period:"2026-02",origin:"USA",destination:"GBR",inputTokens:148000000000,outputTokens:112000000000},
  {period:"2026-02",origin:"USA",destination:"DEU",inputTokens:117000000000,outputTokens:91000000000},
  {period:"2026-02",origin:"USA",destination:"JPN",inputTokens:127000000000,outputTokens:101000000000},
  {period:"2026-02",origin:"USA",destination:"BRA",inputTokens:78000000000,outputTokens:58000000000},
  {period:"2026-02",origin:"USA",destination:"CAN",inputTokens:100000000000,outputTokens:76000000000},
  {period:"2026-02",origin:"USA",destination:"AUS",inputTokens:65000000000,outputTokens:50000000000},
  {period:"2026-02",origin:"USA",destination:"KOR",inputTokens:59000000000,outputTokens:45000000000},
  {period:"2026-02",origin:"USA",destination:"FRA",inputTokens:79000000000,outputTokens:62000000000},
  {period:"2026-02",origin:"USA",destination:"SGP",inputTokens:52000000000,outputTokens:41000000000},
  {period:"2026-02",origin:"USA",destination:"ARE",inputTokens:36000000000,outputTokens:27000000000},
  {period:"2026-02",origin:"IRL",destination:"GBR",inputTokens:95000000000,outputTokens:72000000000},
  {period:"2026-02",origin:"IRL",destination:"DEU",inputTokens:76000000000,outputTokens:59000000000},
  {period:"2026-02",origin:"IRL",destination:"IND",inputTokens:72000000000,outputTokens:54000000000},
  {period:"2026-02",origin:"IRL",destination:"FRA",inputTokens:48000000000,outputTokens:37000000000},
  {period:"2026-02",origin:"IRL",destination:"BRA",inputTokens:34000000000,outputTokens:25000000000},
  {period:"2026-02",origin:"SGP",destination:"IND",inputTokens:117000000000,outputTokens:90000000000},
  {period:"2026-02",origin:"SGP",destination:"AUS",inputTokens:56000000000,outputTokens:43000000000},
  {period:"2026-02",origin:"SGP",destination:"JPN",inputTokens:49000000000,outputTokens:39000000000},
  {period:"2026-02",origin:"SGP",destination:"KOR",inputTokens:36000000000,outputTokens:28000000000},
  {period:"2026-02",origin:"SGP",destination:"ARE",inputTokens:18000000000,outputTokens:14000000000},
  {period:"2026-02",origin:"DEU",destination:"GBR",inputTokens:30000000000,outputTokens:23000000000},
  {period:"2026-02",origin:"JPN",destination:"USA",inputTokens:43000000000,outputTokens:34000000000},
  {period:"2026-02",origin:"GBR",destination:"IND",inputTokens:41000000000,outputTokens:31000000000},
  {period:"2026-02",origin:"KOR",destination:"JPN",inputTokens:15000000000,outputTokens:12000000000},
  // ---- 2026-03 ----
  {period:"2026-03",origin:"USA",destination:"IND",inputTokens:232000000000,outputTokens:186000000000},
  {period:"2026-03",origin:"USA",destination:"GBR",inputTokens:156000000000,outputTokens:120000000000},
  {period:"2026-03",origin:"USA",destination:"DEU",inputTokens:124000000000,outputTokens:97000000000},
  {period:"2026-03",origin:"USA",destination:"JPN",inputTokens:134000000000,outputTokens:107000000000},
  {period:"2026-03",origin:"USA",destination:"BRA",inputTokens:86000000000,outputTokens:65000000000},
  {period:"2026-03",origin:"USA",destination:"CAN",inputTokens:106000000000,outputTokens:81000000000},
  {period:"2026-03",origin:"USA",destination:"AUS",inputTokens:70000000000,outputTokens:54000000000},
  {period:"2026-03",origin:"USA",destination:"KOR",inputTokens:63000000000,outputTokens:49000000000},
  {period:"2026-03",origin:"USA",destination:"FRA",inputTokens:84000000000,outputTokens:66000000000},
  {period:"2026-03",origin:"USA",destination:"SGP",inputTokens:56000000000,outputTokens:45000000000},
  {period:"2026-03",origin:"USA",destination:"ARE",inputTokens:40000000000,outputTokens:31000000000},
  {period:"2026-03",origin:"IRL",destination:"GBR",inputTokens:100000000000,outputTokens:77000000000},
  {period:"2026-03",origin:"IRL",destination:"DEU",inputTokens:81000000000,outputTokens:63000000000},
  {period:"2026-03",origin:"IRL",destination:"IND",inputTokens:85000000000,outputTokens:65000000000},
  {period:"2026-03",origin:"IRL",destination:"FRA",inputTokens:51000000000,outputTokens:39000000000},
  {period:"2026-03",origin:"IRL",destination:"BRA",inputTokens:38000000000,outputTokens:28000000000},
  {period:"2026-03",origin:"SGP",destination:"IND",inputTokens:130000000000,outputTokens:101000000000},
  {period:"2026-03",origin:"SGP",destination:"AUS",inputTokens:60000000000,outputTokens:47000000000},
  {period:"2026-03",origin:"SGP",destination:"JPN",inputTokens:52000000000,outputTokens:41000000000},
  {period:"2026-03",origin:"SGP",destination:"KOR",inputTokens:39000000000,outputTokens:30000000000},
  {period:"2026-03",origin:"SGP",destination:"ARE",inputTokens:24000000000,outputTokens:19000000000},
  {period:"2026-03",origin:"ARE",destination:"IND",inputTokens:25000000000,outputTokens:19000000000},
  {period:"2026-03",origin:"DEU",destination:"GBR",inputTokens:32000000000,outputTokens:24000000000},
  {period:"2026-03",origin:"JPN",destination:"USA",inputTokens:46000000000,outputTokens:37000000000},
  {period:"2026-03",origin:"GBR",destination:"IND",inputTokens:47000000000,outputTokens:36000000000},
  {period:"2026-03",origin:"KOR",destination:"JPN",inputTokens:16000000000,outputTokens:12000000000},
  {period:"2026-03",origin:"BRA",destination:"USA",inputTokens:9000000000,outputTokens:7000000000},
  // ---- 2026-04 ----
  {period:"2026-04",origin:"USA",destination:"IND",inputTokens:262000000000,outputTokens:212000000000},
  {period:"2026-04",origin:"USA",destination:"GBR",inputTokens:165000000000,outputTokens:128000000000},
  {period:"2026-04",origin:"USA",destination:"DEU",inputTokens:132000000000,outputTokens:104000000000},
  {period:"2026-04",origin:"USA",destination:"JPN",inputTokens:142000000000,outputTokens:114000000000},
  {period:"2026-04",origin:"USA",destination:"BRA",inputTokens:95000000000,outputTokens:72000000000},
  {period:"2026-04",origin:"USA",destination:"CAN",inputTokens:112000000000,outputTokens:86000000000},
  {period:"2026-04",origin:"USA",destination:"AUS",inputTokens:76000000000,outputTokens:59000000000},
  {period:"2026-04",origin:"USA",destination:"KOR",inputTokens:68000000000,outputTokens:53000000000},
  {period:"2026-04",origin:"USA",destination:"FRA",inputTokens:89000000000,outputTokens:70000000000},
  {period:"2026-04",origin:"USA",destination:"SGP",inputTokens:60000000000,outputTokens:48000000000},
  {period:"2026-04",origin:"USA",destination:"ARE",inputTokens:45000000000,outputTokens:35000000000},
  {period:"2026-04",origin:"IRL",destination:"GBR",inputTokens:106000000000,outputTokens:82000000000},
  {period:"2026-04",origin:"IRL",destination:"DEU",inputTokens:86000000000,outputTokens:67000000000},
  {period:"2026-04",origin:"IRL",destination:"IND",inputTokens:99000000000,outputTokens:77000000000},
  {period:"2026-04",origin:"IRL",destination:"FRA",inputTokens:54000000000,outputTokens:42000000000},
  {period:"2026-04",origin:"IRL",destination:"BRA",inputTokens:42000000000,outputTokens:32000000000},
  {period:"2026-04",origin:"SGP",destination:"IND",inputTokens:144000000000,outputTokens:113000000000},
  {period:"2026-04",origin:"SGP",destination:"AUS",inputTokens:65000000000,outputTokens:51000000000},
  {period:"2026-04",origin:"SGP",destination:"JPN",inputTokens:56000000000,outputTokens:44000000000},
  {period:"2026-04",origin:"SGP",destination:"KOR",inputTokens:42000000000,outputTokens:33000000000},
  {period:"2026-04",origin:"SGP",destination:"ARE",inputTokens:30000000000,outputTokens:24000000000},
  {period:"2026-04",origin:"ARE",destination:"IND",inputTokens:42000000000,outputTokens:32000000000},
  {period:"2026-04",origin:"ARE",destination:"GBR",inputTokens:16000000000,outputTokens:12000000000},
  {period:"2026-04",origin:"IND",destination:"ARE",inputTokens:12000000000,outputTokens:9000000000},
  {period:"2026-04",origin:"DEU",destination:"GBR",inputTokens:35000000000,outputTokens:27000000000},
  {period:"2026-04",origin:"JPN",destination:"USA",inputTokens:50000000000,outputTokens:40000000000},
  {period:"2026-04",origin:"GBR",destination:"IND",inputTokens:53000000000,outputTokens:41000000000},
  {period:"2026-04",origin:"KOR",destination:"JPN",inputTokens:17000000000,outputTokens:13000000000},
  {period:"2026-04",origin:"BRA",destination:"USA",inputTokens:12000000000,outputTokens:9000000000},
  // ---- 2026-05 ----
  {period:"2026-05",origin:"USA",destination:"IND",inputTokens:292000000000,outputTokens:238000000000},
  {period:"2026-05",origin:"USA",destination:"GBR",inputTokens:175000000000,outputTokens:138000000000},
  {period:"2026-05",origin:"USA",destination:"DEU",inputTokens:141000000000,outputTokens:112000000000},
  {period:"2026-05",origin:"USA",destination:"JPN",inputTokens:151000000000,outputTokens:122000000000},
  {period:"2026-05",origin:"USA",destination:"BRA",inputTokens:105000000000,outputTokens:81000000000},
  {period:"2026-05",origin:"USA",destination:"CAN",inputTokens:118000000000,outputTokens:93000000000},
  {period:"2026-05",origin:"USA",destination:"AUS",inputTokens:82000000000,outputTokens:64000000000},
  {period:"2026-05",origin:"USA",destination:"KOR",inputTokens:73000000000,outputTokens:57000000000},
  {period:"2026-05",origin:"USA",destination:"FRA",inputTokens:94000000000,outputTokens:75000000000},
  {period:"2026-05",origin:"USA",destination:"SGP",inputTokens:65000000000,outputTokens:52000000000},
  {period:"2026-05",origin:"USA",destination:"ARE",inputTokens:50000000000,outputTokens:39000000000},
  {period:"2026-05",origin:"IRL",destination:"GBR",inputTokens:113000000000,outputTokens:88000000000},
  {period:"2026-05",origin:"IRL",destination:"DEU",inputTokens:92000000000,outputTokens:72000000000},
  {period:"2026-05",origin:"IRL",destination:"IND",inputTokens:114000000000,outputTokens:90000000000},
  {period:"2026-05",origin:"IRL",destination:"FRA",inputTokens:58000000000,outputTokens:45000000000},
  {period:"2026-05",origin:"IRL",destination:"BRA",inputTokens:47000000000,outputTokens:36000000000},
  {period:"2026-05",origin:"SGP",destination:"IND",inputTokens:159000000000,outputTokens:126000000000},
  {period:"2026-05",origin:"SGP",destination:"AUS",inputTokens:70000000000,outputTokens:55000000000},
  {period:"2026-05",origin:"SGP",destination:"JPN",inputTokens:60000000000,outputTokens:48000000000},
  {period:"2026-05",origin:"SGP",destination:"KOR",inputTokens:45000000000,outputTokens:35000000000},
  {period:"2026-05",origin:"SGP",destination:"ARE",inputTokens:37000000000,outputTokens:29000000000},
  {period:"2026-05",origin:"ARE",destination:"IND",inputTokens:62000000000,outputTokens:48000000000},
  {period:"2026-05",origin:"ARE",destination:"GBR",inputTokens:26000000000,outputTokens:20000000000},
  {period:"2026-05",origin:"IND",destination:"ARE",inputTokens:22000000000,outputTokens:17000000000},
  {period:"2026-05",origin:"IND",destination:"SGP",inputTokens:10000000000,outputTokens:8000000000},
  {period:"2026-05",origin:"DEU",destination:"GBR",inputTokens:37000000000,outputTokens:29000000000},
  {period:"2026-05",origin:"JPN",destination:"USA",inputTokens:54000000000,outputTokens:43000000000},
  {period:"2026-05",origin:"GBR",destination:"IND",inputTokens:59000000000,outputTokens:46000000000},
  {period:"2026-05",origin:"KOR",destination:"JPN",inputTokens:18000000000,outputTokens:14000000000},
  {period:"2026-05",origin:"BRA",destination:"USA",inputTokens:15000000000,outputTokens:11000000000},
  // ---- 2026-06 ----
  {period:"2026-06",origin:"USA",destination:"IND",inputTokens:320000000000,outputTokens:260000000000},
  {period:"2026-06",origin:"USA",destination:"GBR",inputTokens:185000000000,outputTokens:150000000000},
  {period:"2026-06",origin:"USA",destination:"DEU",inputTokens:150000000000,outputTokens:120000000000},
  {period:"2026-06",origin:"USA",destination:"JPN",inputTokens:160000000000,outputTokens:130000000000},
  {period:"2026-06",origin:"USA",destination:"BRA",inputTokens:115000000000,outputTokens:90000000000},
  {period:"2026-06",origin:"USA",destination:"CAN",inputTokens:125000000000,outputTokens:100000000000},
  {period:"2026-06",origin:"USA",destination:"AUS",inputTokens:88000000000,outputTokens:70000000000},
  {period:"2026-06",origin:"USA",destination:"KOR",inputTokens:78000000000,outputTokens:62000000000},
  {period:"2026-06",origin:"USA",destination:"FRA",inputTokens:100000000000,outputTokens:80000000000},
  {period:"2026-06",origin:"USA",destination:"SGP",inputTokens:70000000000,outputTokens:56000000000},
  {period:"2026-06",origin:"USA",destination:"ARE",inputTokens:56000000000,outputTokens:44000000000},
  {period:"2026-06",origin:"IRL",destination:"GBR",inputTokens:120000000000,outputTokens:95000000000},
  {period:"2026-06",origin:"IRL",destination:"DEU",inputTokens:98000000000,outputTokens:78000000000},
  {period:"2026-06",origin:"IRL",destination:"IND",inputTokens:130000000000,outputTokens:105000000000},
  {period:"2026-06",origin:"IRL",destination:"FRA",inputTokens:62000000000,outputTokens:49000000000},
  {period:"2026-06",origin:"IRL",destination:"BRA",inputTokens:52000000000,outputTokens:40000000000},
  {period:"2026-06",origin:"SGP",destination:"IND",inputTokens:175000000000,outputTokens:140000000000},
  {period:"2026-06",origin:"SGP",destination:"AUS",inputTokens:75000000000,outputTokens:60000000000},
  {period:"2026-06",origin:"SGP",destination:"JPN",inputTokens:64000000000,outputTokens:51000000000},
  {period:"2026-06",origin:"SGP",destination:"KOR",inputTokens:48000000000,outputTokens:38000000000},
  {period:"2026-06",origin:"SGP",destination:"ARE",inputTokens:44000000000,outputTokens:35000000000},
  {period:"2026-06",origin:"ARE",destination:"IND",inputTokens:85000000000,outputTokens:66000000000},
  {period:"2026-06",origin:"ARE",destination:"GBR",inputTokens:38000000000,outputTokens:30000000000},
  {period:"2026-06",origin:"IND",destination:"ARE",inputTokens:34000000000,outputTokens:27000000000},
  {period:"2026-06",origin:"IND",destination:"SGP",inputTokens:20000000000,outputTokens:16000000000},
  {period:"2026-06",origin:"DEU",destination:"GBR",inputTokens:40000000000,outputTokens:31000000000},
  {period:"2026-06",origin:"JPN",destination:"USA",inputTokens:58000000000,outputTokens:47000000000},
  {period:"2026-06",origin:"GBR",destination:"IND",inputTokens:66000000000,outputTokens:52000000000},
  {period:"2026-06",origin:"KOR",destination:"JPN",inputTokens:20000000000,outputTokens:16000000000},
  {period:"2026-06",origin:"BRA",destination:"USA",inputTokens:18000000000,outputTokens:14000000000}
];

/* ---------- 3. COUNTRY_COORDS — GEOGRAPHIC LOOKUP ----------
   Independent of all rendering logic. Real country reference points
   (approximate geographic centroids), ISO 3166-1 alpha-3 keys.
   To add a country: add it here, in ISO_NUMERIC, and use its code in
   FLOWS. Coordinates are route endpoints — never screen positions.
------------------------------------------------------------- */
const COUNTRY_COORDS = {
  USA:{name:"United States",     lon:-98.58,  lat:39.83},
  CAN:{name:"Canada",            lon:-106.35, lat:56.13},
  BRA:{name:"Brazil",            lon:-51.93,  lat:-14.24},
  GBR:{name:"United Kingdom",    lon:-1.46,   lat:52.60},
  IRL:{name:"Ireland",           lon:-8.24,   lat:53.41},
  DEU:{name:"Germany",           lon:10.45,   lat:51.16},
  FRA:{name:"France",            lon:2.21,    lat:46.23},
  ARE:{name:"United Arab Emirates",lon:54.37, lat:23.42},
  IND:{name:"India",             lon:78.96,   lat:20.59},
  SGP:{name:"Singapore",         lon:103.82,  lat:1.35},
  JPN:{name:"Japan",             lon:138.25,  lat:36.20},
  KOR:{name:"South Korea",       lon:127.77,  lat:35.91},
  AUS:{name:"Australia",         lon:133.78,  lat:-25.27}
};

/* ISO alpha-3 -> ISO 3166-1 numeric, for matching Natural Earth atlas ids. */
const ISO_NUMERIC = {
  USA:"840", CAN:"124", BRA:"076", GBR:"826", IRL:"372", DEU:"276",
  FRA:"250", ARE:"784", IND:"356", SGP:"702", JPN:"392", KOR:"410", AUS:"036"
};

/* Singapore supplement: Natural Earth 1:110m omits city-states, so the
   main-island outline below is embedded from Natural Earth 1:50m
   (world-atlas 2.0.2, country id 702), decimated to its 8 source vertices.
   Real geography, coarser resolution — not a fabricated shape. */
const SG_SUPPLEMENT = {
  type:"Feature",
  properties:{name:"Singapore", iso:"SGP"},
  geometry:{type:"Polygon",coordinates:[[
    [103.9708,1.3321],[103.8196,1.2662],[103.6504,1.3252],[103.7044,1.4241],
    [103.8196,1.4467],[103.9096,1.4155],[103.96,1.3929],[103.996,1.3651],
    [103.9708,1.3321]
  ]]}
};

/* ---------- 4. DATASET VALIDATION ----------
   Runs at startup. Malformed data produces a visible, specific error —
   records are never silently discarded. */
function validateDataset(flows, coords) {
  const errors = [];
  const seen = new Set();
  const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!Array.isArray(flows) || flows.length === 0) {
    errors.push("FLOWS must be a non-empty array.");
    return { ok:false, errors };
  }
  flows.forEach((r, i) => {
    const at = "FLOWS[" + i + "]";
    if (!r || typeof r !== "object") { errors.push(at + ": not an object."); return; }
    for (const k of ["period","origin","destination","inputTokens","outputTokens"]) {
      if (!(k in r)) errors.push(at + ": missing required property '" + k + "'.");
    }
    if (typeof r.period !== "string" || !periodRe.test(r.period))
      errors.push(at + ": period '" + r.period + "' is not YYYY-MM with a valid month.");
    for (const side of ["origin","destination"]) {
      const code = r[side];
      if (typeof code !== "string" || !coords[code]) {
        errors.push(at + ": " + side + " '" + code + "' has no COUNTRY_COORDS entry.");
      } else {
        const c = coords[code];
        if (typeof c.name !== "string" || !c.name)
          errors.push(at + ": " + code + " is missing a display name.");
        if (!Number.isFinite(c.lon) || c.lon < -180 || c.lon > 180 ||
            !Number.isFinite(c.lat) || c.lat < -90 || c.lat > 90)
          errors.push(at + ": " + code + " has invalid coordinates (" + c.lon + ", " + c.lat + ").");
      }
    }
    if (r.origin && r.destination && r.origin === r.destination)
      errors.push(at + ": origin and destination are the same country.");
    for (const k of ["inputTokens","outputTokens"]) {
      const v = r[k];
      if (!Number.isInteger(v) || v < 0)
        errors.push(at + ": " + k + " must be a nonnegative integer (got " + v + ").");
      else if (v > Number.MAX_SAFE_INTEGER)
        errors.push(at + ": " + k + " exceeds Number.MAX_SAFE_INTEGER.");
    }
    const key = r.period + "|" + r.origin + "|" + r.destination;
    if (seen.has(key)) errors.push(at + ": duplicate record for " + key + ".");
    seen.add(key);
  });
  // Every country used in FLOWS needs an ISO numeric mapping for the atlas.
  for (const code of new Set(flows.flatMap(r => [r.origin, r.destination]))) {
    if (coords[code] && !ISO_NUMERIC[code])
      errors.push("Country " + code + " is missing an ISO_NUMERIC mapping.");
  }
  return { ok: errors.length === 0, errors };
}

/* ---------- 5. AGGREGATION LAYER ----------
   Single source of numeric truth. Every statistic, ranking, tooltip and
   particle allocation in the app is derived from these functions, which
   operate on the embedded FLOWS records. Exact integer arithmetic is used;
   aggregates are guarded against Number.MAX_SAFE_INTEGER overflow. */
const Agg = (() => {
  const SAFE = Number.MAX_SAFE_INTEGER;
  function guard(v, label) {
    if (!Number.isFinite(v) || v > SAFE || v < -SAFE)
      throw new Error("Aggregate '" + label + "' exceeds safe integer precision (" + v + "). Use BigInt-backed data for datasets this large.");
    return v;
  }
  function periods() {
    return [...new Set(FLOWS.map(r => r.period))].sort();
  }
  function recordsFor(period) {
    return FLOWS.filter(r => r.period === period);
  }
  function totals(recs) {
    let input = 0, output = 0;
    const countries = new Set();
    for (const r of recs) {
      input += r.inputTokens; output += r.outputTokens;
      countries.add(r.origin); countries.add(r.destination);
    }
    guard(input, "input"); guard(output, "output"); guard(input + output, "total");
    return { input, output, total: input + output, routes: recs.length, countries: countries.size };
  }
  // Group by serving country (origin) or consuming country (destination).
  function groupBy(recs, side) {
    const m = new Map();
    for (const r of recs) {
      const code = r[side];
      let g = m.get(code);
      if (!g) { g = { code, name: COUNTRY_COORDS[code].name, input: 0, output: 0, total: 0, routes: 0 }; m.set(code, g); }
      g.input += r.inputTokens; g.output += r.outputTokens;
      g.total += r.inputTokens + r.outputTokens; g.routes++;
    }
    for (const g of m.values()) { guard(g.input, side + ".input"); guard(g.output, side + ".output"); guard(g.total, side + ".total"); }
    return m;
  }
  const byOrigin = recs => groupBy(recs, "origin");
  const byDestination = recs => groupBy(recs, "destination");
  function routeVolumes(recs) {
    const m = new Map();
    for (const r of recs) {
      const key = r.origin + ">" + r.destination;
      let v = m.get(key);
      if (!v) { v = { key, origin: r.origin, destination: r.destination, input: 0, output: 0, total: 0 }; m.set(key, v); }
      v.input += r.inputTokens; v.output += r.outputTokens; v.total += r.inputTokens + r.outputTokens;
    }
    for (const v of m.values()) guard(v.total, "route.total");
    return m;
  }
  // Selected-country metrics. Directions are explicit, never ambiguous:
  //   serving.outputServed   = generated tokens this country SERVES to others (origin side, output)
  //   serving.inputReceived  = prompt tokens this country RECEIVES as server (origin side, input)
  //   consuming.outputReceived = generated tokens this country RECEIVES as consumer (destination side, output)
  //   consuming.inputSent    = prompt tokens this country SENDS as consumer (destination side, input)
  function countryMetrics(code, recs) {
    const s = { outputServed: 0, inputReceived: 0, total: 0, partners: 0 };
    const c = { outputReceived: 0, inputSent: 0, total: 0, partners: 0 };
    const sPartners = new Set(), cPartners = new Set();
    for (const r of recs) {
      if (r.origin === code) {
        s.outputServed += r.outputTokens; s.inputReceived += r.inputTokens;
        s.total += r.inputTokens + r.outputTokens; sPartners.add(r.destination);
      }
      if (r.destination === code) {
        c.outputReceived += r.outputTokens; c.inputSent += r.inputTokens;
        c.total += r.inputTokens + r.outputTokens; cPartners.add(r.origin);
      }
    }
    s.partners = sPartners.size; c.partners = cPartners.size;
    guard(s.total, "country.serving"); guard(c.total, "country.consuming");
    return { serving: s, consuming: c };
  }
  // Rankings: total-associated volume, grouped by destination (consuming)
  // or origin (serving). Share denominator is always the period total.
  function rankings(recs, mode, limit) {
    const groups = mode === "serving" ? byOrigin(recs) : byDestination(recs);
    const t = totals(recs);
    const rows = [...groups.values()]
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .map((g, i) => ({ rank: i + 1, ...g, share: t.total > 0 ? g.total / t.total : 0 }));
    return limit ? rows.slice(0, limit) : rows;
  }
  // Partner rankings for a selected country.
  //   mode "consumers": countries consuming FROM the selected server (origin=code, group by destination)
  //   mode "servers":   countries serving the selected consumer (destination=code, group by origin)
  function partners(code, recs, mode) {
    const m = new Map();
    let denom = 0;
    for (const r of recs) {
      const match = mode === "consumers" ? r.origin === code : r.destination === code;
      if (!match) continue;
      const other = mode === "consumers" ? r.destination : r.origin;
      let g = m.get(other);
      if (!g) { g = { code: other, name: COUNTRY_COORDS[other].name, input: 0, output: 0, total: 0 }; m.set(other, g); }
      g.input += r.inputTokens; g.output += r.outputTokens;
      g.total += r.inputTokens + r.outputTokens;
      denom += r.inputTokens + r.outputTokens;
    }
    guard(denom, "partners.denom");
    return [...m.values()]
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .map((g, i) => ({ rank: i + 1, ...g, share: denom > 0 ? g.total / denom : 0 }));
  }
  function pct(part, whole) { return whole > 0 ? (part / whole) * 100 : 0; }
  return { periods, recordsFor, totals, byOrigin, byDestination, routeVolumes, countryMetrics, rankings, partners, pct, guard };
})();

/* ---------- 6. PARTICLE ALLOCATION ----------
   Deterministic, budgeted, square-root volume scale (documented in the
   methodology panel):
     weight(stream) = sqrt(volume)
     radius(stream) = clamp(1 + 2.2 * sqrt(volume / maxVolume), 1, 3.2) px
   Budget: <= 150 particles (<= 75 low-power). Every visible nonzero stream
   gets one particle where the budget allows; the remainder is distributed
   proportionally to sqrt-weights using the largest-remainder method with
   stable tie-breaking, so counts never flicker between identical states.
   Particles encode RELATIVE volume — they are not individual tokens. */
function allocateParticles(streams, budget) {
  // streams: [{ key, volume }] — visible, nonzero, already filtered.
  const counts = new Map();
  if (!streams.length || budget <= 0) return counts;
  const weighted = streams
    .map(s => ({ key: s.key, volume: s.volume, w: Math.sqrt(s.volume) }))
    .sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const n = weighted.length;
  if (budget < n) {
    // Not enough budget for everyone: strongest streams get one each.
    for (let i = 0; i < budget; i++) counts.set(weighted[i].key, 1);
    return counts;
  }
  for (const s of weighted) counts.set(s.key, 1);
  let remaining = budget - n;
  const sumW = weighted.reduce((a, s) => a + s.w, 0);
  const quotas = weighted.map(s => {
    const q = remaining * (s.w / sumW);
    return { key: s.key, floor: Math.floor(q), frac: q - Math.floor(q) };
  });
  let used = quotas.reduce((a, q) => a + q.floor, 0);
  for (const q of quotas) counts.set(q.key, counts.get(q.key) + q.floor);
  let leftover = remaining - used;
  const byFrac = [...quotas].sort((a, b) => b.frac - a.frac || (a.key < b.key ? -1 : 1));
  for (let i = 0; leftover > 0 && i < byFrac.length; i++, leftover--)
    counts.set(byFrac[i].key, counts.get(byFrac[i].key) + 1);
  return counts;
}
function particleRadius(volume, maxVolume) {
  if (!(volume > 0) || !(maxVolume > 0)) return CFG.radiusMin;
  const r = CFG.radiusBase + CFG.radiusGain * Math.sqrt(volume / maxVolume);
  return Math.min(CFG.radiusMax, Math.max(CFG.radiusMin, r));
}

/* ---------- 7. GEOGRAPHIC MATH, VISIBILITY & ROUTES ----------
   All route geometry is geographic: great-circle (slerp) interpolation
   between real country reference points, projected through an orthographic
   projection. Hemisphere visibility is tested explicitly per point with
   dot(p, viewCenter) > 0 — a circular canvas clip is NOT used for routes
   or particles. Antimeridian crossings are handled naturally because all
   math is done on unit vectors, never on raw longitude differences. */
const Geo = (() => {
  const DEG = Math.PI / 180;
  const toVec = (lon, lat) => {
    const l = lon * DEG, p = lat * DEG, cp = Math.cos(p);
    return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
  };
  const toLonLat = v => [Math.atan2(v[1], v[0]) / DEG, Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dist = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)); // radians, robust
  // Great-circle interpolation. Near-antipodal pairs fall back to a stable
  // orthogonal axis so interpolation never produces NaN.
  function slerp(a, b, t) {
    const d = dot(a, b);
    const omega = Math.acos(Math.max(-1, Math.min(1, d)));
    if (omega < 1e-8) return a.slice();
    let axis = b;
    if (Math.PI - omega < 1e-6) {
      axis = norm(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
      const s = Math.sin(omega * t);
      return norm([a[0] * Math.cos(omega * t) + axis[0] * s, a[1] * Math.cos(omega * t) + axis[1] * s, a[2] * Math.cos(omega * t) + axis[2] * s]);
    }
    const s = Math.sin(omega);
    const wa = Math.sin((1 - t) * omega) / s, wb = Math.sin(t * omega) / s;
    return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
  }
  // Orthographic projection math (identical to d3.geoOrthographic with
  // rotate([-centerLon, -centerLat]); verified by a dev parity test).
  // state.rotation stores d3-style rotate angles [lambda0, phi0].
  function centerVec(rotation) { return toVec(-rotation[0], -rotation[1]); }
  function projectVec(v, rotation, scale, cx, cy) {
    const c = centerVec(rotation);
    // Build the tangent basis at the view center.
    const lonC = -rotation[0] * DEG, latC = -rotation[1] * DEG;
    const east = [-Math.sin(lonC), Math.cos(lonC), 0];
    const north = [-Math.sin(latC) * Math.cos(lonC), -Math.sin(latC) * Math.sin(lonC), Math.cos(latC)];
    const x = dot(v, east), y = dot(v, north);
    return [cx + scale * x, cy - scale * y, dot(v, c)]; // third value: cosc (visibility)
  }
  function project(lonlat, rotation, scale, cx, cy) {
    return projectVec(toVec(lonlat[0], lonlat[1]), rotation, scale, cx, cy);
  }
  // Inverse orthographic: screen px -> [lon, lat], or null outside the sphere.
  function invert(px, py, rotation, scale, cx, cy) {
    const dx = (px - cx) / scale, dy = (cy - py) / scale;
    const rho = Math.hypot(dx, dy);
    if (rho > 1) return null;
    const latC = -rotation[1] * DEG, lonC = -rotation[0] * DEG;
    if (rho < 1e-9) return [-rotation[0], -rotation[1]];
    const c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
    const lat = Math.asin(cc * Math.sin(latC) + (dy * sc * Math.cos(latC)) / rho);
    const lon = lonC + Math.atan2(dx * sc, rho * Math.cos(latC) * cc - dy * Math.sin(latC) * sc);
    return [lon / DEG, lat / DEG];
  }
  const visible = (v, rotation) => dot(v, centerVec(rotation)) > 1e-6;
  // Cross-track angular distance from point p to great circle through a,b.
  function crossTrack(p, a, b) {
    const n = norm(cross(a, b));
    return Math.asin(Math.max(-1, Math.min(1, Math.abs(dot(p, n)))));
  }
  return { DEG, toVec, toLonLat, dot, cross, norm, dist, slerp, centerVec, project, projectVec, invert, visible, crossTrack };
})();

/* Route objects are built ONCE from the union of all FLOWS pairs and
   reused for every period. Samples are dense enough (~1.2° steps) that
   horizon crossings can be refined by bisection for clean geographic
   clipping of the route lines themselves. */
const ROUTES = (() => {
  const pairs = new Map();
  for (const r of FLOWS) {
    const key = r.origin + ">" + r.destination;
    if (!pairs.has(key)) pairs.set(key, { origin: r.origin, destination: r.destination });
  }
  const routes = [];
  for (const [key, p] of [...pairs.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    const ca = COUNTRY_COORDS[p.origin], cb = COUNTRY_COORDS[p.destination];
    const a = Geo.toVec(ca.lon, ca.lat), b = Geo.toVec(cb.lon, cb.lat);
    const distRad = Geo.dist(a, b);
    const steps = Math.max(24, Math.ceil((distRad / Geo.DEG) / 1.2));
    const samples = [];
    for (let i = 0; i <= steps; i++) samples.push(Geo.slerp(a, b, i / steps));
    routes.push({
      key, origin: p.origin, destination: p.destination,
      a, b, distRad, distDeg: distRad / Geo.DEG, samples,
      // t in [0,1] along origin->destination. Input particles run 1-t.
      at: t => Geo.slerp(a, b, t),
      durationMs: (distRad / Geo.DEG) / 14 * 1000 // ~14°/s angular speed
    });
  }
  return routes;
})();
const ROUTE_BY_KEY = new Map(ROUTES.map(r => [r.key, r]));

/* ---------- Application state ---------- */
const state = {
  periodIdx: 0,
  playing: false, speed: 1, loop: true,
  selectedCountry: null, selectedRoute: null,
  hoverCountry: null, hoverRoute: null,
  showInput: true, showOutput: true, showRoutes: true, lowPower: false,
  autoRotate: true,
  rotation: [-60, -20],           // d3-style rotate; initial view: Indian Ocean rim
  rankMode: "consuming",
  partnerMode: "consumers",       // "consumers" | "servers"
  story: null,
  dragging: false,
  lastInteraction: 0,
  clock: 0,                       // particle animation time (ms), frozen when hidden/reduced
  lastFrameTs: 0,
  lastAdvanceTs: 0,
  fade: null,                     // { prev: Map(routeKey->volumes), t0 }
  spotlight: null,                // { from, to, t0 }
  frames: 0,
  reducedMotion: false, motionOverride: false, fatal: false,
  assets: { d3: false, topojson: false, atlas: false },
  fallback: null,                 // null | "d3" | "atlas" | "all"
  validation: null,
  baseDirty: true,
  lastBaseRotation: [NaN, NaN],
  pointer: { x: 0, y: 0, inside: false },
  ready: false
};
let PERIODS = [];

/* ---------- 8. RENDERING ----------
   Layered drawing:
     base offscreen canvas  — atmosphere, sphere, graticule, country fills,
                              borders, selected-country highlight. Rebuilt
                              only when rotation moves > 0.08°, selection
                              changes, or the viewport resizes (geometry is
                              never recomputed per particle frame).
     main canvas per frame  — cached base bitmap, geodesic route lines with
                              true horizon clipping, particles, hover marks.
   If D3 fails to load, a native-Canvas fallback draws the sphere and
   graticules with the same projection math (no country polygons). */
const el = id => document.getElementById(id);
const canvas = el("globe");
const ctx = canvas.getContext("2d");
const baseCanvas = document.createElement("canvas");
const bctx = baseCanvas.getContext("2d");
const view = { w: 0, h: 0, dpr: 1, scale: 100, cx: 0, cy: 0 };
let countryFeatures = new Map();   // ISO alpha-3 -> GeoJSON feature
let allFeatures = [];
let borderMesh = null;
let d3Projection = null;

function resize() {
  const stage = el("stage");
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w < 10 || h < 10) return;
  view.dpr = Math.min(window.devicePixelRatio || 1, state.lowPower ? CFG.dprCapLow : CFG.dprCap);
  view.w = w; view.h = h;
  view.scale = Math.min(w, h) / 2 - 26;
  view.cx = w / 2; view.cy = h / 2;
  canvas.width = Math.round(w * view.dpr); canvas.height = Math.round(h * view.dpr);
  baseCanvas.width = canvas.width; baseCanvas.height = canvas.height;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  state.baseDirty = true;
}

function setupGeography(topo) {
  const feats = window.topojson.feature(topo, topo.objects.countries).features;
  borderMesh = window.topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
  allFeatures = feats;
  for (const [code, numeric] of Object.entries(ISO_NUMERIC)) {
    const f = feats.find(f => String(f.id) === numeric || String(f.id) === String(parseInt(numeric, 10)));
    if (f) { f.properties = f.properties || {}; f.properties.iso = code; countryFeatures.set(code, f); }
  }
  // Natural Earth 1:110m omits city-states; use the embedded 1:50m outline.
  if (!countryFeatures.has("SGP")) {
    const sg = JSON.parse(JSON.stringify(SG_SUPPLEMENT));
    sg.id = "702";
    allFeatures.push(sg);
    countryFeatures.set("SGP", sg);
  }
}

/* Draw a geographic polyline with genuine hemisphere clipping: visible
   runs are stroked; horizon crossings are refined by bisection so lines
   end exactly at the limb instead of being chopped at sample points. */
function strokeGeoLine(c, samples, style, width) {
  const rot = state.rotation, sc = view.scale, cx = view.cx, cy = view.cy;
  const center = Geo.centerVec(rot);
  const proj = v => {
    const p = Geo.projectVec(v, rot, sc, cx, cy);
    return { x: p[0], y: p[1], vis: Geo.dot(v, center) > 0 };
  };
  const horizon = (v1, v2) => {
    let lo = 0, hi = 1;
    const d1 = Geo.dot(v1, center);
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const vm = Geo.slerp(v1, v2, mid);
      if ((Geo.dot(vm, center) > 0) === (d1 > 0)) lo = mid; else hi = mid;
    }
    return Geo.slerp(v1, v2, (lo + hi) / 2);
  };
  c.strokeStyle = style; c.lineWidth = width; c.lineCap = "round";
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      c.beginPath();
      c.moveTo(run[0].x, run[0].y);
      for (let i = 1; i < run.length; i++) c.lineTo(run[i].x, run[i].y);
      c.stroke();
    }
    run = [];
  };
  let prev = null;
  for (const v of samples) {
    const p = proj(v);
    if (prev && p.vis !== prev.vis) {
      const h = proj(horizon(prev.v, v));
      if (prev.vis) { run.push(h); flush(); }
      else { run = [h]; }
    }
    if (p.vis) run.push(p);
    prev = { ...p, v };
  }
  flush();
}

function rebuildBase() {
  const { w, h, dpr, scale, cx, cy } = view;
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.clearRect(0, 0, w, h);
  // Atmospheric halo — subtle, never obscures borders.
  const halo = bctx.createRadialGradient(cx, cy, scale * 0.97, cx, cy, scale * 1.09);
  halo.addColorStop(0, "rgba(63,154,224,0.14)");
  halo.addColorStop(0.45, "rgba(63,154,224,0.07)");
  halo.addColorStop(1, "rgba(63,154,224,0)");
  bctx.fillStyle = halo;
  bctx.beginPath(); bctx.arc(cx, cy, scale * 1.09, 0, Math.PI * 2); bctx.fill();
  // Ocean sphere with controlled lighting.
  const ocean = bctx.createRadialGradient(cx - scale * 0.3, cy - scale * 0.35, scale * 0.1, cx, cy, scale);
  ocean.addColorStop(0, "#152538");
  ocean.addColorStop(1, "#0E1927");
  bctx.fillStyle = ocean;
  bctx.beginPath(); bctx.arc(cx, cy, scale, 0, Math.PI * 2); bctx.fill();

  if (window.d3) {
    d3Projection = window.d3.geoOrthographic()
      .rotate(state.rotation).scale(scale).translate([cx, cy]).precision(0.4);
    const path = window.d3.geoPath(d3Projection, bctx);
    // Graticule
    bctx.beginPath(); path(window.d3.geoGraticule10());
    bctx.strokeStyle = CFG.colors.graticule; bctx.lineWidth = 0.5; bctx.stroke();
    if (state.assets.atlas && allFeatures.length) {
      // Country fills (one batched path)
      bctx.beginPath();
      for (const f of allFeatures) path(f);
      bctx.fillStyle = CFG.colors.countryFill; bctx.fill();
      // Borders
      if (borderMesh) {
        bctx.beginPath(); path(borderMesh);
        bctx.strokeStyle = "rgba(87,112,132,0.55)"; bctx.lineWidth = 0.6; bctx.stroke();
      }
      // Selected country highlight
      if (state.selectedCountry) {
        const f = countryFeatures.get(state.selectedCountry);
        if (f) {
          bctx.beginPath(); path(f);
          bctx.fillStyle = "#1D3348"; bctx.fill();
          bctx.beginPath(); path(f);
          bctx.strokeStyle = "rgba(192,232,255,0.18)"; bctx.lineWidth = 4; bctx.stroke();
          bctx.beginPath(); path(f);
          bctx.strokeStyle = CFG.colors.selection; bctx.lineWidth = 1.3; bctx.stroke();
        }
      }
    }
  } else {
    // Native-Canvas fallback: sphere outline + manual graticule.
    bctx.beginPath(); bctx.arc(cx, cy, scale, 0, Math.PI * 2);
    bctx.strokeStyle = "rgba(87,112,132,0.8)"; bctx.lineWidth = 1; bctx.stroke();
    const grat = [];
    for (let lon = -180; lon < 180; lon += 30) {
      const line = [];
      for (let lat = -87; lat <= 87; lat += 3) line.push(Geo.toVec(lon, lat));
      grat.push(line);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const line = [];
      for (let lon = -180; lon <= 180; lon += 3) line.push(Geo.toVec(lon, lat));
      grat.push(line);
    }
    for (const line of grat) strokeGeoLine(bctx, line, CFG.colors.graticule, 0.5);
    if (state.selectedCountry) drawReferenceRing(bctx, state.selectedCountry, CFG.colors.selection, 1.3);
  }
  state.baseDirty = false;
  state.lastBaseRotation = [state.rotation[0], state.rotation[1]];
}

function drawReferenceRing(c, code, color, width) {
  const cc = COUNTRY_COORDS[code];
  const p = Geo.project([cc.lon, cc.lat], state.rotation, view.scale, view.cx, view.cy);
  if (p[2] <= 0) return;
  c.beginPath(); c.arc(p[0], p[1], 6, 0, Math.PI * 2);
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}

/* ---------- Route lines ---------- */
function currentVolumes() { return Agg.routeVolumes(Agg.recordsFor(PERIODS[state.periodIdx])); }

function routeFocus(key) {
  const r = ROUTE_BY_KEY.get(key);
  if (state.selectedRoute) return key === state.selectedRoute ? 1 : 0.10;
  if (state.selectedCountry) return (r.origin === state.selectedCountry || r.destination === state.selectedCountry) ? 1 : 0.12;
  return 1;
}

function drawRoutes(now) {
  if (!state.showRoutes) return;
  const vols = currentVolumes();
  let fadeF = 1;
  if (state.fade) {
    fadeF = Math.min(1, (now - state.fade.t0) / CFG.crossfadeMs);
    fadeF = fadeF * fadeF * (3 - 2 * fadeF); // smoothstep
    if (fadeF >= 1) state.fade = null;
  }
  const keys = new Set(vols.keys());
  if (state.fade) for (const k of state.fade.prev.keys()) keys.add(k);
  let maxTotal = 1;
  for (const v of vols.values()) maxTotal = Math.max(maxTotal, v.total);
  for (const key of keys) {
    const route = ROUTE_BY_KEY.get(key);
    if (!route) continue;
    const cur = vols.get(key), prev = state.fade ? state.fade.prev.get(key) : null;
    const effTotal = (prev ? prev.total : 0) + ((cur ? cur.total : 0) - (prev ? prev.total : 0)) * fadeF;
    if (effTotal <= 0) continue;
    const focus = routeFocus(key);
    let alpha = (0.10 + 0.16 * Math.sqrt(effTotal / maxTotal)) * focus;
    let color = CFG.colors.route, width = 1;
    if (state.hoverRoute === key) { alpha = Math.max(alpha, 0.55); color = "159,196,224"; width = 1.4; }
    if (state.selectedRoute === key) { alpha = 0.75; color = "159,196,224"; width = 1.5; }
    if (alpha < 0.015) continue;
    strokeGeoLine(ctx, route.samples, "rgba(" + color + "," + alpha.toFixed(3) + ")", width);
    // Endpoint markers for inspected routes.
    if (state.hoverRoute === key || state.selectedRoute === key) {
      for (const v of [route.a, route.b]) {
        const p = Geo.projectVec(v, state.rotation, view.scale, view.cx, view.cy);
        if (p[2] > 0) {
          ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(192,232,255,0.9)"; ctx.fill();
        }
      }
    }
  }
}

/* ---------- 9. PARTICLE SYSTEM ----------
   A fixed pool of reusable particle objects (never allocated per frame).
   Allocation is recomputed only when period, filters or selection change.
   Position is time-based: t = (clock / duration + phase) mod 1, with the
   input stream running the route in reverse (destination -> origin). */
const particlePool = Array.from({ length: CFG.particleBudget }, () => ({
  active: false, key: "", route: null, dir: "out", phase: 0, duration: 1, radius: 1, color: CFG.colors.output
}));
let allocation = new Map();
let activeStreamList = [];

function relevantRoute(route) {
  if (state.selectedRoute) return route.key === state.selectedRoute;
  if (state.selectedCountry) return route.origin === state.selectedCountry || route.destination === state.selectedCountry;
  return true;
}

function updateAllocation() {
  const vols = currentVolumes();
  const streams = [];
  for (const route of ROUTES) {
    const v = vols.get(route.key);
    if (!v || !relevantRoute(route)) continue;
    if (state.showInput && v.input > 0) streams.push({ key: route.key + "|in", routeKey: route.key, dir: "in", volume: v.input });
    if (state.showOutput && v.output > 0) streams.push({ key: route.key + "|out", routeKey: route.key, dir: "out", volume: v.output });
  }
  streams.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  activeStreamList = streams;
  const budget = state.lowPower ? CFG.particleBudgetLow : CFG.particleBudget;
  allocation = allocateParticles(streams, budget);
  const maxVolume = streams.reduce((m, s) => Math.max(m, s.volume), 0);
  let idx = 0;
  for (const s of streams) {
    const count = allocation.get(s.key) || 0;
    const route = ROUTE_BY_KEY.get(s.routeKey);
    const radius = particleRadius(s.volume, maxVolume);
    const color = s.dir === "in" ? CFG.colors.input : CFG.colors.output;
    for (let i = 0; i < count && idx < particlePool.length; i++, idx++) {
      const p = particlePool[idx];
      p.active = true; p.key = s.key; p.route = route; p.dir = s.dir;
      p.phase = (i + 0.5) / count; p.duration = route.durationMs;
      p.radius = radius; p.color = color;
    }
  }
  for (; idx < particlePool.length; idx++) particlePool[idx].active = false;
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const rot = state.rotation, sc = view.scale, cx = view.cx, cy = view.cy;
  const center = Geo.centerVec(rot);
  const tails = !state.lowPower;
  for (const p of particlePool) {
    if (!p.active) continue;
    let t = ((state.clock / p.duration) + p.phase) % 1;
    const geoT = p.dir === "in" ? 1 - t : t;
    const v = p.route.at(geoT);
    if (Geo.dot(v, center) <= 1e-6) continue; // behind the Earth: hidden immediately
    const pos = Geo.projectVec(v, rot, sc, cx, cy);
    const rgb = p.dir === "in" ? "89,201,245" : "255,181,107";
    if (tails) {
      const tailAlphas = [0.30, 0.18, 0.09];
      for (let k = 1; k <= 3; k++) {
        let tt = t - k * 0.013;
        if (tt < 0) break; // tail truncates at the route endpoint, never wraps
        const gv = p.route.at(p.dir === "in" ? 1 - tt : tt);
        if (Geo.dot(gv, center) <= 1e-6) break;
        const tp = Geo.projectVec(gv, rot, sc, cx, cy);
        ctx.beginPath(); ctx.arc(tp[0], tp[1], p.radius * 0.72, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + rgb + "," + tailAlphas[k - 1] + ")"; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(pos[0], pos[1], p.radius * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + rgb + ",0.13)"; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(pos[0], pos[1], p.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(" + rgb + ",0.95)"; ctx.fill();
  }
  ctx.restore();
}

function drawHoverCountry() {
  const code = state.hoverCountry;
  if (!code || code === state.selectedCountry) return;
  if (window.d3 && state.assets.atlas) {
    const f = countryFeatures.get(code);
    if (!f) return;
    const proj = window.d3.geoOrthographic().rotate(state.rotation).scale(view.scale).translate([view.cx, view.cy]);
    const path = window.d3.geoPath(proj, ctx);
    ctx.beginPath(); path(f);
    ctx.strokeStyle = "rgba(192,232,255,0.5)"; ctx.lineWidth = 1; ctx.stroke();
  } else {
    drawReferenceRing(ctx, code, "rgba(192,232,255,0.6)", 1);
  }
}

/* ---------- Frame loop ---------- */
let rafId = null;
function frame(ts) {
  rafId = requestAnimationFrame(frame);
  const dt = state.lastFrameTs ? Math.min(ts - state.lastFrameTs, 100) : 16;
  state.lastFrameTs = ts;
  if (!state.ready) return;

  // Spotlight transition (elegant, quick, cancellable by drag).
  if (state.spotlight) {
    const s = state.spotlight;
    const f = Math.min(1, (ts - s.t0) / CFG.spotlightMs);
    const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    state.rotation = [s.from[0] + (s.to[0] - s.from[0]) * e, s.from[1] + (s.to[1] - s.from[1]) * e];
    if (f >= 1) state.spotlight = null;
  }

  // Slow auto-rotation; paused while dragging, spotlighting, inspecting,
  // or shortly after any interaction. Disabled under reduced motion.
  const inspecting = state.pointer.inside && (state.hoverRoute || state.hoverCountry);
  if (state.autoRotate && (!state.reducedMotion || state.motionOverride) && !state.dragging && !state.spotlight && !inspecting &&
      ts - state.lastInteraction > CFG.idleResumeMs) {
    state.rotation[0] += CFG.autoRotateDegPerSec * dt / 1000;
    if (state.rotation[0] > 180) state.rotation[0] -= 360;
  }

  // Playback advances through real FLOWS periods only.
  if (state.playing && ts - state.lastAdvanceTs >= CFG.playbackBaseMs / state.speed) {
    state.lastAdvanceTs = ts;
    advancePeriod(1, true);
  }

  if (!state.reducedMotion) state.clock += dt;

  const rotMoved = Math.abs(state.rotation[0] - state.lastBaseRotation[0]) > 0.08 ||
                   Math.abs(state.rotation[1] - state.lastBaseRotation[1]) > 0.08;
  if (state.baseDirty || rotMoved || state.dragging) rebuildBase();

  ctx.clearRect(0, 0, view.w, view.h);
  ctx.drawImage(baseCanvas, 0, 0, view.w, view.h);
  drawRoutes(ts);
  drawParticles();
  drawHoverCountry();
  state.frames++;
}

function startLoop() { if (rafId === null) { state.lastFrameTs = 0; rafId = requestAnimationFrame(frame); } }
function stopLoop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }

/* ---------- 10. FORMATTING ---------- */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function periodLabel(p) { const [y, m] = p.split("-"); return MONTHS[parseInt(m, 10) - 1] + " " + y; }
function periodShort(p) { const [y, m] = p.split("-"); return MONTHS[parseInt(m, 10) - 1].slice(0, 3).toUpperCase() + " " + y; }
function fmtCompact(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
const fmtExact = n => n.toLocaleString("en-US");
const fmtPct = x => (x >= 9.95 ? x.toFixed(1) : x.toFixed(2)) + "%";

/* ---------- 11. HIT TESTING ---------- */
function countryAtLonLat(lonlat) {
  const p = Geo.toVec(lonlat[0], lonlat[1]);
  if (window.d3 && state.assets.atlas) {
    for (const [code, f] of countryFeatures) {
      if (window.d3.geoContains(f, lonlat)) return code;
    }
    // Small-state assist: Singapore is a few px wide at globe scale.
    const sg = COUNTRY_COORDS.SGP;
    const threshold = Math.max(0.9 * Geo.DEG, 7 / view.scale);
    if (Geo.dist(p, Geo.toVec(sg.lon, sg.lat)) < threshold) return "SGP";
    return null;
  }
  // Fallback without polygons: nearest reference point within a generous
  // angular threshold (clearly an approximation, explained in the notice).
  let best = null, bestD = Infinity;
  const threshold = Math.max(1.5 * Geo.DEG, 10 / view.scale);
  for (const [code, c] of Object.entries(COUNTRY_COORDS)) {
    const d = Geo.dist(p, Geo.toVec(c.lon, c.lat));
    if (d < threshold && d < bestD) { best = code; bestD = d; }
  }
  return best;
}

function routeAtScreen(px, py) {
  const ll = Geo.invert(px, py, state.rotation, view.scale, view.cx, view.cy);
  if (!ll) return null;
  const p = Geo.toVec(ll[0], ll[1]);
  const threshold = 6 / view.scale; // ~6px cross-track tolerance
  const vols = currentVolumes();
  let best = null, bestCt = Infinity;
  for (const route of ROUTES) {
    if (!vols.has(route.key) || !relevantRoute(route)) continue;
    const ct = Geo.crossTrack(p, route.a, route.b);
    if (ct >= threshold) continue;
    const along = Geo.dist(route.a, p) + Geo.dist(p, route.b) - route.distRad;
    if (along < 0.04 && ct < bestCt) { best = route.key; bestCt = ct; }
  }
  return best;
}

/* ---------- 12. TOOLTIPS ---------- */
const tooltip = el("tooltip");
function positionTooltip(clientX, clientY) {
  const pad = 8, off = 16;
  const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
  let left = clientX + off, top = clientY + off;
  if (left + w > window.innerWidth - pad) left = clientX - w - off;
  if (top + h > window.innerHeight - pad) top = clientY - h - off;
  tooltip.style.left = Math.max(pad, left) + "px";
  tooltip.style.top = Math.max(pad, top) + "px";
}
function showRouteTooltip(key, clientX, clientY) {
  const v = currentVolumes().get(key);
  if (!v) { hideTooltip(); return; }
  const so = COUNTRY_COORDS[v.origin].name, de = COUNTRY_COORDS[v.destination].name;
  const period = PERIODS[state.periodIdx];
  tooltip.innerHTML =
    '<div class="tt-title">' + so.toUpperCase() + " &rarr; " + de.toUpperCase() + "</div>" +
    '<div class="tt-sub">Serving: ' + so + " &middot; Consumption: " + de + "</div>" +
    '<div class="tt-row"><span class="k"><span class="dot in"></span>Prompt tokens</span><span class="v" title="' + fmtExact(v.input) + ' tokens">' + fmtCompact(v.input) + "</span></div>" +
    '<div class="tt-dir"><span class="dot in"></span>travels ' + de + " &rarr; " + so + " (reverse)</div>" +
    '<div class="tt-row"><span class="k"><span class="dot out"></span>Generated tokens</span><span class="v" title="' + fmtExact(v.output) + ' tokens">' + fmtCompact(v.output) + "</span></div>" +
    '<div class="tt-dir"><span class="dot out"></span>travels ' + so + " &rarr; " + de + "</div>" +
    '<div class="tt-row total"><span class="k">Total associated</span><span class="v" title="' + fmtExact(v.total) + ' tokens">' + fmtCompact(v.total) + "</span></div>" +
    '<div class="tt-foot">Period: ' + periodLabel(period) + " &middot; Synthetic demonstration</div>";
  tooltip.classList.add("active");
  tooltip.setAttribute("aria-hidden", "false");
  positionTooltip(clientX, clientY);
}
function showCountryTooltip(code, clientX, clientY) {
  const recs = Agg.recordsFor(PERIODS[state.periodIdx]);
  const m = Agg.countryMetrics(code, recs);
  const c = COUNTRY_COORDS[code];
  tooltip.innerHTML =
    '<div class="tt-title">' + c.name.toUpperCase() + ' <span class="mono" style="color:var(--text-muted)">' + code + "</span></div>" +
    '<div class="tt-row"><span class="k">As serving country</span><span class="v">' + fmtCompact(m.serving.total) + "</span></div>" +
    '<div class="tt-row"><span class="k">As consuming country</span><span class="v">' + fmtCompact(m.consuming.total) + "</span></div>" +
    '<div class="tt-foot">Click to explore &middot; ' + periodLabel(PERIODS[state.periodIdx]) + "</div>";
  tooltip.classList.add("active");
  tooltip.setAttribute("aria-hidden", "false");
  positionTooltip(clientX, clientY);
}
function hideTooltip() {
  tooltip.classList.remove("active");
  tooltip.setAttribute("aria-hidden", "true");
}

/* ---------- 13. SELECTION & SPOTLIGHT ---------- */
function announce(msg) { el("sr-status").textContent = msg; }

function spotlightTo(lon, lat) {
  const target = [-lon, Math.max(-89.9, Math.min(89.9, -lat))];
  const from = [state.rotation[0], state.rotation[1]];
  const delta = ((target[0] - from[0] + 540) % 360) - 180; // shortest path
  const to = [from[0] + delta, target[1]];
  if (state.reducedMotion) { state.rotation = to; state.baseDirty = true; return; }
  state.spotlight = { from, to, t0: performance.now() };
}

function selectCountry(code, withSpotlight = true) {
  state.selectedCountry = code;
  state.selectedRoute = null;
  state.story = null;
  el("story").classList.remove("active");
  state.baseDirty = true;
  updateAllocation();
  refreshUI();
  hideTooltip();
  if (withSpotlight) { const c = COUNTRY_COORDS[code]; spotlightTo(c.lon, c.lat); }
  announce("Selected " + COUNTRY_COORDS[code].name + ". Country intelligence updated for " + periodLabel(PERIODS[state.periodIdx]) + ".");
}
function selectRoute(key) {
  const r = ROUTE_BY_KEY.get(key);
  state.selectedRoute = key;
  if (state.selectedCountry && r.origin !== state.selectedCountry && r.destination !== state.selectedCountry)
    state.selectedCountry = null;
  state.story = null;
  el("story").classList.remove("active");
  state.baseDirty = true;
  updateAllocation();
  refreshUI();
  announce("Inspecting route " + COUNTRY_COORDS[r.origin].name + " to " + COUNTRY_COORDS[r.destination].name + ".");
}
function clearSelections() {
  state.selectedCountry = null;
  state.selectedRoute = null;
  state.baseDirty = true;
  updateAllocation();
  refreshUI();
  hideTooltip();
  announce("Selection cleared.");
}

/* ---------- 14. POINTER & KEYBOARD INTERACTION ---------- */
let dragStart = null, lastHoverTs = 0, touchTooltipTimer = null;

canvas.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  dragStart = { x: e.clientX, y: e.clientY, moved: 0 };
  state.dragging = true;
  state.spotlight = null;
  state.lastInteraction = performance.now();
  hideTooltip();
  canvas.style.cursor = "grabbing";
  e.preventDefault();
});

canvas.addEventListener("pointermove", e => {
  const rect = canvas.getBoundingClientRect();
  state.pointer.x = e.clientX - rect.left;
  state.pointer.y = e.clientY - rect.top;
  state.pointer.inside = true;
  if (state.dragging && dragStart) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    dragStart.x = e.clientX; dragStart.y = e.clientY;
    dragStart.moved += Math.abs(dx) + Math.abs(dy);
    const k = 60 / view.scale; // degrees per pixel, scaled to globe size
    state.rotation[0] += dx * k;
    if (state.rotation[0] > 180) state.rotation[0] -= 360;
    if (state.rotation[0] < -180) state.rotation[0] += 360;
    state.rotation[1] = Math.max(-89.9, Math.min(89.9, state.rotation[1] - dy * k));
    state.baseDirty = true;
    state.lastInteraction = performance.now();
    return;
  }
  const now = performance.now();
  if (now - lastHoverTs < 33) return; // throttle hover hit-testing to ~30Hz
  lastHoverTs = now;
  const rk = routeAtScreen(state.pointer.x, state.pointer.y);
  const ll = Geo.invert(state.pointer.x, state.pointer.y, state.rotation, view.scale, view.cx, view.cy);
  const ck = (!rk && ll) ? countryAtLonLat(ll) : null;
  const changed = rk !== state.hoverRoute || ck !== state.hoverCountry;
  state.hoverRoute = rk;
  state.hoverCountry = ck;
  canvas.style.cursor = (rk || ck) ? "pointer" : "grab";
  if (rk) showRouteTooltip(rk, e.clientX, e.clientY);
  else if (ck) showCountryTooltip(ck, e.clientX, e.clientY);
  else if (changed) hideTooltip();
  if (rk || ck) state.lastInteraction = now; // pause auto-rotate while inspecting
});

function endDrag(e) {
  if (!state.dragging) return;
  state.dragging = false;
  canvas.style.cursor = "grab";
  state.lastInteraction = performance.now();
  const wasClick = dragStart && dragStart.moved < 6;
  dragStart = null;
  if (!wasClick) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const rk = routeAtScreen(x, y);
  if (rk) {
    if (state.selectedRoute === rk) { state.selectedRoute = null; updateAllocation(); refreshUI(); }
    else selectRoute(rk);
    if (e.pointerType === "touch") {
      showRouteTooltip(rk, e.clientX, e.clientY);
      clearTimeout(touchTooltipTimer);
      touchTooltipTimer = setTimeout(hideTooltip, 3500);
    }
    return;
  }
  const ll = Geo.invert(x, y, state.rotation, view.scale, view.cx, view.cy);
  const ck = ll ? countryAtLonLat(ll) : null;
  if (ck) {
    if (state.selectedCountry === ck) clearSelections();
    else selectCountry(ck);
  } else if (ll) {
    clearSelections(); // ocean click clears
  }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", e => { state.dragging = false; dragStart = null; canvas.style.cursor = "grab"; });
canvas.addEventListener("pointerleave", () => {
  state.pointer.inside = false;
  state.hoverRoute = null; state.hoverCountry = null;
  if (!state.dragging) hideTooltip();
});

canvas.addEventListener("keydown", e => {
  const step = e.shiftKey ? 12 : 4;
  let handled = true;
  switch (e.key) {
    case "ArrowLeft": state.rotation[0] += step; break;
    case "ArrowRight": state.rotation[0] -= step; break;
    case "ArrowUp": state.rotation[1] = Math.max(-89.9, state.rotation[1] - step); break;
    case "ArrowDown": state.rotation[1] = Math.min(89.9, state.rotation[1] + step); break;
    case "Home": state.rotation = [-60, -20]; break;
    case "Enter": if (state.hoverCountry) selectCountry(state.hoverCountry); else handled = false; break;
    default: handled = false;
  }
  if (handled) {
    if (state.rotation[0] > 180) state.rotation[0] -= 360;
    if (state.rotation[0] < -180) state.rotation[0] += 360;
    state.baseDirty = true;
    state.lastInteraction = performance.now();
    e.preventDefault();
    e.stopPropagation();
  }
});

document.addEventListener("keydown", e => {
  if (e.target && e.target.closest && e.target.closest("input, select, textarea, button, a")) return;
  if (e.target === canvas) return; // canvas handles its own arrows
  if (e.code === "Space") { togglePlay(); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { stepPeriod(-1); e.preventDefault(); }
  else if (e.key === "ArrowRight") { stepPeriod(1); e.preventDefault(); }
  else if (e.key === "r" || e.key === "R") { setAutoRotate(!state.autoRotate); }
  else if (e.key === "Escape") {
    if (el("methodology").open) toggleMethod(false);
    else if (state.selectedCountry || state.selectedRoute) clearSelections();
    else if (state.story) dismissStory();
  }
});

/* ---------- 15. UI UPDATES ----------
   Every displayed number is derived from the current period's FLOWS subset
   through the single Aggregation layer. DOM writes are cached/minimised. */
let lastRankSig = "", lastClient = { x: 0, y: 0 };

function setStat(id, text, exactTitle) {
  const node = el(id);
  if (node.textContent !== text) node.textContent = text;
  if (exactTitle) node.title = exactTitle;
}
function metricRow(label, value, cls, exact) {
  return '<div class="metric"><span>' + label + '</span><span class="val ' + (cls || "") +
    '"' + (exact ? ' title="' + fmtExact(exact) + ' tokens"' : "") + '>' + value + '</span></div>';
}
function rankRowHtml(row, max) {
  const pctW = max > 0 ? (row.total / max * 100).toFixed(1) : "0.0";
  return '<li><button type="button" class="rank-row" data-code="' + row.code + '" title="' +
    fmtExact(row.total) + ' tokens">' +
    '<span class="rank-num">' + String(row.rank).padStart(2, "0") + '</span>' +
    '<span class="rank-mid"><span class="rank-name">' + row.name + '</span>' +
    '<span class="rank-bar"><span style="width:' + pctW + '%"></span></span></span>' +
    '<span class="rank-right"><span class="rank-val">' + fmtCompact(row.total) + '</span>' +
    '<span class="rank-share">' + fmtPct(row.share * 100) + '</span></span></button></li>';
}
function renderPartnerList(code, recs) {
  const list = el("partner-list");
  if (!list) return;
  const rows = Agg.partners(code, recs, state.partnerMode);
  const max = rows.length ? rows[0].total : 0;
  list.innerHTML = rows.map(r => rankRowHtml(r, max)).join("");
  const note = el("partner-note");
  if (note) note.textContent = state.partnerMode === "consumers"
    ? "Countries consuming from " + COUNTRY_COORDS[code].name + " · share of that country's serving total"
    : "Countries serving " + COUNTRY_COORDS[code].name + " · share of that country's consumption total";
}
function renderIntel(code, recs) {
  const m = Agg.countryMetrics(code, recs);
  const name = COUNTRY_COORDS[code].name;
  el("intel").innerHTML =
    '<div class="intel-block">' +
      '<h3>Serving activity — ' + name + '</h3>' +
      '<div class="intel-metrics">' +
        metricRow("Output tokens served to others", fmtCompact(m.serving.outputServed), "amber", m.serving.outputServed) +
        metricRow("Input tokens received as server", fmtCompact(m.serving.inputReceived), "cyan", m.serving.inputReceived) +
        metricRow("Associated serving volume", fmtCompact(m.serving.total), "", m.serving.total) +
        metricRow("Consuming partners", String(m.serving.partners)) +
      '</div>' +
    '</div>' +
    '<div class="intel-block">' +
      '<h3>Consumption activity — ' + name + '</h3>' +
      '<div class="intel-metrics">' +
        metricRow("Output tokens received as consumer", fmtCompact(m.consuming.outputReceived), "amber", m.consuming.outputReceived) +
        metricRow("Input tokens sent to servers", fmtCompact(m.consuming.inputSent), "cyan", m.consuming.inputSent) +
        metricRow("Associated consumption volume", fmtCompact(m.consuming.total), "", m.consuming.total) +
        metricRow("Serving partners", String(m.consuming.partners)) +
      '</div>' +
    '</div>' +
    '<div class="intel-block">' +
      '<h3>Partner rankings</h3>' +
      '<div class="seg" role="group" aria-label="Partner ranking mode" id="partner-seg">' +
        '<button type="button" data-mode="consumers" aria-pressed="' + (state.partnerMode === "consumers") + '">Consuming</button>' +
        '<button type="button" data-mode="servers" aria-pressed="' + (state.partnerMode === "servers") + '">Serving</button>' +
      '</div>' +
      '<ol id="partner-list"></ol><p class="rank-note" id="partner-note"></p>' +
    '</div>';
  renderPartnerList(code, recs);
}
function renderInspector(recs) {
  const key = state.selectedRoute;
  if (!key) { el("inspector").classList.remove("active"); return; }
  const v = Agg.routeVolumes(recs).get(key);
  if (!v) { el("inspector").classList.remove("active"); return; }
  el("inspector").innerHTML =
    '<div class="intel-block">' +
      '<h3>Route inspector</h3>' +
      '<p class="inspector-route">' + COUNTRY_COORDS[v.origin].name + ' → ' + COUNTRY_COORDS[v.destination].name + '</p>' +
      '<div class="intel-metrics">' +
        metricRow("Serving country", v.origin) +
        metricRow("Consuming country", v.destination) +
        metricRow("Prompt tokens (consumer → server)", fmtCompact(v.input), "cyan", v.input) +
        metricRow("Generated tokens (server → consumer)", fmtCompact(v.output), "amber", v.output) +
        metricRow("Total associated", fmtCompact(v.total), "", v.total) +
      '</div>' +
      '<button type="button" class="mini-btn" data-clear-route>Close route ✕</button>' +
    '</div>';
  el("inspector").classList.add("active");
}
function renderBalance(t) {
  const pctIn = t.total > 0 ? t.input / t.total * 100 : 0;
  el("balance").innerHTML =
    '<div class="intel-block"><h3>Prompt vs completion · ' + periodLabel(PERIODS[state.periodIdx]) + '</h3>' +
    '<div class="balance-bar"><span class="in" style="width:' + pctIn.toFixed(2) + '%"></span>' +
    '<span class="out" style="width:' + (100 - pctIn).toFixed(2) + '%"></span></div>' +
    '<div class="intel-metrics">' +
      metricRow("Input / prompt", fmtCompact(t.input) + " · " + fmtPct(pctIn), "cyan", t.input) +
      metricRow("Output / generated", fmtCompact(t.output) + " · " + fmtPct(100 - pctIn), "amber", t.output) +
    '</div><p class="rank-note">Synthetic demonstration values, not measured traffic.</p></div>';
  el("balance").classList.add("active");
}
function refreshUI() {
  const period = PERIODS[state.periodIdx];
  const recs = Agg.recordsFor(period);
  const t = Agg.totals(recs);
  const activeCodes = new Set();
  for (const r of recs) { activeCodes.add(r.origin); activeCodes.add(r.destination); }
  setStat("stat-total", fmtCompact(t.total), fmtExact(t.total) + " tokens · synthetic demonstration");
  setStat("stat-input", fmtCompact(t.input), fmtExact(t.input) + " tokens · consumer to server");
  setStat("stat-output", fmtCompact(t.output), fmtExact(t.output) + " tokens · server to consumer");
  setStat("stat-routes", String(Agg.routeVolumes(recs).size), "Bilateral relationships in this synthetic period");
  setStat("stat-countries", String(activeCodes.size), "Countries represented in this synthetic period");
  setStat("stat-total-sub", "input + output · " + recs.length + " records");
  el("period-chip").textContent = periodShort(period);
  el("period-display").innerHTML = periodLabel(period).toUpperCase() + "<small>PERIOD</small>";
  el("slider").value = String(state.periodIdx);
  el("ticks").querySelectorAll("span").forEach((n, i) => {
    n.classList.toggle("current", i === state.periodIdx);
    n.setAttribute("aria-current", i === state.periodIdx ? "true" : "false");
  });
  el("btn-clear").hidden = !state.selectedCountry && !state.selectedRoute;
  el("btn-spotlight").hidden = !state.selectedCountry;
  el("country-jump").value = state.selectedCountry || "";
  el("panel-title").textContent = state.selectedCountry ? COUNTRY_COORDS[state.selectedCountry].name : "Network overview";
  el("panel-code").textContent = state.selectedCountry || "";
  el("panel-code").hidden = !state.selectedCountry;
  if (state.selectedCountry) {
    renderIntel(state.selectedCountry, recs);
    el("intel").classList.add("active");
  } else {
    el("intel").classList.remove("active");
    el("intel").innerHTML = "";
  }
  renderInspector(recs);
  renderBalance(t);
  const rows = Agg.rankings(recs, state.rankMode, 8);
  const sig = state.rankMode + "|" + period + "|" + rows.map(r => r.code + ":" + r.total).join(",");
  if (sig !== lastRankSig) {
    lastRankSig = sig;
    const max = rows.length ? rows[0].total : 0;
    el("rank-list").innerHTML = rows.map(r => rankRowHtml(r, max)).join("");
    el("rank-note").textContent = state.rankMode === "consuming"
      ? "Top AI consuming destinations · associated synthetic token volume · share of period total"
      : "Top AI serving countries · associated synthetic token volume · share of period total";
  }
  el("rank-consuming").setAttribute("aria-pressed", String(state.rankMode === "consuming"));
  el("rank-serving").setAttribute("aria-pressed", String(state.rankMode === "serving"));
  el("tg-input").checked = state.showInput;
  el("tg-output").checked = state.showOutput;
  el("tg-routes").checked = state.showRoutes;
  el("tg-power").checked = state.lowPower;
  el("btn-play").setAttribute("aria-pressed", String(state.playing));
  el("btn-play").setAttribute("aria-label", state.playing ? "Pause period playback" : "Play period playback");
  el("play-icon").innerHTML = state.playing
    ? '<path d="M3.4 2.4h2.5v9.2H3.4zM8.1 2.4h2.5v9.2H8.1z"/>'
    : '<path d="M4 2.2v9.6L11.6 7 4 2.2z"/>';
  el("btn-loop").setAttribute("aria-pressed", String(state.loop));
  el("btn-rotate").setAttribute("aria-pressed", String(state.autoRotate));
  el("speed").value = String(state.speed);
}

/* ---------- 16. TIME EXPLORER ---------- */
function setPeriod(index, announceChange = true) {
  if (index < 0 || index >= PERIODS.length || index === state.periodIdx) return;
  state.periodIdx = index;
  state.fade = 1;
  hideTooltip();
  updateAllocation();
  refreshUI();
  if (announceChange) announce("Period " + periodLabel(PERIODS[index]) + ". All statistics and rankings updated.");
}
function stepPeriod(delta) { setPeriod(state.periodIdx + delta); }
function advancePeriod() {
  if (state.periodIdx + 1 < PERIODS.length) setPeriod(state.periodIdx + 1, false);
  else if (state.loop) setPeriod(0, false);
  else { state.playing = false; refreshUI(); announce("Playback finished at " + periodLabel(PERIODS[state.periodIdx]) + "."); }
}
function togglePlay() {
  state.playing = !state.playing;
  state.lastFrameTs = 0;
  refreshUI();
  announce(state.playing ? "Playing demonstration periods." : "Playback paused.");
}
function setAutoRotate(on) {
  state.autoRotate = !!on;
  if (on) state.motionOverride = true;
  state.lastInteraction = performance.now();
  refreshUI();
  announce(state.autoRotate ? "Automatic globe rotation on." : "Automatic globe rotation off.");
}
function toggleMethod(show) {
  const d = el("methodology");
  const open = typeof show === "boolean" ? show : !d.open;
  if (open && !d.open) d.showModal();
  else if (!open && d.open) d.close();
  el("btn-info").setAttribute("aria-expanded", String(open));
}

/* ---------- 17. GUIDED EXPLORATIONS ---------- */
function dismissStory() {
  state.story = null;
  el("story").classList.remove("active");
}
function runStory(id) {
  const last = PERIODS.length - 1;
  if (id === "india") {
    if (state.periodIdx !== last) setPeriod(last, false);
    selectCountry("IND", true);
    state.story = "india";
    el("story-title").textContent = "01 — Follow an AI request from India";
    el("story-text").textContent = "India appears as both serving country and consuming destination in this synthetic network. Use the serving/consumption metrics and partner rankings to see how the same country can play both roles. " + fmtCompact(Agg.countryMetrics("IND", Agg.recordsFor(PERIODS[state.periodIdx])).serving.total) + " associated synthetic tokens involve India as server in " + periodLabel(PERIODS[state.periodIdx]) + ".";
  } else if (id === "hubs") {
    if (state.periodIdx !== last) setPeriod(last, false);
    clearSelections();
    state.rankMode = "serving";
    state.story = "hubs";
    el("story-title").textContent = "02 — Explore the major serving hubs";
    el("story-text").textContent = "The serving ranking shows where synthetic inference is modelled as being served. These are fictional relationships, not verified data-centre locations.";
    refreshUI();
  } else if (id === "consumers") {
    if (state.periodIdx !== last) setPeriod(last, false);
    clearSelections();
    state.rankMode = "consuming";
    state.story = "consumers";
    el("story-title").textContent = "03 — Compare leading consumption destinations";
    el("story-text").textContent = "Ranked by total associated synthetic token volume grouped by consuming country. This is a modelling convention, not a measurement of national AI demand.";
    refreshUI();
  } else if (id === "balance") {
    if (state.periodIdx !== last) setPeriod(last, false);
    state.story = "balance";
    el("story-title").textContent = "04 — Prompt vs completion token balance";
    el("story-text").textContent = "Cyan particles represent prompt tokens travelling consumer → server. Amber particles represent generated tokens travelling server → consumer. Particle size and density encode relative volume under a square-root scale.";
  }
  el("story").classList.add("active");
  announce("Guided exploration started. " + el("story-title").textContent);
}

/* ---------- 18. GEOGRAPHIC ASSET LOADING & FAILURE HANDLING ---------- */
const ATLAS_URLS = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
  "https://unpkg.com/world-atlas@2.0.2/countries-110m.json"
];
async function fetchAtlas() {
  let lastError = "";
  for (const url of ATLAS_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status + " from " + url);
      const topo = await res.json();
      if (!topo || !topo.objects || !topo.objects.countries || !Array.isArray(topo.arcs))
        throw new Error("Unexpected TopoJSON structure from " + url);
      setupGeography(topo);
      state.assets.atlas = true;
      state.baseDirty = true;
      return true;
    } catch (err) {
      clearTimeout(timer);
      lastError = err && err.name === "AbortError" ? "timed out after 15 seconds" : (err && err.message ? err.message : String(err));
    }
  }
  state.assets.atlas = false;
  state.geoError = "Country boundaries could not be loaded (" + lastError + "). The globe shows the sphere, graticules, country reference markers, routes and all synthetic statistics, but geographic outline detail is unavailable.";
  return false;
}
const LOAD_NOTICE = "Internet access is required to load the geographic map and rendering libraries.";
function showNotice(msg) {
  el("stage-notice").textContent = msg;
  el("stage-notice").hidden = false;
  console.warn("[Global AI Observatory] " + msg);
}
function showFatal(msg) {
  state.fatal = true;
  stopLoop();
  const l = el("loading");
  l.hidden = false;
  l.innerHTML = '<div style="font-family:var(--font-mono);font-size:12px;letter-spacing:.18em;color:var(--output-amber);margin-bottom:12px">OBSERVATORY COULD NOT START</div>' +
    '<pre style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;max-width:540px;text-align:left">' + escapeHtml(msg) + '</pre>' +
    '<div class="disclaimer" style="border:0;padding:0;margin-top:16px"><span class="dot"></span>Synthetic demo data, not measured international token traffic</div>';
  ["summary", "panel", "timeline"].forEach(id => { el(id).style.display = "none"; });
}

/* ---------- 19. DEVELOPMENT VALIDATION ---------- */
function runValidation() {
  const failures = [];
  let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); };
  for (const period of PERIODS) {
    const recs = Agg.recordsFor(period);
    const t = Agg.totals(recs);
    let sumIn = 0, sumOut = 0;
    for (const r of recs) { sumIn += r.inputTokens; sumOut += r.outputTokens; }
    ok(t.input === sumIn, period + ": input total does not equal record sum");
    ok(t.output === sumOut, period + ": output total does not equal record sum");
    ok(t.total === sumIn + sumOut, period + ": combined total is not input + output");
    const byOrigin = [...Agg.byOrigin(recs).values()].reduce((a, g) => a + g.total, 0);
    const byDest = [...Agg.byDestination(recs).values()].reduce((a, g) => a + g.total, 0);
    ok(byOrigin === t.total, period + ": serving groups do not reconcile");
    ok(byDest === t.total, period + ": consuming groups do not reconcile");
    const ranks = Agg.rankings(recs, "consuming");
    ok(ranks.reduce((a, r) => a + r.total, 0) === t.total, period + ": consuming ranking does not reconcile");
    const servingRanks = Agg.rankings(recs, "serving");
    ok(servingRanks.reduce((a, r) => a + r.total, 0) === t.total, period + ": serving ranking does not reconcile");
    for (const r of ranks) {
      const m = Agg.countryMetrics(r.code, recs);
      ok(m.consuming.total === r.total, period + ": partner metrics disagree for " + r.code);
    }
    // Particle allocation from the same filtered route volumes as the renderer.
    const rv = Agg.routeVolumes(recs);
    const streams = [];
    for (const [key, v] of rv) {
      if (v.input > 0) streams.push({ key: key + "|in", volume: v.input });
      if (v.output > 0) streams.push({ key: key + "|out", volume: v.output });
    }
    const counts = allocateParticles(streams, CFG.particleBudget);
    let used = 0;
    for (const n of counts.values()) used += n;
    ok(used <= CFG.particleBudget, period + ": particle budget exceeded (" + used + ")");
    const low = allocateParticles(streams, CFG.particleBudgetLow);
    let lowUsed = 0;
    for (const n of low.values()) lowUsed += n;
    ok(lowUsed <= CFG.particleBudgetLow, period + ": low-power particle budget exceeded");
    const maxV = streams.reduce((m, s) => Math.max(m, s.volume), 0);
    for (const s of streams) {
      const radius = particleRadius(s.volume, maxV);
      ok(radius >= CFG.radiusMin && radius <= CFG.radiusMax, period + ": particle radius outside documented clamp");
      break;
    }
  }
  const report = { pass: failures.length === 0, checks, failures };
  if (failures.length) console.error("[Global AI Observatory] validation failures:", failures);
  else console.info("[Global AI Observatory] numeric validation passed: " + checks + " checks across " + PERIODS.length + " periods.");
  return report;
}

/* ---------- 20. UI WIRING ---------- */
function buildCountryJump() {
  const sel = el("country-jump");
  const codes = Object.keys(COUNTRY_COORDS).sort((a, b) => COUNTRY_COORDS[a].name.localeCompare(COUNTRY_COORDS[b].name));
  sel.innerHTML = '<option value="">Select a country…</option>' +
    codes.map(c => '<option value="' + c + '">' + COUNTRY_COORDS[c].name + ' (' + c + ')</option>').join("");
}
function buildTicks() {
  const box = el("ticks");
  box.innerHTML = "";
  PERIODS.forEach((p, i) => {
    const n = document.createElement("span");
    n.textContent = periodShort(p);
    n.setAttribute("role", "button");
    n.tabIndex = 0;
    n.setAttribute("aria-label", "Go to period " + periodLabel(p));
    n.addEventListener("click", () => setPeriod(i));
    n.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPeriod(i); } });
    box.appendChild(n);
  });
}
function wireUI() {
  el("btn-info").addEventListener("click", () => toggleMethod());
  el("method-close").addEventListener("click", () => toggleMethod(false));
  el("methodology").addEventListener("close", () => el("btn-info").setAttribute("aria-expanded", "false"));
  el("btn-rotate").addEventListener("click", () => setAutoRotate(!state.autoRotate));
  el("tg-input").addEventListener("change", e => { state.showInput = e.target.checked; updateAllocation(); refreshUI(); });
  el("tg-output").addEventListener("change", e => { state.showOutput = e.target.checked; updateAllocation(); refreshUI(); });
  el("tg-routes").addEventListener("change", e => { state.showRoutes = e.target.checked; refreshUI(); });
  el("tg-power").addEventListener("change", e => { state.lowPower = e.target.checked; resize(); updateAllocation(); refreshUI(); });
  el("country-jump").addEventListener("change", e => { if (e.target.value) selectCountry(e.target.value); });
  el("btn-clear").addEventListener("click", () => { clearSelections(); state.rankMode = "consuming"; refreshUI(); });
  el("btn-spotlight").addEventListener("click", () => { const c = COUNTRY_COORDS[state.selectedCountry]; if (c) { state.motionOverride = true; spotlightTo(c.lon, c.lat); } });
  el("rank-consuming").addEventListener("click", () => { state.rankMode = "consuming"; refreshUI(); });
  el("rank-serving").addEventListener("click", () => { state.rankMode = "serving"; refreshUI(); });
  el("intel").addEventListener("click", e => {
    const seg = e.target.closest && e.target.closest("[data-mode]");
    if (seg && state.selectedCountry) { state.partnerMode = seg.getAttribute("data-mode"); renderIntel(state.selectedCountry, Agg.recordsFor(PERIODS[state.periodIdx])); return; }
    const row = e.target.closest && e.target.closest(".rank-row[data-code]");
    if (row) selectCountry(row.getAttribute("data-code"));
  });
  el("rank-list").addEventListener("click", e => {
    const row = e.target.closest && e.target.closest(".rank-row[data-code]");
    if (row) selectCountry(row.getAttribute("data-code"));
  });
  el("inspector").addEventListener("click", e => { if (e.target.closest && e.target.closest("[data-clear-route]")) clearSelections(); });
  el("stories").addEventListener("click", e => { const chip = e.target.closest && e.target.closest("[data-story]"); if (chip) runStory(chip.getAttribute("data-story")); });
  el("story-close").addEventListener("click", dismissStory);
  el("btn-prev").addEventListener("click", () => stepPeriod(-1));
  el("btn-next").addEventListener("click", () => stepPeriod(1));
  el("btn-play").addEventListener("click", togglePlay);
  el("speed").addEventListener("change", e => { state.speed = parseFloat(e.target.value) || 1; });
  el("btn-loop").addEventListener("click", () => { state.loop = !state.loop; refreshUI(); });
  el("slider").addEventListener("input", e => setPeriod(parseInt(e.target.value, 10)));
  window.addEventListener("resize", () => { resize(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop();
    else if (!state.fatal && state.ready) startLoop();
  });
  canvas.addEventListener("pointermove", e => { lastClient = { x: e.clientX, y: e.clientY }; });
}

/* ---------- 21. TEST / DEVELOPMENT API ----------
   Read-only-ish introspection for automated checks and console debugging.
   Not used by the application itself. */
window.__observatory = {
  FLOWS, COUNTRY_COORDS, Agg, Geo, ROUTES,
  periods: () => PERIODS.slice(),
  state: () => state,
  view: () => view,
  rotation: () => state.rotation.slice(),
  setRotation: r => { state.rotation = [r[0], r[1]]; state.baseDirty = true; },
  volumes: () => Object.fromEntries(currentVolumes()),
  particleCount: () => particlePool.reduce((n, p) => n + (p.active ? 1 : 0), 0),
  particleBudget: CFG.particleBudget,
  allocation: () => Object.fromEntries(allocation),
  assets: () => Object.assign({}, state.assets),
  rafActive: () => rafId !== null,
  visibleAt: (lon, lat) => Geo.visible(Geo.toVec(lon, lat), state.rotation),
  project: (lon, lat) => Geo.project([lon, lat], state.rotation, view.scale, view.cx, view.cy),
  selectCountry, selectRoute, clearSelections, setPeriod, stepPeriod, togglePlay, runStory,
  validate: runValidation
};
window.__OBSERVATORY_TEST__ = window.__observatory;

/* Dynamic CDN loader: pinned versions, one mirror each, hard timeout.
   No bundler or server is needed — these are ordinary script tags. */
function loadScript(urls, ready) {
  return new Promise(resolve => {
    const queue = urls.slice();
    const next = () => {
      if (ready()) { resolve(true); return; }
      if (!queue.length) { resolve(false); return; }
      const s = document.createElement("script");
      s.src = queue.shift();
      s.async = false;
      let settled = false;
      const timer = setTimeout(() => finish(false), 12000);
      const finish = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.onload = null; s.onerror = null;
        if (!ok && s.parentNode) s.parentNode.removeChild(s);
        if (ok && ready()) resolve(true); else next();
      };
      s.onload = () => finish(true);
      s.onerror = () => finish(false);
      document.head.appendChild(s);
    };
    next();
  });
}
const D3_URLS = [
  "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
  "https://unpkg.com/d3@7.9.0/dist/d3.min.js"
];
const TOPOJSON_URLS = [
  "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
  "https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js"
];

/* ---------- 22. BOOT ---------- */
async function boot() {
  const errors = validateDataset();
  if (errors.length) { showFatal("The embedded FLOWS dataset is malformed. No records were silently discarded.\n\n" + errors.join("\n")); return; }
  PERIODS = Agg.periods();
  state.periodIdx = PERIODS.length - 1;
  const rmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  state.reducedMotion = rmQuery.matches;
  state.autoRotate = !state.reducedMotion;
  el("btn-rotate").setAttribute("aria-pressed", String(state.autoRotate));
  const onRmChange = e => {
    state.reducedMotion = e.matches;
    if (e.matches && !state.motionOverride) { state.autoRotate = false; el("btn-rotate").setAttribute("aria-pressed", "false"); }
  };
  if (rmQuery.addEventListener) rmQuery.addEventListener("change", onRmChange);
  else if (rmQuery.addListener) rmQuery.addListener(onRmChange);
  buildCountryJump();
  buildTicks();
  wireUI();
  el("slider").max = String(PERIODS.length - 1);
  el("slider").value = String(state.periodIdx);
  const fail = new URLSearchParams(location.search).get("fail");
  if (fail !== "d3" && fail !== "all") {
    await loadScript(D3_URLS, () => !!window.d3);
    await loadScript(TOPOJSON_URLS, () => !!window.topojson);
  }
  state.assets.d3 = !!window.d3 && fail !== "d3" && fail !== "all";
  state.assets.topojson = !!window.topojson && state.assets.d3;
  if (!state.assets.d3) {
    showNotice(LOAD_NOTICE + " D3.js could not be loaded; a static native-Canvas globe is shown with reference markers only.");
  } else if (!state.assets.topojson) {
    showNotice(LOAD_NOTICE + " topojson-client could not be loaded; geographic boundaries are unavailable.");
  }
  resize();
  updateAllocation();
  refreshUI();
  if (state.assets.d3 && state.assets.topojson) {
    const status = el("loading").querySelector("div:last-child");
    if (status) status.textContent = "LOADING COUNTRY GEOMETRY…";
    if (fail === "atlas") {
      state.assets.atlas = false;
      state.geoError = "Map asset load was disabled by the ?fail=atlas developer flag; the sphere, graticules, country markers and all synthetic statistics remain available, but country boundaries are not shown.";
      showNotice(state.geoError);
    } else {
      await fetchAtlas();
      if (!state.assets.atlas) showNotice(state.geoError);
    }
  }
  const report = runValidation();
  state.validation = report;
  let dot = el("validation-dot");
  if (!dot) { dot = document.createElement("span"); dot.id = "validation-dot"; dot.className = "dot"; el("meta-line").appendChild(dot); }
  dot.classList.add(report.pass ? "ok" : "fail");
  dot.title = report.pass
    ? "Internal numeric validation passed (" + report.checks + " checks). All aggregates reconcile with FLOWS."
    : "VALIDATION FAILURES: " + report.failures.join("; ");
  el("loading").hidden = true;
  resize();
  state.baseDirty = true;
  state.ready = true;
  startLoop();
}
boot().catch(err => showFatal("Startup error: " + (err && err.message ? err.message : String(err))));
