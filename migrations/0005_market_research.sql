CREATE TABLE IF NOT EXISTS user_market_analyses (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    model TEXT NOT NULL,
    report TEXT NOT NULL,
    evidence TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,symbol)
);
CREATE TABLE IF NOT EXISTS user_analysis_locks (
    user_id TEXT NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,symbol)
);
