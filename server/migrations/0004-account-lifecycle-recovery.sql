-- OAuth intents contain only our own binding to the SDK's opaque state hash.
-- The SDK continues to own OAuth state verification, provider tokens and cookies.
CREATE TABLE account_reauth_intents (
  id TEXT PRIMARY KEY NOT NULL,
  state_hash TEXT NOT NULL UNIQUE CHECK (length(state_hash) = 64),
  account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('apple', 'google')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX account_reauth_intents_expiry ON account_reauth_intents(expires_at);
CREATE INDEX account_reauth_intents_owner ON account_reauth_intents(account_id, expires_at);
CREATE INDEX account_reauth_intents_session ON account_reauth_intents(source_session_id);

-- This status-only capability must survive the successful user FK cascade.
-- It retains no email, provider subject, credential, raw receipt or OAuth state.
CREATE TABLE account_deletion_receipts (
  receipt_hash TEXT PRIMARY KEY NOT NULL CHECK (length(receipt_hash) = 64),
  account_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('prepared', 'deleting', 'cloud-retired', 'completed')),
  apple_revocation TEXT CHECK (apple_revocation IN ('not-linked', 'revoked', 'manual')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  attempt_id TEXT,
  attempt_until INTEGER,
  CHECK ((attempt_id IS NULL) = (attempt_until IS NULL)),
  CHECK (phase NOT IN ('cloud-retired', 'completed') OR apple_revocation IS NOT NULL)
);
CREATE INDEX account_deletion_receipts_owner ON account_deletion_receipts(account_id, expires_at);
CREATE INDEX account_deletion_receipts_expiry ON account_deletion_receipts(expires_at);
