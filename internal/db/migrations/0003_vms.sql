-- 0003_vms.sql — ownership + lock state for libvirt domains.
--
-- libvirt is the source of truth for VM existence and runtime state.
-- This table is the source of truth for WHO owns each VM and whether
-- it's protected from destructive operations.
--
-- A libvirt domain without a row here is "unowned" — admin can see it
-- and has the choice to claim it or leave it alone. Regular users
-- never see unowned VMs (no auto-adoption — would leak pre-existing
-- VMs to the first non-admin who logs in).
--
-- uuid is the libvirt domain UUID (canonical 36-char form). It's the
-- primary key because we don't need our own surrogate — libvirt's UUID
-- is stable across hypervisor restarts and unique.

CREATE TABLE vms (
    uuid        TEXT    PRIMARY KEY,                   -- libvirt domain UUID
    owner_id    INTEGER NOT NULL,                      -- FK users.id
    name        TEXT    NOT NULL,                      -- libvirt name at adoption time (denormalized for search)
    locked      INTEGER NOT NULL DEFAULT 0,            -- if 1, refuse destructive ops in API
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- A user should not have two VMs with the same display name — keeps
-- admin mental model sane. libvirt enforces system-wide uniqueness on
-- names already, so this is really per-owner uniqueness across the
-- subset they own.
CREATE UNIQUE INDEX idx_vms_owner_name ON vms(owner_id, name);
CREATE        INDEX idx_vms_owner      ON vms(owner_id);
