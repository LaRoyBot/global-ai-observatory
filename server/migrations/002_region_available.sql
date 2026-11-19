-- 002: cloud regions are an availability entity, not a facility lifecycle.
-- Allow status 'available' for cloud_regions while keeping the facility
-- lifecycle vocabulary for infrastructure_sites. SQLite cannot ALTER a CHECK
-- constraint, so the table is rebuilt and its rows copied verbatim.
CREATE TABLE cloud_regions_new (
  id              TEXT PRIMARY KEY,
  provider_slug   TEXT NOT NULL,
  provider_name   TEXT NOT NULL,
  region_code     TEXT NOT NULL,
  name            TEXT NOT NULL,
  country_iso3    TEXT REFERENCES countries(iso3),
  city            TEXT,
  lat             REAL,
  lon             REAL,
  status          TEXT NOT NULL CHECK (status IN ('available','planned','announced','under_construction','operational','decommissioned','unknown')),
  evidence_class  TEXT NOT NULL CHECK (evidence_class IN ('measured','reported','estimated','synthetic')),
  source_id       TEXT REFERENCES data_sources(id),
  source_url      TEXT,
  verified_at     TEXT,
  notes           TEXT
);
INSERT INTO cloud_regions_new SELECT * FROM cloud_regions;
DROP TABLE cloud_regions;
ALTER TABLE cloud_regions_new RENAME TO cloud_regions;
CREATE INDEX IF NOT EXISTS idx_regions_country ON cloud_regions(country_iso3);
CREATE INDEX IF NOT EXISTS idx_regions_provider ON cloud_regions(provider_slug);
