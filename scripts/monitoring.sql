-- Additive and idempotent: safe for an existing API database.
CREATE TABLE IF NOT EXISTS monitor_instruments (
    symbol TEXT NOT NULL CHECK(length(symbol)=6),
    market TEXT NOT NULL CHECK(market IN ('SH','SZ')),
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('stock','etf')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    PRIMARY KEY(market,symbol)
);
CREATE TABLE IF NOT EXISTS monitor_rules (
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
    FOREIGN KEY(market,symbol) REFERENCES monitor_instruments(market,symbol) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_monitor_rules_enabled ON monitor_rules(enabled,market,symbol);
CREATE TABLE IF NOT EXISTS monitor_quotes (
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY(market,symbol),
    FOREIGN KEY(market,symbol) REFERENCES monitor_instruments(market,symbol) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS monitor_events (
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
CREATE INDEX IF NOT EXISTS idx_monitor_events_due ON monitor_events(status,next_attempt_at,lease_until);
CREATE TABLE IF NOT EXISTS monitor_locks (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_runs (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL,
    quote_count INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_started ON monitor_runs(started_at);
CREATE TABLE IF NOT EXISTS monitor_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    monitor_enabled INTEGER CHECK(monitor_enabled IN (0,1)),
    webhook_url TEXT,
    webhook_token TEXT
);
