CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;

CREATE TABLE sessions (
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      sdk_history_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, active_context_identity TEXT,
      model_preference_json TEXT, source_json TEXT,
      PRIMARY KEY(work_id, session_id)
    ) STRICT;

CREATE TABLE runs (
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT PRIMARY KEY,
      submission_key TEXT NOT NULL,
      prompt_digest TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (
        'accepted', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'
      )),
      final_text TEXT,
      error_json TEXT,
      accepted_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      earliest_available_sequence INTEGER NOT NULL DEFAULT 1,
      latest_sequence INTEGER NOT NULL DEFAULT 0, context_identity TEXT,
      model_selector_json TEXT, actual_model_json TEXT, source_json TEXT,
      adopted_experience_version INTEGER NOT NULL DEFAULT 0 CHECK(adopted_experience_version >= 0),
      adopted_memory_selection_json TEXT,
      FOREIGN KEY(work_id, session_id) REFERENCES sessions(work_id, session_id)
    ) STRICT;

CREATE TABLE run_events (
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(run_id, sequence)
    ) STRICT;

CREATE TABLE submit_idempotency (
      work_id TEXT NOT NULL,
      submission_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(work_id, submission_key)
    ) STRICT;

CREATE TABLE work_activity (
      work_id TEXT PRIMARY KEY,
      active_run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
      acquired_at TEXT NOT NULL
    ) STRICT;

CREATE TABLE session_idempotency (
        work_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(work_id, idempotency_key),
        FOREIGN KEY(work_id, session_id) REFERENCES sessions(work_id, session_id)
      ) STRICT;

CREATE TABLE service_events (
  work_id TEXT NOT NULL, event_pk TEXT PRIMARY KEY, source_service_id TEXT NOT NULL,
  event_id TEXT NOT NULL, event_digest TEXT NOT NULL, event_json TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('live','historical')),
  request_id TEXT REFERENCES agent_requests(request_id), created_at TEXT NOT NULL,
  UNIQUE(work_id,source_service_id,event_id)
) STRICT;
CREATE TABLE agent_requests (
  work_id TEXT NOT NULL, request_id TEXT PRIMARY KEY, submission_key TEXT NOT NULL,
  request_digest TEXT NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('chat','service')),
  service_name TEXT, source_service_id TEXT, source_event_pk TEXT REFERENCES service_events(event_pk),
  source_run_id TEXT REFERENCES runs(run_id), goal TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','running','waiting_result','waiting_apply','cancelling','completed','failed','cancelled','needs_attention')),
  disposition TEXT NOT NULL CHECK(disposition IN ('live','historical')),
  phase TEXT NOT NULL CHECK(phase IN ('handling','verifying','adopting')),
  auto_run_count INTEGER NOT NULL DEFAULT 0 CHECK(auto_run_count BETWEEN 0 AND 4),
  wait_ref_json TEXT, package_submission_json TEXT, action_refs_json TEXT NOT NULL DEFAULT '[]',
  result TEXT, error_json TEXT, retry_of TEXT REFERENCES agent_requests(request_id),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(work_id,submission_key)
) STRICT;
CREATE TABLE agent_request_runs (
  request_id TEXT NOT NULL REFERENCES agent_requests(request_id), run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  phase TEXT NOT NULL CHECK(phase IN ('handling','verifying','adopting')),
  disposition TEXT NOT NULL CHECK(disposition IN ('live','historical')), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE agent_evidence (
  work_id TEXT NOT NULL, evidence_id TEXT PRIMARY KEY, request_id TEXT REFERENCES agent_requests(request_id),
  run_id TEXT REFERENCES runs(run_id), service_name TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('query','action','job','artifact','event','package','sdk')),
  object_ref TEXT NOT NULL, observed_at TEXT NOT NULL, state_version TEXT, code_version TEXT,
  summary TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified IN (0,1)), details_json TEXT
) STRICT;
CREATE TABLE work_memory_binding (
  work_id TEXT PRIMARY KEY, store_id TEXT NOT NULL UNIQUE,
  memory_schema_version INTEGER NOT NULL CHECK(memory_schema_version = 1)
) STRICT;
