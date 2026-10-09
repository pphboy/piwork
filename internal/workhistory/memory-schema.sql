CREATE TABLE memory_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  work_id TEXT NOT NULL, store_id TEXT NOT NULL
) STRICT;
CREATE TABLE memory_versions (
  version INTEGER PRIMARY KEY CHECK(version >= 0),
  published_at TEXT, legacy INTEGER NOT NULL CHECK(legacy IN (0,1))
) STRICT;
CREATE TABLE memory_entries (
  version INTEGER NOT NULL REFERENCES memory_versions(version),
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('preference','experience','knowledge')),
  scope TEXT NOT NULL, rule TEXT NOT NULL, evidence_ids_json TEXT NOT NULL,
  source_request_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(version,entry_id)
) STRICT;
CREATE TABLE memory_candidates (
  candidate_version INTEGER NOT NULL CHECK(candidate_version >= 1),
  entry_id TEXT NOT NULL, source_request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('upsert','invalidate')),
  base_version INTEGER NOT NULL REFERENCES memory_versions(version),
  kind TEXT NOT NULL CHECK(kind IN ('preference','experience','knowledge')),
  scope TEXT NOT NULL, rule TEXT NOT NULL, evidence_ids_json TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK(status IN ('staged','effective','failed')),
  published_version INTEGER REFERENCES memory_versions(version),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(candidate_version,entry_id)
) STRICT;
CREATE INDEX memory_candidates_request ON memory_candidates(source_request_id,status,candidate_version);
CREATE INDEX memory_candidates_entry ON memory_candidates(entry_id,published_version);
CREATE TABLE memory_head (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  version INTEGER NOT NULL REFERENCES memory_versions(version), updated_at TEXT NOT NULL
) STRICT;
