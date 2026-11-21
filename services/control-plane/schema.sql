-- Kestrel control plane schema. Plain SQL that runs unchanged on SQLite (local
-- and tests, via node:sqlite) and PostgreSQL. Times are epoch milliseconds.
-- No photo, EXIF, image payload, provider key or raw token is ever stored.

CREATE TABLE IF NOT EXISTS accounts (
  account_id     TEXT PRIMARY KEY,
  email_hash     TEXT NOT NULL UNIQUE,          -- SHA-256 of the lower-cased email
  password_hash  TEXT NOT NULL,                 -- scrypt$N$r$p$salt$hash
  role           TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  status         TEXT NOT NULL DEFAULT 'active',-- 'active' | 'suspended'
  created_at_ms  INTEGER NOT NULL,
  ai_consent     INTEGER NOT NULL DEFAULT 0     -- standing "use Gemini" preference, separate from per-request consent
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash     TEXT PRIMARY KEY,              -- SHA-256 of the opaque token
  account_id     TEXT NOT NULL REFERENCES accounts(account_id),
  expires_at_ms  INTEGER NOT NULL,
  revoked        INTEGER NOT NULL DEFAULT 0
);

-- One row per licence. licence_id is the id inside the signed KESTREL1 key
-- (src/core/licence.ts), so offline keys and the server agree on identity.
CREATE TABLE IF NOT EXISTS licences (
  licence_id         TEXT PRIMARY KEY,
  account_id         TEXT REFERENCES accounts(account_id),
  plan               TEXT NOT NULL,             -- 'free' | 'paid' | 'subscriber' (commercialAccess.ts)
  managed_ai         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active', -- 'active' | 'trial' | 'expired' | 'revoked'
  max_devices        INTEGER NOT NULL DEFAULT 3,
  offline_grace_days INTEGER NOT NULL DEFAULT 30,
  valid_until_ms     INTEGER,
  updated_at_ms      INTEGER NOT NULL,
  note               TEXT,                      -- admin's note, e.g. who a gift key is for
  major_version      INTEGER NOT NULL DEFAULT 1, -- the major app version this licence covers
  paid               INTEGER NOT NULL DEFAULT 0, -- 1 only when money was received
  source             TEXT NOT NULL DEFAULT 'key', -- 'purchase' | 'gift' | 'key'
  email_hash         TEXT                       -- SHA-256 of the email an unclaimed entitlement waits for
);

CREATE TABLE IF NOT EXISTS device_activations (
  activation_id  TEXT PRIMARY KEY,
  licence_id     TEXT NOT NULL REFERENCES licences(licence_id),
  device_hash    TEXT NOT NULL,                 -- SHA-256 hex computed on the device
  platform       TEXT NOT NULL,                 -- 'windows' | 'macos' | 'web' | 'ios' | 'android'
  app_version    TEXT NOT NULL,
  last_seen_ms   INTEGER NOT NULL,
  UNIQUE (licence_id, device_hash)
);

CREATE TABLE IF NOT EXISTS ai_usage_quotas (
  account_id         TEXT PRIMARY KEY REFERENCES accounts(account_id),
  period_start_ms    INTEGER NOT NULL,
  requests_used      INTEGER NOT NULL DEFAULT 0,
  requests_limit     INTEGER NOT NULL DEFAULT 500,
  cost_micros_used   INTEGER NOT NULL DEFAULT 0,
  cost_micros_limit  INTEGER NOT NULL DEFAULT 2000000
);

CREATE TABLE IF NOT EXISTS billing_events (
  event_id       TEXT PRIMARY KEY,              -- provider event id: idempotency key
  event_type     TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL
);

-- Assets served in the signed data manifest (dataUpdateManifest.ts shape).
CREATE TABLE IF NOT EXISTS model_assets (
  asset_id         TEXT NOT NULL,               -- e.g. 'species-model'
  kind             TEXT NOT NULL,               -- 'onnx' | 'species-library' | 'equipment'
  version          TEXT NOT NULL,
  channel          TEXT NOT NULL DEFAULT 'stable',
  path             TEXT NOT NULL,               -- '/data/...', never absolute or '..'
  sha256           TEXT NOT NULL,
  bytes            INTEGER NOT NULL,
  required_app_min TEXT NOT NULL DEFAULT '0.0.0',
  status           TEXT NOT NULL DEFAULT 'candidate', -- 'candidate' | 'live' | 'retired'
  created_at_ms    INTEGER NOT NULL,
  PRIMARY KEY (asset_id, version, channel)
);

CREATE TABLE IF NOT EXISTS desktop_releases (
  platform        TEXT NOT NULL,                -- 'windows' | 'macos'
  channel         TEXT NOT NULL DEFAULT 'stable',
  version         TEXT NOT NULL,
  url             TEXT NOT NULL,                -- allow-listed release page only
  notes           TEXT NOT NULL DEFAULT '',
  min_supported   TEXT NOT NULL DEFAULT '0.0.0',
  published_at_ms INTEGER NOT NULL,
  PRIMARY KEY (platform, channel, version)
);

CREATE TABLE IF NOT EXISTS settings (
  name   TEXT PRIMARY KEY,                      -- e.g. 'ai_killswitch', 'manifest_revision'
  value  TEXT NOT NULL
);

-- Append-only. Nothing in the service updates or deletes rows here.
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id       TEXT PRIMARY KEY,              -- random UUID; order by at_ms
  at_ms          INTEGER NOT NULL,
  actor          TEXT NOT NULL,                 -- account id or 'anonymous'
  action         TEXT NOT NULL,
  outcome        TEXT NOT NULL,                 -- 'allowed' | 'denied'
  detail         TEXT NOT NULL DEFAULT ''
);

-- Website contact form. Stored only with the sender's consent; deleted on request.
CREATE TABLE IF NOT EXISTS contact_messages (
  message_id     TEXT PRIMARY KEY,
  received_at_ms INTEGER NOT NULL,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  message        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'new'  -- 'new' | 'read' | 'answered'
);
