-- myPA Marketplace schema. Idempotent: safe to run on every deploy.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  github_id     TEXT UNIQUE NOT NULL,
  login         TEXT NOT NULL,
  name          TEXT,
  email         TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publishers (
  slug                  TEXT PRIMARY KEY,            -- the id prefix of every widget it owns
  user_id               BIGINT NOT NULL REFERENCES users(id),
  name                  TEXT NOT NULL,
  url                   TEXT,
  bio                   TEXT,
  verified              BOOLEAN NOT NULL DEFAULT false,
  official              BOOLEAN NOT NULL DEFAULT false,
  license_public_key    TEXT NOT NULL,               -- SPKI PEM, published in the registry
  license_private_key   TEXT NOT NULL,               -- PKCS8 PEM, AES-256-GCM encrypted
  stripe_account_id     TEXT,
  stripe_charges_ready  BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS publishers_user ON publishers(user_id);

CREATE TABLE IF NOT EXISTS widgets (
  id              TEXT PRIMARY KEY,                  -- manifest id, e.g. acme.timer
  publisher_slug  TEXT NOT NULL REFERENCES publishers(slug),
  price_amount    INTEGER,                           -- minor units; NULL = free
  price_currency  TEXT NOT NULL DEFAULT 'USD',
  listed          BOOLEAN NOT NULL DEFAULT true,     -- publisher can unlist
  featured        BOOLEAN NOT NULL DEFAULT false,
  downloads       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS widget_versions (
  id            BIGSERIAL PRIMARY KEY,
  widget_id     TEXT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  manifest      JSONB NOT NULL,
  bundle_url    TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  review_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ,
  UNIQUE (widget_id, version)
);
CREATE INDEX IF NOT EXISTS widget_versions_status ON widget_versions(status);

CREATE TABLE IF NOT EXISTS purchases (
  id                 BIGSERIAL PRIMARY KEY,
  widget_id          TEXT NOT NULL REFERENCES widgets(id),
  stripe_session_id  TEXT UNIQUE NOT NULL,
  buyer_email        TEXT NOT NULL,
  amount             INTEGER NOT NULL,
  platform_fee       INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  license_key        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
