// Derive country reference points from REAL Natural Earth geometry.
// Centroid = area-weighted centroid of the largest polygon ring, computed from
// the downloaded world-atlas TopoJSON. No coordinates are invented.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const topo = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reference/countries-110m.json"), "utf8"));

// ISO 3166-1 mapping for Natural Earth names (standard public identifiers).
const MAP = {
  "United States of America": ["USA","US","840","Americas","Northern America","Washington, D.C."],
  "India": ["IND","IN","356","Asia","Southern Asia","New Delhi"],
  "Singapore": ["SGP","SG","702","Asia","South-eastern Asia","Singapore"],
  "United Kingdom": ["GBR","GB","826","Europe","Northern Europe","London"],
  "Germany": ["DEU","DE","276","Europe","Western Europe","Berlin"],
  "Ireland": ["IRL","IE","372","Europe","Northern Europe","Dublin"],
  "Japan": ["JPN","JP","392","Asia","Eastern Asia","Tokyo"],
  "South Korea": ["KOR","KR","410","Asia","Eastern Asia","Seoul"],
  "United Arab Emirates": ["ARE","AE","784","Asia","Western Asia","Abu Dhabi"],
  "Brazil": ["BRA","BR","076","Americas","South America","Brasília"],
  "Canada": ["CAN","CA","124","Americas","Northern America","Ottawa"],
  "Australia": ["AUS","AU","036","Oceania","Australia and New Zealand","Canberra"],
  "France": ["FRA","FR","250","Europe","Western Europe","Paris"],
  "China": ["CHN","CN","156","Asia","Eastern Asia","Beijing"],
  "Russia": ["RUS","RU","643","Europe","Eastern Europe","Moscow"],
  "Israel": ["ISR","IL","376","Asia","Western Asia","Jerusalem"],
  "Saudi Arabia": ["SAU","SA","682","Asia","Western Asia","Riyadh"],
  "Qatar": ["QAT","QA","634","Asia","Western Asia","Doha"],
  "Netherlands": ["NLD","NL","528","Europe","Western Europe","Amsterdam"],
  "Sweden": ["SWE","SE","752","Europe","Northern Europe","Stockholm"],
  "Switzerland": ["CHE","CH","756","Europe","Western Europe","Bern"],
  "Spain": ["ESP","ES","724","Europe","Southern Europe","Madrid"],
  "Italy": ["ITA","IT","380","Europe","Southern Europe","Rome"],
  "Poland": ["POL","PL","616","Europe","Eastern Europe","Warsaw"],
  "Finland": ["FIN","FI","246","Europe","Northern Europe","Helsinki"],
  "Norway": ["NOR","NO","578","Europe","Northern Europe","Oslo"],
  "Denmark": ["DNK","DK","208","Europe","Northern Europe","Copenhagen"],
  "Belgium": ["BEL","BE","056","Europe","Western Europe","Brussels"],
  "Austria": ["AUT","AT","040","Europe","Western Europe","Vienna"],
  "Portugal": ["PRT","PT","620","Europe","Southern Europe","Lisbon"],
  "Czechia": ["CZE","CZ","203","Europe","Eastern Europe","Prague"],
  "Ukraine": ["UKR","UA","804","Europe","Eastern Europe","Kyiv"],
  "Turkey": ["TUR","TR","792","Asia","Western Asia","Ankara"],
  "Indonesia": ["IDN","ID","360","Asia","South-eastern Asia","Jakarta"],
  "Malaysia": ["MYS","MY","458","Asia","South-eastern Asia","Kuala Lumpur"],
  "Thailand": ["THA","TH","764","Asia","South-eastern Asia","Bangkok"],
  "Vietnam": ["VNM","VN","704","Asia","South-eastern Asia","Hanoi"],
  "Philippines": ["PHL","PH","608","Asia","South-eastern Asia","Manila"],
  "New Zealand": ["NZL","NZ","554","Oceania","Australia and New Zealand","Wellington"],
  "Mexico": ["MEX","MX","484","Americas","Central America","Mexico City"],
  "Argentina": ["ARG","AR","032","Americas","South America","Buenos Aires"],
  "Chile": ["CHL","CL","152","Americas","South America","Santiago"],
  "Colombia": ["COL","CO","170","Americas","South America","Bogotá"],
  "South Africa": ["ZAF","ZA","710","Africa","Southern Africa","Pretoria"],
  "Nigeria": ["NGA","NG","566","Africa","Western Africa","Abuja"],
  "Kenya": ["KEN","KE","404","Africa","Eastern Africa","Nairobi"],
  "Egypt": ["EGY","EG","818","Africa","Northern Africa","Cairo"],
  "Morocco": ["MAR","MA","504","Africa","Northern Africa","Rabat"],
  "Ethiopia": ["ETH","ET","231","Africa","Eastern Africa","Addis Ababa"],
  "Ghana": ["GHA","GH","288","Africa","Western Africa","Accra"],
  "Pakistan": ["PAK","PK","586","Asia","Southern Asia","Islamabad"],
  "Bangladesh": ["BGD","BD","050","Asia","Southern Asia","Dhaka"],
  "Sri Lanka": ["LKA","LK","144","Asia","Southern Asia","Colombo"],
  "Iran": ["IRN","IR","364","Asia","Southern Asia","Tehran"],
  "Iraq": ["IRQ","IQ","368","Asia","Western Asia","Baghdad"],
  "Kazakhstan": ["KAZ","KZ","398","Asia","Central Asia","Astana"],
  "Uzbekistan": ["UZB","UZ","860","Asia","Central Asia","Tashkent"],
  "Taiwan": ["TWN","TW","158","Asia","Eastern Asia","Taipei"],
  "Greece": ["GRC","GR","300","Europe","Southern Europe","Athens"],
  "Romania": ["ROU","RO","642","Europe","Eastern Europe","Bucharest"],
  "Hungary": ["HUN","HU","348","Europe","Eastern Europe","Budapest"],
  "Estonia": ["EST","EE","233","Europe","Northern Europe","Tallinn"],
  "Luxembourg": ["LUX","LU","442","Europe","Western Europe","Luxembourg"],
  "Iceland": ["ISL","IS","352","Europe","Northern Europe","Reykjavík"],
  "Peru": ["PER","PE","604","Americas","South America","Lima"],
  "Ecuador": ["ECU","EC","218","Americas","South America","Quito"],
  "Uruguay": ["URY","UY","858","Americas","South America","Montevideo"],
  "Costa Rica": ["CRI","CR","188","Americas","Central America","San José"],
  "Panama": ["PAN","PA","591","Americas","Central America","Panama City"],
  "Tunisia": ["TUN","TN","788","Africa","Northern Africa","Tunis"],
  "Algeria": ["DZA","DZ","012","Africa","Northern Africa","Algiers"],
  "Tanzania": ["TZA","TZ","834","Africa","Eastern Africa","Dodoma"],
  "Uganda": ["UGA","UG","800","Africa","Eastern Africa","Kampala"],
  "Rwanda": ["RWA","RW","646","Africa","Eastern Africa","Kigali"],
  "Senegal": ["SEN","SN","686","Africa","Western Africa","Dakar"],
  "Zambia": ["ZMB","ZM","894","Africa","Eastern Africa","Lusaka"],
  "Zimbabwe": ["ZWE","ZW","716","Africa","Eastern Africa","Harare"],
  "Myanmar": ["MMR","MM","104","Asia","South-eastern Asia","Naypyidaw"],
  "Nepal": ["NPL","NP","524","Asia","Southern Asia","Kathmandu"],
  "Bahrain": ["BHR","BH","048","Asia","Western Asia","Manama"],
  "Kuwait": ["KWT","KW","414","Asia","Western Asia","Kuwait City"],
  "Oman": ["OMN","OM","512","Asia","Western Asia","Muscat"],
  "Jordan": ["JOR","JO","400","Asia","Western Asia","Amman"],
  "Lebanon": ["LBN","LB","422","Asia","Western Asia","Beirut"],
  "Armenia": ["ARM","AM","051","Asia","Western Asia","Yerevan"],
  "Georgia": ["GEO","GE","268","Asia","Western Asia","Tbilisi"],
  "Azerbaijan": ["AZE","AZ","031","Asia","Western Asia","Baku"],
  "Serbia": ["SRB","RS","688","Europe","Southern Europe","Belgrade"],
  "Croatia": ["HRV","HR","191","Europe","Southern Europe","Zagreb"],
  "Bulgaria": ["BGR","BG","100","Europe","Eastern Europe","Sofia"],
  "Slovakia": ["SVK","SK","703","Europe","Eastern Europe","Bratislava"],
  "Slovenia": ["SVN","SI","705","Europe","Southern Europe","Ljubljana"],
  "Lithuania": ["LTU","LT","440","Europe","Northern Europe","Vilnius"],
  "Latvia": ["LVA","LV","428","Europe","Northern Europe","Riga"],
  "Belarus": ["BLR","BY","112","Europe","Eastern Europe","Minsk"],
  "Moldova": ["MDA","MD","498","Europe","Eastern Europe","Chișinău"],
  "Albania": ["ALB","AL","008","Europe","Southern Europe","Tirana"],
  "Bosnia and Herz.": ["BIH","BA","070","Europe","Southern Europe","Sarajevo"],
  "Macedonia": ["MKD","MK","807","Europe","Southern Europe","Skopje"],
  "Montenegro": ["MNE","ME","499","Europe","Southern Europe","Podgorica"],
  "Cyprus": ["CYP","CY","196","Asia","Western Asia","Nicosia"],
  "Malta": ["MLT","MT","470","Europe","Southern Europe","Valletta"]
};

// Decode TopoJSON arcs (delta-encoded, quantized).
const tr = topo.transform, arcs = topo.arcs;
function decodeArc(i) {
  const rev = i < 0, a = arcs[rev ? ~i : i];
  let x = 0, y = 0;
  const pts = a.map(p => { x += p[0]; y += p[1]; return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]]; });
  return rev ? pts.reverse() : pts;
}
function ringPoints(arcIdxs) {
  let out = [];
  for (const i of arcIdxs) { const pts = decodeArc(i); out = out.concat(out.length ? pts.slice(1) : pts); }
  return out;
}
function ringsOf(geom) {
  if (geom.type === "Polygon") return geom.arcs.map(ringPoints);
  if (geom.type === "MultiPolygon") return geom.arcs.flatMap(poly => poly.map(ringPoints));
  return [];
}
function areaCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) { // degenerate: fall back to mean
    const n = ring.length;
    return { area: 0, lon: ring.reduce((s, p) => s + p[0], 0) / n, lat: ring.reduce((s, p) => s + p[1], 0) / n };
  }
  return { area: Math.abs(a), lon: cx / (6 * a), lat: cy / (6 * a) };
}

const out = [], unmatched = [];
for (const g of topo.objects.countries.geometries) {
  const name = g.properties && g.properties.name;
  const meta = MAP[name];
  if (!meta) { unmatched.push(name); continue; }
  const rings = ringsOf(g);
  if (!rings.length) continue;
  let best = null;
  for (const r of rings) { const c = areaCentroid(r); if (!best || c.area > best.area) best = c; }
  const [iso3, iso2, numeric, region, subregion, capital] = meta;
  out.push({
    iso3, iso2, numeric, name: iso3 === "USA" ? "United States" : (iso3 === "KOR" ? "South Korea" : name),
    region, subregion, capital,
    lat: Number(best.lat.toFixed(4)), lon: Number(best.lon.toFixed(4)),
    evidence_class: "reported", source_id: "natural-earth-110m",
    source_url: "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
    notes: "Reference point is the area-weighted centroid of the largest Natural Earth 1:110m polygon ring; not a capital coordinate."
  });
}
// Singapore is omitted by Natural Earth 1:110m. Use the embedded real 1:50m
// outline (SG_SUPPLEMENT) and compute its centroid the same way.
const { SG_SUPPLEMENT } = await import("../src/geography/country-reference.js");
{
  const rings = SG_SUPPLEMENT.geometry.type === "Polygon" ? [SG_SUPPLEMENT.geometry.coordinates[0]]
    : SG_SUPPLEMENT.geometry.coordinates.map(p => p[0]);
  let best = null;
  for (const r of rings) { const c = areaCentroid(r); if (!best || c.area > best.area) best = c; }
  if (best) out.push({
    iso3: "SGP", iso2: "SG", numeric: "702", name: "Singapore", region: "Asia", subregion: "South-eastern Asia",
    capital: "Singapore", lat: Number(best.lat.toFixed(4)), lon: Number(best.lon.toFixed(4)),
    evidence_class: "reported", source_id: "natural-earth-50m-sg",
    source_url: "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json",
    notes: "1:110m omits Singapore; reference point computed from the embedded Natural Earth 1:50m outline."
  });
}
out.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(ROOT, "data/reference/countries.json"), JSON.stringify(out, null, 2));
console.log("countries written:", out.length);
console.log("unmatched atlas names:", unmatched.length, unmatched.slice(0, 40).join(" | "));
