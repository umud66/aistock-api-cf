-- UI session and encrypted notification configuration.
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    credential_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS monitor_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    monitor_enabled INTEGER CHECK(monitor_enabled IN (0,1)),
    webhook_url TEXT,
    webhook_token TEXT
);
