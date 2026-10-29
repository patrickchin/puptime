CREATE TABLE puppy_shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('household','temporary')),
  permission TEXT NOT NULL CHECK(permission IN ('contribute','view')),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER,
  invite_expires_at INTEGER NOT NULL,
  member_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK((kind='household' AND expires_at IS NULL AND permission='contribute') OR (kind='temporary' AND expires_at IS NOT NULL))
);
CREATE INDEX puppy_shares_owner_pet ON puppy_shares(owner_id,pet_id,created_at);
CREATE INDEX puppy_shares_member ON puppy_shares(member_id);
