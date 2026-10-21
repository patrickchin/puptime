-- Incremental migration: retain every existing record, revision and acknowledgment.
CREATE TABLE api_requests (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
CREATE INDEX records_by_scope_sequence ON records(kind, pet_id, deleted, sequence);
CREATE INDEX record_events_by_at ON record_events(at, record_id);
CREATE INDEX record_events_by_type_at ON record_events(type, at, record_id);
UPDATE schema_metadata SET version=4;
