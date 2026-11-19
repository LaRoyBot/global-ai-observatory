// server/adapters/aws-regions.js
// AWS cloud-region availability from the official public pricing region index
// (no credentials). Region codes are authoritative; the country/city mapping is
// an editorial reference derived from AWS public region documentation.
// Cloud-region availability is NOT evidence of inference-serving geography.
import { resilientFetch, createCircuitBreaker } from "./http.js";

export const source = {
  id: "aws-regions",
  name: "AWS region index (official public pricing API)",
  owner: "Amazon Web Services",
  url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json",
  access_method: "public JSON API (no authentication)",
  datasets: ["cloud_regions"],
  granularity: "per AWS region code",
  update_frequency: "continuous (AWS pricing publication)",
  license: "AWS pricing list informational use; see AWS terms",
  attribution: "Region codes and publication date from the official AWS pricing region index. Country/city mapping is editorial reference from AWS public region documentation.",
  rate_limit: "unauthenticated public endpoint; client self-limits",
  parser_version: "1.0.0",
  limitations: [
    "Region availability indicates where AWS offers services, NOT where AI inference is served.",
    "Country/city mapping is an editorial reference table; unmapped region codes are recorded with null country.",
    "Coordinates are city reference points, not facility locations.",
    "Government and China partitions are listed separately and may be operated by partners.",
  ],
};

// Editorial reference: AWS region code -> country / city / city reference point.
// Public facts from AWS regional documentation; coordinates are city centroids.
const REGION_REF = {
  "us-east-1": ["USA", "Ashburn, Virginia", 39.0438, -77.4874, "US East (N. Virginia)"],
  "us-east-2": ["USA", "Columbus, Ohio", 39.9612, -82.9988, "US East (Ohio)"],
  "us-west-1": ["USA", "San Francisco, California", 37.7749, -122.4194, "US West (N. California)"],
  "us-west-2": ["USA", "Portland, Oregon", 45.5152, -122.6784, "US West (Oregon)"],
  "us-gov-east-1": ["USA", "US GovCloud East", 39.0438, -77.4874, "AWS GovCloud (US-East)"],
  "us-gov-west-1": ["USA", "US GovCloud West", 45.5152, -122.6784, "AWS GovCloud (US-West)"],
  "ca-central-1": ["CAN", "Montréal, Quebec", 45.5017, -73.5673, "Canada (Central)"],
  "ca-west-1": ["CAN", "Calgary, Alberta", 51.0447, -114.0719, "Canada West (Calgary)"],
  "mx-central-1": ["MEX", "Mexico City", 19.4326, -99.1332, "Mexico (Central)"],
  "sa-east-1": ["BRA", "São Paulo", -23.5505, -46.6333, "South America (São Paulo)"],
  "eu-west-1": ["IRL", "Dublin", 53.3498, -6.2603, "Europe (Ireland)"],
  "eu-west-2": ["GBR", "London", 51.5074, -0.1278, "Europe (London)"],
  "eu-west-3": ["FRA", "Paris", 48.8566, 2.3522, "Europe (Paris)"],
  "eu-central-1": ["DEU", "Frankfurt", 50.1109, 8.6821, "Europe (Frankfurt)"],
  "eu-central-2": ["CHE", "Zurich", 47.3769, 8.5417, "Europe (Zurich)"],
  "eu-north-1": ["SWE", "Stockholm", 59.3293, 18.0686, "Europe (Stockholm)"],
  "eu-south-1": ["ITA", "Milan", 45.4642, 9.19, "Europe (Milan)"],
  "eu-south-2": ["ESP", "Madrid", 40.4168, -3.7038, "Europe (Spain)"],
  "me-south-1": ["BHR", "Manama", 26.2285, 50.586, "Middle East (Bahrain)"],
  "me-central-1": ["ARE", "Dubai", 25.2048, 55.2708, "Middle East (UAE)"],
  "il-central-1": ["ISR", "Tel Aviv", 32.0853, 34.7818, "Israel (Tel Aviv)"],
  "af-south-1": ["ZAF", "Cape Town", -33.9249, 18.4241, "Africa (Cape Town)"],
  "ap-south-1": ["IND", "Mumbai", 19.076, 72.8777, "Asia Pacific (Mumbai)"],
  "ap-south-2": ["IND", "Hyderabad", 17.385, 78.4867, "Asia Pacific (Hyderabad)"],
  "ap-southeast-1": ["SGP", "Singapore", 1.3521, 103.8198, "Asia Pacific (Singapore)"],
  "ap-southeast-2": ["AUS", "Sydney", -33.8688, 151.2093, "Asia Pacific (Sydney)"],
  "ap-southeast-3": ["IDN", "Jakarta", -6.2088, 106.8456, "Asia Pacific (Jakarta)"],
  "ap-southeast-4": ["AUS", "Melbourne", -37.8136, 144.9631, "Asia Pacific (Melbourne)"],
  "ap-southeast-5": ["MYS", "Kuala Lumpur", 3.139, 101.6869, "Asia Pacific (Malaysia)"],
  "ap-southeast-7": ["THA", "Bangkok", 13.7563, 100.5018, "Asia Pacific (Thailand)"],
  "ap-northeast-1": ["JPN", "Tokyo", 35.6762, 139.6503, "Asia Pacific (Tokyo)"],
  "ap-northeast-2": ["KOR", "Seoul", 37.5665, 126.978, "Asia Pacific (Seoul)"],
  "ap-northeast-3": ["JPN", "Osaka", 34.6937, 135.5023, "Asia Pacific (Osaka)"],
  "ap-east-1": ["HKG", "Hong Kong", 22.3193, 114.1694, "Asia Pacific (Hong Kong)"],
  "ap-east-2": ["TWN", "Taipei", 25.033, 121.5654, "Asia Pacific (Taipei)"],
  "cn-north-1": ["CHN", "Beijing", 39.9042, 116.4074, "China (Beijing) — operated by Sinnet"],
  "cn-northwest-1": ["CHN", "Ningxia", 38.4872, 106.2309, "China (Ningxia) — operated by NWCD"],
};

const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 });
export const REGION_INDEX_URL = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json";

export async function retrieve({ fetchImpl = fetch, signal, now = () => new Date().toISOString(), timeoutMs = 20000, retries = 2 } = {}) {
  const retrievedAt = now();
  const errors = [];
  const res = await resilientFetch(REGION_INDEX_URL, { fetchImpl, signal, timeoutMs, retries, circuitBreaker: breaker, headers: { Accept: "application/json" } });
  if (!res.ok) { errors.push({ message: "fetch failed: " + res.error, status: res.status }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  let doc;
  try { doc = JSON.parse(res.body); } catch (err) { errors.push({ message: "malformed JSON: " + err.message }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  const regions = doc && doc.regions;
  if (!regions || typeof regions !== "object") { errors.push({ message: "unexpected shape: missing regions object" }); return { records: [], rawCount: 0, errors, sourceId: source.id, retrievedAt }; }
  const records = [];
  const codes = Object.keys(regions);
  for (const code of codes) {
    const ref = REGION_REF[code];
    records.push({
      kind: "region",
      id: "aws-" + code,
      provider_slug: "aws",
      provider_name: "Amazon Web Services",
      region_code: code,
      name: ref ? ref[4] : code,
      country_iso3: ref ? ref[0] : null,
      city: ref ? ref[1] : null,
      lat: ref ? ref[2] : null,
      lon: ref ? ref[3] : null,
      status: "available",
      evidence_class: "reported",
      source_id: source.id,
      source_url: REGION_INDEX_URL,
      verified_at: (doc.publicationDate || retrievedAt).slice(0, 10),
      retrieved_at: retrievedAt,
      notes: ref
        ? "Region availability from the official AWS pricing index (published " + (doc.publicationDate || "unknown") + "). Country/city is an editorial reference; coordinates are city reference points. Availability does NOT indicate where inference is served."
        : "Region code present in the official AWS index but not in the editorial country reference table; country left null rather than guessed.",
    });
  }
  return { records, rawCount: codes.length, errors, sourceId: source.id, retrievedAt };
}
