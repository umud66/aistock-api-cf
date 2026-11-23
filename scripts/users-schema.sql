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
