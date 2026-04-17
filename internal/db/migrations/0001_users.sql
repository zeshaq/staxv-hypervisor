-- 0001_users.sql — initial users table
-- Matches the schema in .claude/memory/multi_tenancy.md §User Model.
-- Fields added later (quotas, ssh_enabled) are already included so no
-- retroactive migrations are needed when the multi-tenancy epic (#33)
-- lands the real useradd flow.

CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    NOT NULL UNIQUE,
    password_hash   TEXT    NOT NULL,

    -- Linux account the staxv user is backed by. unix_uid is also the
    -- cross-host correlation key; cluster-manager propagates it.
    unix_username   TEXT    NOT NULL,
    unix_uid        INTEGER NOT NULL,
    adopted         INTEGER NOT NULL DEFAULT 0,   -- 1 if Unix acct pre-existed

    -- Filesystem roots. home_path is the file-manager scope; staxv_dir
    -- holds app-managed artifacts (disk_images, isos, clusters).
    home_path       TEXT    NOT NULL,
    staxv_dir       TEXT    NOT NULL,

    is_admin        INTEGER NOT NULL DEFAULT 0,
    ssh_enabled     INTEGER NOT NULL DEFAULT 0,

    -- Hard quotas (0 = unlimited for this iteration; #33 will set defaults).
    quota_vcpus     INTEGER NOT NULL DEFAULT 0,
    quota_ram_mb    INTEGER NOT NULL DEFAULT 0,
    quota_disk_gb   INTEGER NOT NULL DEFAULT 0,
    quota_vms       INTEGER NOT NULL DEFAULT 0,
    quota_clusters  INTEGER NOT NULL DEFAULT 0,

    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at     DATETIME                                -- NULL = active
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_unix_uid ON users(unix_uid);
