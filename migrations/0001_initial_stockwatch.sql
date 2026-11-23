-- Additive baseline for fresh and previously initialized databases. No seed or user data.

-- stocks-schema.sql
-- Minimal local catalog schema. The full stocks.sql file additionally imports stock names.
CREATE TABLE IF NOT EXISTS stocks (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    market TEXT NOT NULL
);

-- users-schema.sql
-- Schema only; never place user data in this file.
CREATE TABLE IF NOT EXISTS users (
    openid TEXT PRIMARY KEY,
    nickname TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_stocks (
    openid TEXT NOT NULL,
    symbol TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(openid,symbol),
    FOREIGN KEY(openid) REFERENCES users(openid) ON DELETE CASCADE
);

-- user_settings.sql
CREATE TABLE IF NOT EXISTS user_settings (
    openid TEXT NOT NULL,
    setting_type TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (openid, setting_type),

    FOREIGN KEY (openid) REFERENCES users(openid)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_settings_type_enabled
ON user_settings(setting_type, enabled);

-- accounts.sql
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

-- tags.sql
CREATE TABLE IF NOT EXISTS tags (
    tag_code TEXT PRIMARY KEY CHECK (tag_code GLOB 'BK[0-9][0-9][0-9][0-9]'),
    tag_name TEXT NOT NULL,
    tag_type TEXT NOT NULL CHECK (
        tag_type IN ('概念板块', '地域板块', '行业板块')
    ),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 常见查询：按类型筛标签
CREATE INDEX IF NOT EXISTS idx_tags_type_code
ON tags(tag_type, tag_code);

-- 常见查询：按 tag_name 反查 tag_code
CREATE INDEX IF NOT EXISTS idx_tags_name_code
ON tags(tag_name, tag_code);

-- 概念板块

-- stock_tags.sql
CREATE TABLE IF NOT EXISTS stock_tags (
    symbol TEXT NOT NULL,
    tag_code TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (symbol, tag_code),

    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    FOREIGN KEY (tag_code) REFERENCES tags(tag_code)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- 场景1：给定标签，反查成分股
CREATE INDEX IF NOT EXISTS idx_stock_tags_tag_symbol
ON stock_tags(tag_code, symbol);

-- 场景2：给定股票，按标签快速遍历
CREATE INDEX IF NOT EXISTS idx_stock_tags_symbol_tag
ON stock_tags(symbol, tag_code);

-- news_tags.sql
CREATE TABLE IF NOT EXISTS news_tags (
    news_id TEXT NOT NULL CHECK (length(trim(news_id)) > 0),
    tag_code TEXT NOT NULL,
    effect_type TEXT NOT NULL CHECK (effect_type IN ('利好', '利空')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (news_id, tag_code),

    FOREIGN KEY (tag_code) REFERENCES tags(tag_code)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- 场景：给定 news_id，快速拿到利好/利空标签
CREATE INDEX IF NOT EXISTS idx_news_tags_news_effect_created
ON news_tags(news_id, effect_type, created_at DESC);

-- earnings_forecast.sql
CREATE TABLE IF NOT EXISTS earnings_forecast (
    symbol TEXT NOT NULL,
    update_time DATETIME NOT NULL,

    summary TEXT,
    forecast_detail JSON NOT NULL,

    forecast_netprofit_yoy REAL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (symbol, update_time),

    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- 排序优化索引
CREATE INDEX IF NOT EXISTS idx_earnings_forecast_yoy
ON earnings_forecast(forecast_netprofit_yoy DESC);


-- Generated from a_stock_profit_forecast.csv

-- stock_analysis.sql
CREATE TABLE IF NOT EXISTS stock_analysis (
    symbol TEXT NOT NULL,
    analysis_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    conclusion TEXT NOT NULL CHECK (
        conclusion IN ('重大利好', '利好', '中性', '利空', '重大利空')
    ),

    core_logic TEXT NOT NULL,
    risk_warning TEXT NOT NULL,

    PRIMARY KEY (symbol, analysis_time),

    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- 查询优化索引
CREATE INDEX IF NOT EXISTS idx_stock_analysis_time
ON stock_analysis(analysis_time);

-- monitoring.sql
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
