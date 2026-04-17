-- 0004_isos.sql — ISO library.
--
-- Matches the design in .claude/memory/multi_tenancy.md §Shared ISO
-- library: owner_id IS NULL → shared/admin-managed; owner_id = N →
-- per-user upload (accepted in the schema, exposed in handlers later
-- when per-user provisioning (#33) ships).

CREATE TABLE isos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER,                            -- NULL = shared
    name        TEXT    NOT NULL,                   -- basename on disk
    path        TEXT    NOT NULL UNIQUE,            -- absolute path; unique prevents two rows claiming the same file
    size        INTEGER NOT NULL,                   -- bytes
    format      TEXT    NOT NULL DEFAULT 'iso',     -- iso | qcow2 | raw | img
    status      TEXT    NOT NULL DEFAULT 'ready',   -- ready | uploading | error
    error       TEXT,                               -- message when status='error'
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE        INDEX idx_isos_owner      ON isos(owner_id);
CREATE        INDEX idx_isos_format     ON isos(format);
