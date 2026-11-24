-- Personal business data is isolated from the legacy global monitoring tables.
-- Preserve all legacy rows without assigning them to an arbitrary user.
-- Additive and idempotent: safe for an existing API database.
CREATE TABLE IF NOT EXISTS user_monitor_instruments (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL CHECK(length(symbol)=6),
    market TEXT NOT NULL CHECK(market IN ('SH','SZ')),
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('stock','etf')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    PRIMARY KEY(user_id,market,symbol)
);
CREATE TABLE IF NOT EXISTS user_monitor_rules (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    market TEXT NOT NULL,
    metric TEXT NOT NULL CHECK(metric IN ('price','change_percent')),
    operator TEXT NOT NULL CHECK(operator IN ('above','below','cross_above','cross_below')),
    threshold REAL NOT NULL,
    cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK(cooldown_seconds>=60),
    daily_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_limit BETWEEN 1 AND 100),
    auto_disable INTEGER NOT NULL DEFAULT 0 CHECK(auto_disable IN (0,1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    previous_value REAL,
    previous_time INTEGER,
    last_triggered_at INTEGER,
    count_day TEXT,
    daily_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id,market,symbol) REFERENCES user_monitor_instruments(user_id,market,symbol) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_monitor_rules_enabled ON user_monitor_rules(user_id,enabled,market,symbol);
CREATE TABLE IF NOT EXISTS user_monitor_quotes (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,market,symbol),
    FOREIGN KEY(user_id,market,symbol) REFERENCES user_monitor_instruments(user_id,market,symbol) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_monitor_events (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    id TEXT PRIMARY KEY,
    rule_id TEXT,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0,
    http_status INTEGER,
    last_error TEXT,
    sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_monitor_events_due ON user_monitor_events(user_id,status,next_attempt_at,lease_until);
CREATE TABLE IF NOT EXISTS user_monitor_locks (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS user_monitor_runs (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL,
    quote_count INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_monitor_runs_started ON user_monitor_runs(user_id,started_at);
CREATE TABLE IF NOT EXISTS user_monitor_settings (
    user_id TEXT PRIMARY KEY REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    monitor_enabled INTEGER NOT NULL DEFAULT 0 CHECK(monitor_enabled IN (0,1)),
    webhook_url TEXT,
    webhook_token TEXT
);
