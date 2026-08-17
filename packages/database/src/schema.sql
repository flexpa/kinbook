PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  sex          TEXT NOT NULL DEFAULT 'unknown',
  notes        TEXT,
  line         TEXT,
  direct_line  INTEGER NOT NULL DEFAULT 0,
  maiden       TEXT,
  nickname     TEXT
);

CREATE TABLE IF NOT EXISTS name_parts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  given      TEXT NOT NULL DEFAULT '',
  surname    TEXT NOT NULL DEFAULT '',
  prefix     TEXT,
  suffix     TEXT,
  preferred  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_name_parts_person ON name_parts(person_id);

CREATE TABLE IF NOT EXISTS places (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS place_parts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id  TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  part      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  date_qualifier TEXT,
  date_calendar  TEXT,
  date_year      INTEGER,
  date_month     INTEGER,
  date_day       INTEGER,
  date_text      TEXT,
  place_id       TEXT REFERENCES places(id),
  notes          TEXT,
  value          TEXT,
  source         TEXT,
  confidence     TEXT
);

CREATE TABLE IF NOT EXISTS person_events (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, event_id)
);

CREATE TABLE IF NOT EXISTS families (
  id     TEXT PRIMARY KEY,
  type   TEXT NOT NULL DEFAULT 'spousal',
  notes  TEXT
);

CREATE TABLE IF NOT EXISTS family_members (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,             -- 'husband' | 'wife' | 'child'
  PRIMARY KEY (family_id, person_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  author      TEXT,
  publication TEXT,
  text        TEXT
);

CREATE TABLE IF NOT EXISTS citations (
  id        TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  event_id  TEXT REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  page      TEXT,
  quality   TEXT            -- 'primary' | 'secondary'
);

CREATE TABLE IF NOT EXISTS media (
  id       TEXT PRIMARY KEY,
  file_ref TEXT,
  mime     TEXT,
  caption  TEXT
);

CREATE TABLE IF NOT EXISTS media_links (
  media_id  TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  family_id TEXT REFERENCES families(id) ON DELETE CASCADE,
  event_id  TEXT REFERENCES events(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id   TEXT PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_notes (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, note_id)
);

CREATE TABLE IF NOT EXISTS repositories (
  id   TEXT PRIMARY KEY,
  name TEXT
);