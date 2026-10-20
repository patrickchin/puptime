-- Independent of a source session: the receipt selects an existing owner;
-- Better Auth still verifies the identity and issues the only session.
CREATE TABLE account_recovery_intents (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_hash TEXT NOT NULL REFERENCES account_deletion_receipts(receipt_hash) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('email', 'apple', 'google')),
  provider_account_id TEXT REFERENCES account(id) ON DELETE CASCADE,
  identity_value TEXT NOT NULL CHECK (length(identity_value) BETWEEN 1 AND 2048),
  state_hash TEXT UNIQUE CHECK (state_hash IS NULL OR length(state_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  CHECK ((method = 'email' AND provider_account_id IS NULL AND state_hash IS NULL)
    OR (method != 'email' AND provider_account_id IS NOT NULL AND state_hash IS NOT NULL))
);
CREATE INDEX account_recovery_intents_owner ON account_recovery_intents(account_id, expires_at);
CREATE INDEX account_recovery_intents_receipt ON account_recovery_intents(receipt_hash, expires_at);

-- Better Auth prunes its rateLimit table using its HTTP window. Recovery send
-- bounds have a longer lifetime and must not be erased by that unrelated reset.
CREATE TABLE account_recovery_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0)
);
CREATE INDEX account_recovery_limits_expiry ON account_recovery_limits(window_started_at);
