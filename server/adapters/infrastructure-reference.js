// server/adapters/infrastructure-reference.js
// Curated, sourced reference dataset of publicly announced AI infrastructure.
// Pure adapter: reads a versioned local JSON fixture; no network, no storage.
// Every record carries an official/trade source URL and a verification date.
// Coordinates are city/county reference points, NOT surveyed facility locations.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";

export const source = {
  id: "infrastructure-reference",
  name: "Curated AI infrastructure reference (public announcements)",
  owner: "Global AI Observatory editorial",
  url: "https://openai.com/index/five-new-stargate-sites",
  access_method: "curated_reference (versioned local fixture)",
  datasets: ["infrastructure_sites"],
  granularity: "per announced/operational campus",
  update_frequency: "manual editorial review",
  license: "Editorial compilation of public operator announcements and trade reporting",
  attribution: "Each record links its original operator announcement or trade-press source.",
  rate_limit: null,
  parser_version: "1.0.0",
  limitations: [
    "Not exhaustive: a small, high-confidence sample of publicly documented campuses.",
    "Coordinates are city or county reference points, not surveyed facility locations.",
    "Announced capacity is planned, not commissioned; status distinguishes announced / under_construction / operational.",
    "Operator-reported chip counts and capacities are not independently verified.",
    "Presence of a facility does NOT establish where inference is served for any provider or customer.",
  ],
};

export async function retrieve({ now = () => new Date().toISOString() } = {}) {
  const retrievedAt = now();
  const errors = [];
  const file = path.join(ROOT, "data", "reference", "infrastructure-sites.json");
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (err) { return { records: [], rawCount: 0, errors: [{ message: "fixture unreadable: " + err.message }], sourceId: source.id, retrievedAt }; }
  const records = [];
  for (const s of doc.sites || []) {
    if (!s.id || !s.name || !s.facility_type || !s.status) { errors.push({ message: "skipped site missing required fields: " + (s.id || "?") }); continue; }
    records.push(Object.assign({ kind: "site" }, s, { source_id: source.id, retrieved_at: retrievedAt }));
  }
  return { records, rawCount: (doc.sites || []).length, errors, sourceId: source.id, retrievedAt };
}
