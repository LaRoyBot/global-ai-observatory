// Repository layer — all SQL lives here. Rows are plain objects; JSON columns
// are decoded at the boundary so callers never see raw strings.
import { getDb, plain, plainAll, jsonField } from "./db.js";

const nowIso = () => new Date().toISOString();

export const countries = {
  upsert(c) {
    getDb().prepare(`INSERT INTO countries (iso3, iso2, numeric, name, region, subregion, lat, lon, capital, evidence_class)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(iso3) DO UPDATE SET name=excluded.name, region=excluded.region, subregion=excluded.subregion,
        lat=excluded.lat, lon=excluded.lon, capital=excluded.capital, iso2=excluded.iso2, numeric=excluded.numeric`)
      .run(c.iso3, c.iso2 || null, c.numeric || null, c.name, c.region || null, c.subregion || null, c.lat, c.lon, c.capital || null, c.evidence_class || "reported");
  },
  all() { return plainAll(getDb().prepare("SELECT * FROM countries ORDER BY name").all()); },
  get(iso3) { return plain(getDb().prepare("SELECT * FROM countries WHERE iso3 = ?").get(String(iso3).toUpperCase())); },
  count() { return getDb().prepare("SELECT COUNT(*) n FROM countries").get().n; }
};

export const sources = {
  upsert(s) {
    getDb().prepare(`INSERT INTO data_sources (id,name,owner,url,access_method,datasets,granularity,update_frequency,license,attribution,rate_limit,parser_version,limitations,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, owner=excluded.owner, url=excluded.url, access_method=excluded.access_method,
        datasets=excluded.datasets, granularity=excluded.granularity, update_frequency=excluded.update_frequency, license=excluded.license,
        attribution=excluded.attribution, rate_limit=excluded.rate_limit, parser_version=excluded.parser_version, limitations=excluded.limitations`)
      .run(s.id, s.name, s.owner || null, s.url || null, s.access_method || null, JSON.stringify(s.datasets || []),
        s.granularity || null, s.update_frequency || null, s.license || null, s.attribution || null, s.rate_limit || null,
        s.parser_version || "1.0.0", JSON.stringify(s.limitations || []), s.status || "unknown");
  },
  recordRun(sourceId, run) {
    getDb().prepare(`INSERT INTO source_runs (source_id,started_at,finished_at,status,records_written,raw_count,error,parser_version)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(sourceId, run.started_at, run.finished_at || nowIso(), run.status, run.records_written || 0, run.raw_count || 0, run.error || null, run.parser_version || null);
    getDb().prepare(`UPDATE data_sources SET last_attempt_at=?, last_success_at=CASE WHEN ?='success' THEN ? ELSE last_success_at END,
      status=?, failure_reason=?, records_written=records_written+?, parser_version=COALESCE(?,parser_version) WHERE id=?`)
      .run(run.finished_at || nowIso(), run.status, run.finished_at || nowIso(),
        run.status === "success" ? "available" : run.status === "partial" ? "partial" : "failed",
        run.error || null, run.records_written || 0, run.parser_version || null, sourceId);
  },
  all() {
    return plainAll(getDb().prepare("SELECT * FROM data_sources ORDER BY name").all()).map(s => Object.assign(s, {
      datasets: jsonField(s.datasets, []), limitations: jsonField(s.limitations, []),
      runs: plainAll(getDb().prepare("SELECT * FROM source_runs WHERE source_id=? ORDER BY started_at DESC LIMIT 5").all(s.id))
    }));
  },
  get(id) { return plain(getDb().prepare("SELECT * FROM data_sources WHERE id=?").get(id)); }
};

export const providers = {
  upsert(p) {
    getDb().prepare(`INSERT INTO providers (slug,name,country_iso3,hq_city,website,kind,description,evidence_class,source_id,source_url,retrieved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET name=excluded.name, country_iso3=excluded.country_iso3, hq_city=excluded.hq_city,
        website=excluded.website, kind=excluded.kind, description=excluded.description, retrieved_at=excluded.retrieved_at`)
      .run(p.slug, p.name, p.country_iso3 || null, p.hq_city || null, p.website || null, p.kind || "lab", p.description || null,
        p.evidence_class || "reported", p.source_id || null, p.source_url || null, p.retrieved_at || nowIso());
    return getDb().prepare("SELECT id FROM providers WHERE slug=?").get(p.slug).id;
  },
  all() { return plainAll(getDb().prepare("SELECT * FROM providers ORDER BY name").all()); },
  get(slug) { return plain(getDb().prepare("SELECT * FROM providers WHERE slug=?").get(slug)); },
  count() { return getDb().prepare("SELECT COUNT(*) n FROM providers").get().n; }
};

export const models = {
  upsert(m) {
    getDb().prepare(`INSERT INTO models (slug,provider_id,external_id,name,family,release_date,context_window,input_modalities,output_modalities,description,evidence_class,source_id,source_url,retrieved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET name=excluded.name, family=excluded.family, release_date=excluded.release_date,
        context_window=excluded.context_window, input_modalities=excluded.input_modalities, output_modalities=excluded.output_modalities,
        description=excluded.description, retrieved_at=excluded.retrieved_at`)
      .run(m.slug, m.provider_id || null, m.external_id || null, m.name, m.family || null, m.release_date || null,
        m.context_window || null, JSON.stringify(m.input_modalities || []), JSON.stringify(m.output_modalities || []),
        m.description || null, m.evidence_class || "reported", m.source_id || null, m.source_url || null, m.retrieved_at || nowIso());
    return getDb().prepare("SELECT id FROM models WHERE slug=?").get(m.slug).id;
  },
  all({ provider, limit = 500 } = {}) {
    const sql = provider ? "SELECT m.*, p.slug provider_slug, p.name provider_name FROM models m LEFT JOIN providers p ON p.id=m.provider_id WHERE p.slug=? ORDER BY m.name LIMIT ?"
      : "SELECT m.*, p.slug provider_slug, p.name provider_name FROM models m LEFT JOIN providers p ON p.id=m.provider_id ORDER BY m.name LIMIT ?";
    const rows = provider ? getDb().prepare(sql).all(provider, limit) : getDb().prepare(sql).all(limit);
    return plainAll(rows).map(decodeModel);
  },
  get(slug) {
    const row = plain(getDb().prepare("SELECT m.*, p.slug provider_slug, p.name provider_name FROM models m LEFT JOIN providers p ON p.id=m.provider_id WHERE m.slug=?").get(slug));
    return row ? decodeModel(row) : null;
  },
  count() { return getDb().prepare("SELECT COUNT(*) n FROM models").get().n; }
};
function decodeModel(m) {
  return Object.assign(m, { input_modalities: jsonField(m.input_modalities, []), output_modalities: jsonField(m.output_modalities, []) });
}

export const infrastructure = {
  upsertSite(s) {
    getDb().prepare(`INSERT INTO infrastructure_sites (id,name,operator,provider_slug,country_iso3,city,lat,lon,facility_type,status,capacity_note,accelerator_note,evidence_class,source_id,source_url,verified_at,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, operator=excluded.operator, country_iso3=excluded.country_iso3, city=excluded.city,
        lat=excluded.lat, lon=excluded.lon, facility_type=excluded.facility_type, status=excluded.status, capacity_note=excluded.capacity_note,
        accelerator_note=excluded.accelerator_note, evidence_class=excluded.evidence_class, source_url=excluded.source_url, verified_at=excluded.verified_at, notes=excluded.notes`)
      .run(s.id, s.name, s.operator, s.provider_slug || s.provider || null, s.country_iso3 || null, s.city || null, s.lat ?? null, s.lon ?? null,
        s.facility_type, s.status, s.capacity_note || null, s.accelerator_note || null, s.evidence_class || "reported",
        s.source_id || null, s.source_url || null, s.verified_at || null, s.notes || null);
  },
  upsertRegion(r) {
    getDb().prepare(`INSERT INTO cloud_regions (id,provider_slug,provider_name,region_code,name,country_iso3,city,lat,lon,status,evidence_class,source_id,source_url,verified_at,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, country_iso3=excluded.country_iso3, city=excluded.city, lat=excluded.lat, lon=excluded.lon,
        status=excluded.status, evidence_class=excluded.evidence_class, source_url=excluded.source_url, verified_at=excluded.verified_at, notes=excluded.notes`)
      .run(r.id, r.provider_slug || r.provider, r.provider_name, r.region_code, r.name, r.country_iso3 || null, r.city || null,
        r.lat ?? null, r.lon ?? null, r.status, r.evidence_class || "reported", r.source_id || null, r.source_url || null, r.verified_at || null, r.notes || null);
  },
  sites({ country, type, provider, q, status } = {}) {
    let sql = "SELECT * FROM infrastructure_sites WHERE 1=1"; const args = [];
    if (country) { sql += " AND country_iso3=?"; args.push(country); }
    if (type) { sql += " AND facility_type=?"; args.push(type); }
    if (provider) { sql += " AND (provider_slug=? OR operator LIKE ?)"; args.push(provider, "%" + provider + "%"); }
    if (status) { sql += " AND status=?"; args.push(status); }
    if (q) { sql += " AND (name LIKE ? OR operator LIKE ? OR city LIKE ?)"; args.push("%" + q + "%", "%" + q + "%", "%" + q + "%"); }
    sql += " ORDER BY name";
    return plainAll(getDb().prepare(sql).all(...args));
  },
  regions({ country, provider } = {}) {
    let sql = "SELECT * FROM cloud_regions WHERE 1=1"; const args = [];
    if (country) { sql += " AND country_iso3=?"; args.push(country); }
    if (provider) { sql += " AND provider_slug=?"; args.push(provider); }
    sql += " ORDER BY provider_slug, region_code";
    return plainAll(getDb().prepare(sql).all(...args));
  },
  site(id) { return plain(getDb().prepare("SELECT * FROM infrastructure_sites WHERE id=?").get(id)); },
  countsByCountry() {
    return plainAll(getDb().prepare(`SELECT country_iso3, COUNT(*) sites,
      SUM(CASE WHEN facility_type='ai_datacentre' THEN 1 ELSE 0 END) ai_datacentres,
      SUM(CASE WHEN status='operational' THEN 1 ELSE 0 END) operational
      FROM infrastructure_sites WHERE country_iso3 IS NOT NULL GROUP BY country_iso3 ORDER BY sites DESC`).all());
  },
  regionCountsByCountry() {
    return plainAll(getDb().prepare("SELECT country_iso3, COUNT(*) regions FROM cloud_regions WHERE country_iso3 IS NOT NULL GROUP BY country_iso3 ORDER BY regions DESC").all());
  }
};

export const flows = {
  replaceFixture(records, { sourceId, fixtureVersion, evidenceClass = "synthetic" }) {
    const db = getDb();
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM flow_observations WHERE evidence_class=? AND source_id=?").run(evidenceClass, sourceId);
      const ins = db.prepare(`INSERT INTO flow_observations (period,origin_iso3,destination_iso3,input_tokens,output_tokens,attribution_basis,evidence_class,source_id,fixture_version)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const r of records) ins.run(r.period, r.origin, r.destination, r.inputTokens, r.outputTokens, r.attribution_basis || "modelling_convention", evidenceClass, sourceId, fixtureVersion);
      db.exec("COMMIT");
    } catch (err) { db.exec("ROLLBACK"); throw err; }
  },
  all({ evidence = "synthetic", period } = {}) {
    let sql = "SELECT period, origin_iso3 origin, destination_iso3 destination, input_tokens inputTokens, output_tokens outputTokens, evidence_class, attribution_basis, fixture_version FROM flow_observations WHERE evidence_class=?";
    const args = [evidence];
    if (period) { sql += " AND period=?"; args.push(period); }
    sql += " ORDER BY period, origin, destination";
    return plainAll(getDb().prepare(sql).all(...args));
  },
  periods(evidence = "synthetic") {
    return plainAll(getDb().prepare("SELECT DISTINCT period FROM flow_observations WHERE evidence_class=? ORDER BY period").all(evidence)).map(r => r.period);
  },
  count() { return getDb().prepare("SELECT COUNT(*) n FROM flow_observations").get().n; }
};

export const pricing = {
  insertMany(records) {
    const ins = getDb().prepare(`INSERT OR IGNORE INTO pricing_observations
      (provider_slug,model_slug,category,price,currency,unit,price_original,unit_original,effective_date,retrieved_at,conditions,evidence_class,source_id,source_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let n = 0;
    for (const r of records) {
      const res = ins.run(r.provider_slug, r.model_slug, r.category, r.price, r.currency || "USD", r.unit || "per_million_tokens",
        r.price_original ?? null, r.unit_original || null, r.effective_date || null, r.retrieved_at || nowIso(),
        r.conditions || null, r.evidence_class || "reported", r.source_id || null, r.source_url || null);
      n += Number(res.changes);
    }
    return n;
  },
  forModel(slug) { return plainAll(getDb().prepare("SELECT * FROM pricing_observations WHERE model_slug=? ORDER BY category, retrieved_at DESC").all(slug)); },
  latest({ provider, category, limit = 2000 } = {}) {
    let sql = "SELECT * FROM pricing_observations WHERE 1=1"; const args = [];
    if (provider) { sql += " AND provider_slug=?"; args.push(provider); }
    if (category) { sql += " AND category=?"; args.push(category); }
    sql += " ORDER BY retrieved_at DESC, model_slug LIMIT ?"; args.push(limit);
    return plainAll(getDb().prepare(sql).all(...args));
  },
  history(slug) { return plainAll(getDb().prepare("SELECT * FROM pricing_observations WHERE model_slug=? ORDER BY retrieved_at ASC, category").all(slug)); },
  count() { return getDb().prepare("SELECT COUNT(*) n FROM pricing_observations").get().n; }
};

export const adoption = {
  upsertMetric(m) {
    getDb().prepare(`INSERT INTO adoption_metrics (id,name,definition,unit,scope,methodology,source_id) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, definition=excluded.definition, unit=excluded.unit, scope=excluded.scope, methodology=excluded.methodology`)
      .run(m.id, m.name, m.definition, m.unit, m.scope || null, m.methodology || null, m.source_id || null);
  },
  insertMany(records) {
    const ins = getDb().prepare(`INSERT OR IGNORE INTO adoption_observations
      (metric_id,country_iso3,value,unit,reference_period,publication_date,method,sample_note,evidence_class,source_id,source_url,retrieved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    let n = 0;
    for (const r of records) {
      const res = ins.run(r.metric_id, r.country_iso3, r.value, r.unit, r.reference_period, r.publication_date || null,
        r.method || null, r.sample_note || null, r.evidence_class || "reported", r.source_id || null, r.source_url || null, r.retrieved_at || nowIso());
      n += Number(res.changes);
    }
    return n;
  },
  metrics() { return plainAll(getDb().prepare("SELECT * FROM adoption_metrics ORDER BY name").all()); },
  observations({ metric, country } = {}) {
    let sql = "SELECT a.*, m.name metric_name, m.definition metric_definition, m.unit metric_unit FROM adoption_observations a JOIN adoption_metrics m ON m.id=a.metric_id WHERE 1=1";
    const args = [];
    if (metric) { sql += " AND a.metric_id=?"; args.push(metric); }
    if (country) { sql += " AND a.country_iso3=?"; args.push(country); }
    sql += " ORDER BY a.metric_id, a.value DESC";
    return plainAll(getDb().prepare(sql).all(...args));
  },
  count() { return getDb().prepare("SELECT COUNT(*) n FROM adoption_observations").get().n; }
};

export const intelligence = {
  insertMany(records) {
    const ins = getDb().prepare(`INSERT OR IGNORE INTO intelligence_signals
      (external_id,kind,headline,summary,category,authors,source_name,source_url,published_at,event_at,retrieved_at,provider_slug,model_slug,country_iso3,evidence_class,source_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let n = 0;
    for (const r of records) {
      const res = ins.run(r.external_id || null, r.kind || "research_paper", r.headline, r.summary || null, r.category || r.kind || "research_paper",
        JSON.stringify(r.authors || []), r.source_name || r.source_id || "unknown", r.source_url, r.published_at || null, r.event_at || null,
        r.retrieved_at || nowIso(), r.provider_slug || null, r.model_slug || null, r.country_iso3 || null,
        r.evidence_class || "reported", r.source_id || null);
      n += Number(res.changes);
    }
    return n;
  },
  list({ kind, country, provider, q, limit = 200, offset = 0 } = {}) {
    let sql = "SELECT * FROM intelligence_signals WHERE 1=1"; const args = [];
    if (kind) { sql += " AND kind=?"; args.push(kind); }
    if (country) { sql += " AND country_iso3=?"; args.push(country); }
    if (provider) { sql += " AND provider_slug=?"; args.push(provider); }
    if (q) { sql += " AND (headline LIKE ? OR summary LIKE ?)"; args.push("%" + q + "%", "%" + q + "%"); }
    sql += " ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?"; args.push(limit, offset);
    return plainAll(getDb().prepare(sql).all(...args)).map(r => Object.assign(r, { authors: jsonField(r.authors, []) }));
  },
  count() { return getDb().prepare("SELECT COUNT(*) n FROM intelligence_signals").get().n; }
};

export const methodology = {
  upsert(m) {
    getDb().prepare(`INSERT INTO methodology_records (id,title,body_md,applies_to,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, body_md=excluded.body_md, applies_to=excluded.applies_to, updated_at=excluded.updated_at`)
      .run(m.id, m.title, m.body_md, JSON.stringify(m.applies_to || []), m.updated_at || nowIso());
  },
  all() { return plainAll(getDb().prepare("SELECT * FROM methodology_records ORDER BY title").all()).map(m => Object.assign(m, { applies_to: jsonField(m.applies_to, []) })); },
  get(id) { const m = plain(getDb().prepare("SELECT * FROM methodology_records WHERE id=?").get(id)); return m ? Object.assign(m, { applies_to: jsonField(m.applies_to, []) }) : null; }
};

export const preferences = {
  get() {
    const row = plain(getDb().prepare("SELECT * FROM user_preferences WHERE id=1").get());
    return row ? jsonField(row.prefs_json, {}) : {};
  },
  set(prefs) {
    getDb().prepare(`INSERT INTO user_preferences (id,prefs_json,updated_at) VALUES (1,?,?)
      ON CONFLICT(id) DO UPDATE SET prefs_json=excluded.prefs_json, updated_at=excluded.updated_at`)
      .run(JSON.stringify(prefs || {}), nowIso());
    return prefs;
  },
  saveView(v) {
    getDb().prepare("INSERT INTO saved_views (name,workspace,state_json,created_at) VALUES (?,?,?,?)")
      .run(v.name, v.workspace, JSON.stringify(v.state || {}), nowIso());
  },
  views() { return plainAll(getDb().prepare("SELECT * FROM saved_views ORDER BY created_at DESC").all()).map(v => Object.assign(v, { state: jsonField(v.state_json, {}) })); },
  deleteView(id) { getDb().prepare("DELETE FROM saved_views WHERE id=?").run(id); }
};
