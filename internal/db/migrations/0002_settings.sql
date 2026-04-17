-- 0002_settings.sql — encrypted-at-rest per-user settings store.
-- Matches the schema in .claude/memory/multi_tenancy.md §Settings / Secrets.
--
-- owner_id = NULL → system-wide setting (admin-only API, not exposed yet)
-- owner_id = <n>  → per-user setting (pull secret, SSH key, token)

CREATE TABLE settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id        INTEGER,                                  -- NULL = system
    key             TEXT    NOT NULL,
    value_encrypted BLOB    NOT NULL,                         -- AES-256-GCM (nonce||ct||tag)
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- SQLite treats NULL as distinct in plain UNIQUE indexes, so multiple
-- system-wide rows for the same key would slip through a naive UNIQUE
-- constraint. Use an expression index coalescing NULL to -1 so (system,
-- 'foo') is unique and (user-42, 'foo') is unique, separately.
CREATE UNIQUE INDEX idx_settings_owner_key ON settings(IFNULL(owner_id, -1), key);
CREATE INDEX        idx_settings_owner     ON settings(owner_id);
