CREATE TABLE IF NOT EXISTS account_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(openid) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_expires ON account_sessions(expires_at);
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    allow_registration INTEGER NOT NULL DEFAULT 0 CHECK(allow_registration IN (0,1)),
    updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO system_settings(id,allow_registration,updated_at) VALUES(1,0,0);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    credential_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS application_crypto_config (
    id INTEGER PRIMARY KEY CHECK(id=1),
    key_id TEXT NOT NULL UNIQUE
);
