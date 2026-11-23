-- Only a key reference lives in D1. The generated secret is stored in the bound KV.
CREATE TABLE IF NOT EXISTS application_crypto_config (
    id INTEGER PRIMARY KEY CHECK(id=1),
    key_id TEXT NOT NULL UNIQUE
);
