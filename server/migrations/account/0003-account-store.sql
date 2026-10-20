-- AccountStore SQLite baseline, applied inside its constructor transaction.
-- This is not an AUTH_DB/D1 migration. Version 3 is the current typed layout.
CREATE TABLE schema_metadata (version INTEGER NOT NULL);
CREATE TABLE account_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE pets (
  id TEXT PRIMARY KEY,
  initial_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE records (
  id TEXT PRIMARY KEY NOT NULL,
  pet_id TEXT REFERENCES pets(id),
  kind TEXT NOT NULL CHECK(kind IN ('event','routine','puppy','customActivity','customization','accountPreferences')),
  revision INTEGER NOT NULL CHECK(revision>=1),
  sequence INTEGER NOT NULL UNIQUE CHECK(sequence>=1),
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  updated_at INTEGER NOT NULL,
  data_json TEXT,
  CHECK((kind='accountPreferences' AND pet_id IS NULL) OR (kind!='accountPreferences' AND pet_id IS NOT NULL)),
  CHECK((kind IN ('event','routine') AND data_json IS NULL) OR (kind NOT IN ('event','routine') AND data_json IS NOT NULL AND json_valid(data_json)))
);

CREATE TABLE record_events (
  record_id TEXT PRIMARY KEY NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('pee','poop','meal','pottyTrip','walk','nap','custom')),
  at INTEGER NOT NULL CHECK(typeof(at)='integer' AND at BETWEEN -8640000000000000 AND 8640000000000000),
  end_state INTEGER NOT NULL DEFAULT 0 CHECK(end_state IN (0,1,2)),
  ended_at INTEGER CHECK(ended_at IS NULL OR (typeof(ended_at)='integer' AND ended_at BETWEEN -8640000000000000 AND 8640000000000000)),
  custom_label TEXT CHECK(custom_label IS NULL OR (typeof(custom_label)='text' AND length(trim(custom_label)) BETWEEN 1 AND 40)),
  note TEXT CHECK(note IS NULL OR (typeof(note)='text' AND length(note)<=16384)),
  source TEXT NOT NULL CHECK(source IN ('app','widget')),
  estimated INTEGER CHECK(estimated IN (0,1)),
  CHECK(type!='custom' OR custom_label IS NOT NULL),
  CHECK((end_state=0 AND ended_at IS NULL) OR (type='nap' AND ((end_state=1 AND ended_at IS NULL) OR (end_state=2 AND ended_at IS NOT NULL AND ended_at>=at))))
);

CREATE TABLE record_routines (
  record_id TEXT PRIMARY KEY NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('pee','poop','meal','pottyTrip','walk','nap','custom')),
  custom_label TEXT CHECK(custom_label IS NULL OR (typeof(custom_label)='text' AND length(trim(custom_label)) BETWEEN 1 AND 40)),
  minutes INTEGER NOT NULL CHECK(typeof(minutes)='integer' AND minutes BETWEEN 0 AND 1439),
  reminder INTEGER CHECK(reminder IN (0,1)),
  tolerance_minutes INTEGER CHECK(tolerance_minutes IS NULL OR (typeof(tolerance_minutes)='integer' AND tolerance_minutes BETWEEN 0 AND 1440)),
  CHECK(type!='custom' OR custom_label IS NOT NULL)
);

CREATE TABLE revisions (
  sequence INTEGER PRIMARY KEY,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(record_id, revision)
);
CREATE INDEX revisions_by_record ON revisions(record_id, revision DESC);
CREATE TABLE operations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE enrollments (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE enrolled_devices (
  id TEXT NOT NULL,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  PRIMARY KEY(id, pet_id)
);
CREATE INDEX records_by_pet_kind ON records(pet_id,kind,deleted);
INSERT INTO schema_metadata(version) VALUES (3);
