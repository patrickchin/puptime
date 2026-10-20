-- A deletion first marks its owner, then snapshots provider credentials for
-- revocation. Freeze credential writes atomically, including OAuth callbacks
-- that started earlier; session creation remains available for OTP recovery.
CREATE TRIGGER account_reject_insert_while_deleting
BEFORE INSERT ON account
WHEN EXISTS (SELECT 1 FROM cloud_accounts WHERE account_id = NEW.userId AND state = 'deleting')
BEGIN
  SELECT RAISE(ABORT, 'account_deleting');
END;

CREATE TRIGGER account_reject_update_while_deleting
BEFORE UPDATE ON account
WHEN EXISTS (SELECT 1 FROM cloud_accounts WHERE account_id IN (OLD.userId, NEW.userId) AND state = 'deleting')
BEGIN
  SELECT RAISE(ABORT, 'account_deleting');
END;
