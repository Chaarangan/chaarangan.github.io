CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash    TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments(slug, created_at);
CREATE TABLE IF NOT EXISTS claps (
  slug       TEXT NOT NULL,
  ip_hash    TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (slug, ip_hash)
);
CREATE TABLE IF NOT EXISTS medium (
  slug       TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  claps      INTEGER,
  responses  INTEGER,
  updated_at INTEGER NOT NULL
);
