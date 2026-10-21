-- Generated additively by Better Auth 1.7.12 getMigrations().compileMigrations().
create table "apikey" ("id" text not null primary key, "configId" text not null, "name" text, "start" text, "referenceId" text not null, "prefix" text, "key" text not null, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" date, "enabled" integer, "rateLimitEnabled" integer, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" date, "expiresAt" date, "createdAt" date not null, "updatedAt" date not null, "permissions" text, "metadata" text);

create index "apikey_configId_idx" on "apikey" ("configId");

create index "apikey_referenceId_idx" on "apikey" ("referenceId");

create index "apikey_key_idx" on "apikey" ("key");

-- Puptime keys always reference a user. Keep that invariant during concurrent
-- account deletion; the plugin supports organization references too and therefore
-- does not generate a user foreign key itself.
CREATE TRIGGER apikey_reject_insert_without_active_owner
BEFORE INSERT ON apikey
WHEN NOT EXISTS (SELECT 1 FROM user WHERE id = NEW.referenceId)
  OR EXISTS (SELECT 1 FROM cloud_accounts WHERE account_id = NEW.referenceId AND state = 'deleting')
BEGIN
  SELECT RAISE(ABORT, 'account_unavailable');
END;

CREATE TRIGGER apikey_reject_owner_change
BEFORE UPDATE OF referenceId ON apikey
WHEN NEW.referenceId != OLD.referenceId
BEGIN
  SELECT RAISE(ABORT, 'api_key_owner_immutable');
END;

CREATE TRIGGER user_delete_apikeys
AFTER DELETE ON user
BEGIN
  DELETE FROM apikey WHERE referenceId = OLD.id;
END;
