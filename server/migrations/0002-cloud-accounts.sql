CREATE TABLE cloud_accounts (
  account_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  trial_started_at INTEGER,
  trial_ends_at INTEGER,
  paid_until INTEGER,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deleting')),
  CHECK ((trial_started_at IS NULL AND trial_ends_at IS NULL) OR (trial_started_at IS NOT NULL AND trial_ends_at > trial_started_at))
);
