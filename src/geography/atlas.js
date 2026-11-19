// Shared atlas loader for flat-map views. Reuses the same Natural Earth
// geometry the globe loads; maps numeric ids to canonical ISO3 codes.
let cache = null;
export async function loadCountryFeatures(countries) {
  if (cache) return cache;
  if (!window.d3 || !window.topojson) throw new Error("D3/topojson not loaded");
  const res = await fetch("/data/reference/countries-110m.json");
  if (!res.ok) throw new Error("atlas HTTP " + res.status);
  const topo = await res.json();
  const feats = window.topojson.feature(topo, topo.objects.countries).features;
  const numToIso = {};
  for (const c of countries) if (c.numeric) numToIso[String(parseInt(c.numeric, 10))] = c.iso3;
  for (const f of feats) {
    f.properties = f.properties || {};
    const iso = numToIso[String(parseInt(f.id, 10))];
    if (iso) f.properties.iso = iso;
  }
  cache = feats;
  return feats;
}
export function whenGeoReady(cb, tries = 40) {
  if (window.d3 && window.topojson) { cb(); return; }
  if (tries <= 0) return;
  setTimeout(() => whenGeoReady(cb, tries - 1), 400);
}
