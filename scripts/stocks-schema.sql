-- Minimal local catalog schema. The full stocks.sql file additionally imports stock names.
CREATE TABLE IF NOT EXISTS stocks (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    market TEXT NOT NULL
);
