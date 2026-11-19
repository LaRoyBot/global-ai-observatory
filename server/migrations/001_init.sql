-- Global AI Observatory — canonical relational schema.
-- Provenance is a first-class concern: evidence_class, freshness and availability
-- are SEPARATE dimensions and are never collapsed into one status field.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS countries (
  iso3        TEXT PRIMARY KEY,
  iso2        TEXT,
  numeric     TEXT,
  name        TEXT NOT NULL,
  region      TEXT,
  subregion   TEXT,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  capital     TEXT,
  evidence_class TEXT NOT NULL DEFAULT 'reported'
    CHECK (evidence_class IN ('measured','reported','estimated','synthetic'))
);

CREATE TABLE IF NOT EXISTS data_sources (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  owner             TEXT,
  url               TEXT,
  access_method     TEXT,
  datasets          TEXT NOT NULL DEFAULT '[]',   -- JSON array of dataset ids
  granularity       TEXT,
  update_frequency  TEXT,
  license           TEXT,
  attribution       TEXT,
  rate_limit        TEXT,
  parser_version    TEXT,
  limitations       TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  last_success_at   TEXT,
  last_attempt_at   TEXT,
  status            TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('available','partial','unavailable','failed','unknown')),
  failure_reason    TEXT,
  records_written   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS source_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  records_written INTEGER NOT NULL DEFAULT 0,
  raw_count       INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  parser_version  TEXT
);
CREATE INDEX IF NOT EXISTS idx_source_runs_source ON source_runs(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS providers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  country_iso3    TEXT REFERENCES countries(iso3),
  hq_city         TEXT,
  website         TEXT,
  kind            TEXT NOT NULL DEFAULT 'lab'
    CHECK (kind IN ('lab','cloud','chip','aggregator','research','other')),
  description     TEXT,
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  source_url      TEXT,
  retrieved_at    TEXT
);

CREATE TABLE IF NOT EXISTS models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  provider_id     INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  external_id     TEXT,
  name            TEXT NOT NULL,
  family          TEXT,
  release_date    TEXT,
  context_window  INTEGER,
  input_modalities  TEXT NOT NULL DEFAULT '[]',
  output_modalities TEXT NOT NULL DEFAULT '[]',
  description     TEXT,
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  source_url      TEXT,
  retrieved_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_models_external ON models(source_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

CREATE TABLE IF NOT EXISTS cloud_regions (
  id              TEXT PRIMARY KEY,
  provider_slug   TEXT NOT NULL,
  provider_name   TEXT NOT NULL,
  region_code     TEXT NOT NULL,
  name            TEXT NOT NULL,
  country_iso3    TEXT REFERENCES countries(iso3),
  city            TEXT,
  lat             REAL,
  lon             REAL,
  status          TEXT NOT NULL CHECK (status IN ('planned','announced','under_construction','operational','decommissioned','unknown')),
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  source_url      TEXT,
  verified_at     TEXT,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_regions_country ON cloud_regions(country_iso3);
CREATE INDEX IF NOT EXISTS idx_regions_provider ON cloud_regions(provider_slug);

CREATE TABLE IF NOT EXISTS infrastructure_sites (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  operator        TEXT NOT NULL,
  provider_slug   TEXT,
  country_iso3    TEXT REFERENCES countries(iso3),
  city            TEXT,
  lat             REAL,
  lon             REAL,
  facility_type   TEXT NOT NULL CHECK (facility_type IN ('ai_datacentre','cloud_region_facility','research_lab','compute_facility','organisation_hq','infrastructure_project','accelerator_vendor')),
  status          TEXT NOT NULL CHECK (status IN ('planned','announced','under_construction','operational','decommissioned','unknown')),
  capacity_note   TEXT,
  accelerator_note TEXT,
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  source_url      TEXT,
  verified_at     TEXT,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sites_country ON infrastructure_sites(country_iso3);
CREATE INDEX IF NOT EXISTS idx_sites_type ON infrastructure_sites(facility_type);

CREATE TABLE IF NOT EXISTS flow_observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  period          TEXT NOT NULL,               -- YYYY-MM
  origin_iso3     TEXT NOT NULL REFERENCES countries(iso3),   -- SERVING country
  destination_iso3 TEXT NOT NULL REFERENCES countries(iso3),  -- CONSUMING country
  input_tokens    INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens   INTEGER NOT NULL CHECK (output_tokens >= 0),
  provider_id     INTEGER REFERENCES providers(id),
  model_id        INTEGER REFERENCES models(id),
  attribution_basis TEXT NOT NULL DEFAULT 'modelling_convention',
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  fixture_version TEXT,
  UNIQUE (period, origin_iso3, destination_iso3, evidence_class, fixture_version)
);
CREATE INDEX IF NOT EXISTS idx_flows_period ON flow_observations(period);
CREATE INDEX IF NOT EXISTS idx_flows_origin ON flow_observations(origin_iso3);
CREATE INDEX IF NOT EXISTS idx_flows_destination ON flow_observations(destination_iso3);

CREATE TABLE IF NOT EXISTS pricing_observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_slug   TEXT NOT NULL,
  model_slug      TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('input','output','cached_input','batch_input','batch_output')),
  price           REAL NOT NULL,               -- normalized: USD per 1,000,000 tokens
  currency        TEXT NOT NULL DEFAULT 'USD',
  unit            TEXT NOT NULL DEFAULT 'per_million_tokens',
  price_original  REAL,
  unit_original   TEXT,
  effective_date  TEXT,
  retrieved_at    TEXT NOT NULL,
  conditions      TEXT,
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  source_url      TEXT,
  UNIQUE (model_slug, category, source_id, retrieved_at)
);
CREATE INDEX IF NOT EXISTS idx_pricing_model ON pricing_observations(model_slug, category);
CREATE INDEX IF NOT EXISTS idx_pricing_provider ON pricing_observations(provider_slug);

CREATE TABLE IF NOT EXISTS adoption_metrics (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  definition      TEXT NOT NULL,
  unit            TEXT NOT NULL,
  scope           TEXT,
  methodology     TEXT,
  source_id       TEXT REFERENCES data_sources(id)
);

CREATE TABLE IF NOT EXISTS adoption_observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_id       TEXT NOT NULL REFERENCES adoption_metrics(id) ON DELETE CASCADE,
  country_iso3    TEXT NOT NULL REFERENCES countries(iso3),
  value           REAL NOT NULL,
  unit            TEXT NOT NULL,
  reference_period TEXT NOT NULL,
  publication_date TEXT,
  method          TEXT,
  sample_note     TEXT,
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  source_url      TEXT,
  retrieved_at    TEXT,
  UNIQUE (metric_id, country_iso3, reference_period, source_id)
);
CREATE INDEX IF NOT EXISTS idx_adoption_country ON adoption_observations(country_iso3);

CREATE TABLE IF NOT EXISTS intelligence_signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id     TEXT,
  kind            TEXT NOT NULL CHECK (kind IN ('research_paper','model_release','provider_announcement','infrastructure_investment','pricing_announcement','policy_regulation','semiconductor','industry')),
  headline        TEXT NOT NULL,
  summary         TEXT,
  category        TEXT NOT NULL,
  authors         TEXT NOT NULL DEFAULT '[]',
  source_name     TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  published_at    TEXT,                        -- publication time (never invented)
  event_at        TEXT,                        -- event time, kept SEPARATE
  retrieved_at    TEXT NOT NULL,
  provider_slug   TEXT,
  model_slug      TEXT,
  country_iso3    TEXT REFERENCES countries(iso3),
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_signals_published ON intelligence_signals(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_kind ON intelligence_signals(kind);

CREATE TABLE IF NOT EXISTS methodology_records (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  body_md         TEXT NOT NULL,
  applies_to      TEXT NOT NULL DEFAULT '[]',
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_views (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  workspace       TEXT NOT NULL,
  state_json      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  prefs_json      TEXT NOT NULL DEFAULT '{}',
  updated_at      TEXT NOT NULL
);
