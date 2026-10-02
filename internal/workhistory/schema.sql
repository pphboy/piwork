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
