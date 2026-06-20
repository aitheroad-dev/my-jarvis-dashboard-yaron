CREATE TABLE IF NOT EXISTS move_tasks (
  id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL CHECK (bucket IN ('A','B','C','D')),
  seq INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  owner TEXT,
  due TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS move_tasks_bucket_seq_idx ON move_tasks(bucket, seq);
