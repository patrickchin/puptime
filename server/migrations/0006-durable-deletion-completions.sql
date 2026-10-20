-- Permanent status-only proof: no original owner or authentication material.
CREATE TABLE account_deletion_completions (
  receipt_hash TEXT PRIMARY KEY NOT NULL CHECK (length(receipt_hash) = 64),
  apple_revocation TEXT NOT NULL CHECK (apple_revocation IN ('not-linked', 'revoked', 'manual'))
);

-- Preserve known completions even past their former TTL, if not already purged.
INSERT INTO account_deletion_completions(receipt_hash,apple_revocation)
SELECT r.receipt_hash,r.apple_revocation FROM account_deletion_receipts r
WHERE r.phase='completed' AND NOT EXISTS(SELECT 1 FROM user WHERE id=r.account_id);
DELETE FROM account_deletion_receipts
WHERE phase='completed' AND receipt_hash IN (SELECT receipt_hash FROM account_deletion_completions);
