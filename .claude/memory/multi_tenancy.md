# Multi-Tenancy Design

Every user owns their own VMs, clusters, files. No cross-user visibility
except by admins. Baked in from scaffold, not retrofitted.

## Authentication Backend (LOCKED 2026-04-17)

`[auth] backend` in config selects how passwords are verified:

- **`"db"`** (default) — bcrypt hash in `users.password_hash`. Self-contained,
  no host dependencies. Use for bootstrap admin / when Linux accounts
  aren't desired.
- **`"pam"`** — shell out to `pamtester <service> <user> authenticate`
  (password on stdin). Cgo-free. Users log in with their **Linux
  password** from `/etc/shadow`. Requires:
  - `apt install pamtester`
  - `/etc/pam.d/staxv-hypervisor` (Ubuntu: just `@include common-auth` +
    `@include common-account` — pulls pam_unix + pam_faillock +
    pam_pwquality for free)
  - Each staxv user **pre-linked** via `useradd --link-existing` so
    there's a staxv row tying username → unix_username + UID + quotas +
    is_admin. No auto-provisioning on first PAM success — that would
    let every Linux account on the host into the web UI.

**No per-user backend.** Global config only. YAGNI until a real
hybrid use case appears; at that point add `users.auth_type` column.

**Switching backends orphans users who don't fit the new mode**: a DB
user with no Linux account can't PAM-auth; a link-existing user with
empty `password_hash` can't DB-auth. Admin re-link required when
switching — deliberate and rare.

The HTTP layer is backend-agnostic: handlers depend on
`pkg/auth.CredentialVerifier`. DB and PAM both satisfy it. LDAP/OIDC
can be added the same way later.

## User Identity Model — Linux Users (LOCKED 2026-04-17)

Each staxv user is backed by a **real Linux/Unix account** on the host.
Not an app-only SQLite row. This is the pivotal architectural choice:

- **Defense in depth**: two independent isolation layers — (a) app-layer
  `owner_id` checks, (b) kernel Unix permissions on `/home/<user>`. An
  app bug (path traversal, auth bypass) does NOT automatically expose
  everyone, because the kernel still enforces UID ownership.
- `/home/<user>/.staxv/` is natural; filesystem disk quotas via
  `setquota` work out of the box.
- libvirt `dynamic_ownership=1` handles qcow2 chown at VM start/stop.
- Rejected alternative: app-only users with files under
  `/var/lib/staxv/users/<id>/`, all owned by the staxv service user.
  Weaker isolation (single app-layer line of defense); did not justify
  the operational simplicity.

### Username rules (enforced at creation)
- Regex: `^[a-z][a-z0-9-]{1,31}$`. Lowercase Linux-safe, no dots, no
  uppercase, no emails-as-usernames. If you want display names, add a
  separate `display_name` column later.
- **Reserved / blocked** (reject in `useradd`):
  - `root`, `admin`, `staxv`, `daemon`, `nobody`, `www-data`, `mysql`,
    `postgres`, `libvirt`, `libvirt-qemu`, `libvirt-dnsmasq`, `kvm`
  - Anything starting with `systemd-`, `_`, or matching an existing
    account with UID < 1000 (system accounts)
  - Anything currently holding a staxv service role

### UID range for staxv-created accounts
- Use UID_MIN=20000 when creating: `useradd -K UID_MIN=20000 -m -s
  /usr/sbin/nologin <name>`. Gives a clean namespace — `awk -F: '$3>=20000
  {print}' /etc/passwd` lists all staxv-managed accounts.
- If adopting a pre-existing account (UID outside this range), flag it
  `adopted=true` in the `users` row. Never `userdel` an adopted account
  on user deletion.

### Shell
- Default `-s /usr/sbin/nologin`. Staxv users log in via web UI only.
- Admin can opt-in per-user: `PATCH /api/admin/users/:id {ssh_enabled:
  true}` → `chsh -s /bin/bash <user>` + add to `ssh-allowed` group if
  the host uses `AllowGroups`. Documented, deliberate, per-user.

### Privileged host operations — one package, narrow surface
All `useradd` / `userdel` / `chown` / `setfacl` / `chsh` calls go through
`internal/provision/` with:
- Argument allowlisting (no string concat into `exec.Command`)
- Each op has a typed Go function (`provision.CreateUser(ctx, UserSpec)`)
- UserSpec validated against the regex + reserved list before any shell
  reaches
- Every call logged to `audit_log` with args + exit code
- Unit tests with a fake `exec.Cmd` to assert argument shape

### Soft delete
- `DELETE /api/admin/users/:id` sets `disabled_at`, stops the user's
  libvirt pool, disables login. Does NOT `userdel`, does NOT remove
  `/home/<user>`.
- Hard delete is a separate admin CLI: `staxv-hypervisor userdel --purge
  <name>`. Prompts for confirmation twice. Never exposed over HTTP.

## Fleet-Wide vs Per-Hypervisor Identity (LOCKED 2026-04-17)

Multi-tenancy here is **per-hypervisor**. A staxv user "alice" lives on
one host's `users` table + `/etc/passwd`. "alice" on dl385 and "alice"
on dl385-2 are, at the hypervisor level, independent users. The
hypervisor has **no concept of other hypervisors** and never queries
another hypervisor's user list.

**Fleet-wide identity** (one "alice" who owns VMs across the fleet) is
staxv-cluster-manager's responsibility. Cluster-manager is:
- The **UID registry** — assigns UID 20005 to alice once, propagates
  that same UID to every hypervisor where she exists
- The **enrollment authority** — provisions Linux accounts on
  hypervisors by calling the hypervisor's `useradd` gRPC RPC
- The **unified view** — its web UI shows alice her VMs fleet-wide
- The **placement decision** — picks which hypervisor(s) she lives on

Cluster-manager does NOT re-implement multi-tenancy. It orchestrates
the hypervisor's existing per-host model; the only new requirement is
that UIDs line up across hosts.

### Three deployment shapes

| Shape | Admin flow | User flow |
|---|---|---|
| Single hypervisor (homelab, pre-cluster-manager) | `staxv-hypervisor useradd alice` on that host | Login to hypervisor web UI, manage VMs |
| Multi-hypervisor, no cluster-manager (v0.x era) | `useradd alice --uid 20005` manually on each host (same UID!) | Independent login per host; no cross-host view |
| Multi-hypervisor with cluster-manager (v2+) | Create alice once in cluster-manager UI | Login to cluster-manager UI; sees fleet-wide view |

In all three shapes, **direct hypervisor login still works** — it's
the break-glass path when cluster-manager is down, and the debugging
path for admins.

### UID coordination rule
Alice's Linux UID must be **identical on every hypervisor** where she
exists. Required for:
- **Live migration**: qcow2 files carry UID ownership; destination
  host must have the same UID or the migrated VM cannot read its
  own disk.
- **Shared storage**: NFS / iSCSI POSIX permissions.
- **Audit correlation**: "UID 20005 did X" means the same person
  across host logs.

Pre-cluster-manager: admin's discipline (always pass `--uid`).
Post-cluster-manager: cluster-manager enforces.

### What v0.1 hypervisor must support (to be federation-ready)
- `unix_uid` column in `users` table — already in schema
- `staxv-hypervisor useradd --uid <n>` CLI flag — so cluster-manager
  (later) can dictate the UID. If omitted, hypervisor picks next free
  UID ≥ 20000.
- Admin API `POST /api/admin/users` accepts `{uid: <n>, ...}`.
- No cross-host references anywhere in hypervisor code.

## User Model

SQLite `users` table:
- `id` INTEGER PK
- `username` TEXT UNIQUE
- `password_hash` TEXT (bcrypt)
- `unix_username` TEXT — the Linux account (usually == `username`)
- `unix_uid` INTEGER — cached from `os/user.Lookup`; sanity-check on every login
- `adopted` BOOLEAN — true if we didn't create the Unix account; blocks `userdel` on hard-delete
- `home_path` TEXT — resolved via `os/user.Lookup(unix_username).HomeDir`, never hardcoded. File manager is rooted here (e.g. `/home/alice`).
- `staxv_dir` TEXT — `<home_path>/.staxv` — where the app keeps per-user artifacts
- `is_admin` BOOLEAN
- `ssh_enabled` BOOLEAN — default false; admin opts in per-user
- `quota_vcpus`, `quota_ram_mb`, `quota_disk_gb`, `quota_vms`, `quota_clusters` INTEGER
- `created_at`, `disabled_at`

JWT claims: `user_id`, `username`, `is_admin`. Middleware loads user into
`ctx` for every handler. No handler reads user from JWT directly — always
from context, set by auth middleware.

## Ownership Enforcement — Two Layers

**Layer 1: SQLite ownership table (source of truth)**
Every owned resource has `owner_id` FK to `users.id`:
- `vms(uuid, owner_id, name, ...)` — maps libvirt domain UUID → owner
- `clusters(id, owner_id, ...)`
- `isos(id, owner_id, ...)` (user-uploaded; base library has `owner_id = NULL` = shared read-only)
- `networks(id, owner_id, ...)` (user-created libvirt networks only; host bridges are shared)
- `snapshots(id, vm_uuid, owner_id)`
- `jobs(id, owner_id, ...)`
- `files_uploaded(id, owner_id, path, ...)` (for audit/quota; path must start with home_path)

**Layer 2: libvirt metadata element (disaster recovery)**
Every domain created by staxv includes:
```xml
<metadata>
  <staxv:owner xmlns:staxv="https://staxv.io/schema">42</staxv:owner>
</metadata>
```
Used to rebuild DB ownership if SQLite is lost. Never trusted over DB.

**No name-prefix scheme.** Users pick their own VM names; uniqueness is
per-owner (`UNIQUE(owner_id, name)`), not global.

## API Scoping Pattern

Every list/get handler filters by `ctx.User().ID` unless `is_admin`:
```go
func (h *VMHandler) List(w, r) {
    u := auth.UserFromCtx(r.Context())
    vms, err := h.db.ListVMsForUser(r.Context(), u.ID) // admin gets all
}
```
Helper `db.RequireOwnedByUser(ctx, resourceID, userID)` returns
`ErrNotFound` (not `ErrForbidden`) on mismatch — don't leak existence of
other users' resources.

## File Manager Scoping (the hard one)

Each user's file ops are chrooted *logically* to `home_path`:

1. Accept a logical path from client (e.g. `/projects/foo.iso`).
2. Join with `home_path` → abs path.
3. `filepath.Clean` + `filepath.Abs`.
4. Resolve symlinks via `filepath.EvalSymlinks`.
5. **Reject if resolved path does not have `home_path` as prefix.**
6. Reject if any path component is `..` after cleaning (defense in depth).

Path validator lives in one place: `internal/files/path.go::ResolveForUser(u, p)`.
Every file handler calls it — upload, download, list, delete, rename,
mkdir. **No handler constructs paths manually.**

Symlink handling: by default, reject symlinks pointing outside home.
Optional admin flag to follow shared-readonly symlinks (e.g. base ISO
library mounted read-only into every user's home).

Upload enforces quota (`sum(size) where owner_id = u.id <= quota_disk_gb`).

## Console / Terminal Scoping

- **VNC console** (`/vm-console-ws`): check VM ownership *before* WebSocket
  upgrade. Reject with 404 if not owned. Never leak that VM exists.
- **VM serial** (`/vm-terminal-ws`): same.
- **Host terminal** (`/terminal-ws`): **admin-only**. Full host shell
  access to non-admins is a non-starter. (Future: per-user confined shell
  via `systemd-nspawn` or chroot, if needed.)

## Storage Layout on Host

Per-user artifacts live inside the Linux user's **actual home directory**,
not `/var/lib/staxv/`. This matches user expectation ("my stuff is in my
home"), gives us disk quotas via filesystem `setquota` for free, and lets
advanced users `ssh` in and inspect their own artifacts.

```
/home/alice/                  — file manager root
├── .staxv/
│   ├── disk_images/          — qcow2 disks (libvirt pool: user-alice)
│   ├── isos/                 — user-uploaded ISOs
│   └── clusters/             — OpenShift cluster artifacts
└── ... (user's own files, also in file-manager scope)

/home/bob/                    — same structure
└── .staxv/ ...

/var/lib/staxv/
├── shared/
│   ├── isos/                 — base ISO library, admin-only write
│   └── base-images/          — cloud images for VM create
├── staxv.db                  — SQLite
└── config.toml

/etc/staxv-hypervisor/
└── config.toml               — symlink or primary config
```

### libvirt storage pool per user
- Name: `user-<username>`
- Type: `dir`
- Target: `<home_path>/.staxv/disk_images`
- Created at user-provisioning time via libvirt API (`virStoragePoolDefineXML`).
- Ownership: owned by the Unix user; libvirt `dynamic_ownership=1`
  (Ubuntu default) chowns disk files to `libvirt-qemu:kvm` at VM start
  and restores at stop. Don't fight this — rely on it.

### Why not `/var/lib/staxv/users/...`
Rejected. Users expect their artifacts in `/home/<user>`. Filesystem
quotas on `/home` are standard practice. Users can SSH in (if given a
shell) and inspect their own VMs' qcow2s directly.

## Host Prerequisites (Ubuntu 24.04)

- `libvirt-qemu:kvm` process user (standard on Ubuntu libvirt package)
- `dynamic_ownership = 1` in `/etc/libvirt/qemu.conf` (default — do NOT
  flip it off)
- AppArmor `virt-aa-helper` generates per-VM profiles from domain XML —
  disks under `/home/*/.staxv/disk_images/` are permitted automatically
  as long as the path appears in the VM's XML. No hand-written policy.
- `/home/<user>` mode: Ubuntu default `0755` already allows
  `libvirt-qemu` to traverse. User provisioning does NOT chmod home.
  If a site locks homes to `0700`, the user provisioner instead sets
  `setfacl -m u:libvirt-qemu:x /home/<user>` (one-time).

### For SELinux hosts (not current fleet, but document)
```
semanage fcontext -a -t virt_image_t "/home(/.*)?/.staxv/disk_images(/.*)?"
restorecon -Rv /home
```
Run once per host at install time. Not needed on Ubuntu.

### NFS-mounted homes — caveat
qcow2 over NFS has file-locking issues (`virtlockd` required, and even
then fragile). If a site mounts `/home` from NFS, user provisioning
should detect it (`stat -f -c %T <home>`) and **refuse** to create the
per-user pool in the home — fall back to a site-local path the admin
configures. Document clearly; fail loud rather than silently break VMs.

## libvirt Networks

- **Host bridges** (e.g. `br0`): shared, admin-managed, all users can
  attach VMs. Listed as "shared networks" in UI.
- **User virtual networks**: libvirt NAT networks named `u<id>-<name>`,
  owned by creator, only visible/attachable by owner.

## Docker

**Admin-only for v1.** Single host daemon means per-user scoping requires
label filtering on every command (`--filter label=staxv.owner=<id>`) and
is easy to bypass via mounted socket. Regular users don't see Docker in
the UI. (Flag to revisit in v1.1 with rootless Docker per user.)

## OpenShift Clusters

- Cluster record: `clusters(id, owner_id, name, type, state, ...)`
- Artifacts: `<home_path>/.staxv/clusters/<cluster_name>/`
- Nodes (VMs) tagged with `owner_id` + `cluster_id` in DB.
- Pull secrets: per-user in settings store, scoped by `owner_id`.

## Settings / Secrets Store

`settings(id, owner_id, key, value_encrypted)`:
- `owner_id = NULL` for system-wide settings (admin only)
- `owner_id = <n>` for user-scoped (pull secret, SSH keys, tokens)

## Bootstrap & User Management

### `staxv-hypervisor useradd <name>` flow
Runs as root (the service runs as root for libvirt + user-provisioning).
Steps, each idempotent:

1. **Unix account**
   - `os/user.Lookup(name)` — if exists, verify UID matches `--uid`
     when passed (fail on mismatch). Mark `adopted=true`, skip to step 2.
   - Else: `useradd -m -s /usr/sbin/nologin [--uid <n>] <name>`.
     If `--uid` is passed (typically by cluster-manager for cross-host
     coordination), use that exact UID; fail if taken. Otherwise
     `useradd -K UID_MIN=20000` picks the next free UID in staxv's range.
   - No interactive shell by default; admin opts in per-user via
     `ssh_enabled`.
   - Config flag `[users] create_unix_users = true` (default). If false
     and the account is missing, fail with a clear error (admin must
     pre-create).
2. **Home traversal for libvirt-qemu**
   - Check `/home/<user>` mode. If `0755` (default), leave alone.
   - If `0700`, apply `setfacl -m u:libvirt-qemu:x /home/<user>` (ACL, not
     chmod — don't widen perms for other users).
3. **Per-user directories** (owned by the Unix user, mode 0750):
   - `~/.staxv/`
   - `~/.staxv/disk_images/`
   - `~/.staxv/isos/`
   - `~/.staxv/clusters/`
4. **NFS check** — if `~/.staxv/disk_images` is on NFS, abort with a
   clear error. Admin must set `[users] pool_override_path = ...` to a
   local path (per-user under that override).
5. **libvirt storage pool** — define + build + start pool `user-<name>`
   pointing at `~/.staxv/disk_images`. Mark `autostart=true`.
6. **staxv DB row** — insert into `users` with bcrypt password,
   `unix_username = <name>`, `home_path = <resolved>`, `staxv_dir =
   <home_path>/.staxv`, `is_admin` flag, quotas.

### Admin API
- `POST /api/admin/users` — runs the same flow as CLI.
- `PATCH /api/admin/users/:id` — update quota, enable/disable.
- `DELETE /api/admin/users/:id` — **soft delete only**: set `disabled_at`,
  stop the user's pool, keep the Unix account and files. Admin does hard
  cleanup manually if they want (deliberately high-friction — data loss).

### First boot
No users in DB → login page shows "no users — run `staxv-hypervisor
useradd --admin <name>` on the host." No web-based bootstrap.

Self-signup: **off**. `[auth] self_signup = false`.

## What Admins Can Do

- See all users' VMs, clusters, files (read-only "view as" in UI).
- Host terminal, Docker, shared network/pool management.
- Create/disable users, set quotas.
- Cannot see user passwords (bcrypt); can reset.
- Admin actions logged to `audit_log` table.

## Threat Model / Non-Goals

**Assumed trust**: Host OS is trusted. Anyone with SSH to the hypervisor
host bypasses the app — that's a host-security problem, not app-security.
Since per-user artifacts now live in `/home/<user>`, staxv users who are
*also* given SSH access can read/modify their own files directly — that's
expected and fine; they own that data. What matters is that **one staxv
user never sees another's** via the app. Standard Linux `0750` + group
ownership does the cross-user part; the app layer handles the API scope.

**In scope**: prevent one staxv user from seeing/touching another
staxv user's resources via the API, file manager, or console.

**Out of scope (v1)**: preventing an admin from reading user files
(admin = host root anyway); per-VM network isolation beyond libvirt's
native network segregation; kernel-level sandbox for host terminal.

**Fleet-level concerns** (centralized user management across multiple
hypervisors, federation, single sign-on across the fleet) belong to
staxv-cluster-manager, not here. See `cluster_manager.md` open
question 5. Within a single hypervisor, multi-tenancy is fully
self-contained.

## Resolved Decisions (locked 2026-04-17)

1. **Admin model**: single `is_admin` boolean flag. No RBAC/roles in v1.
   Revisit only if a real second-admin use case appears.
2. **Docker**: admin-only. Not exposed in non-admin UI. Deferred per-user
   with labels to v1.1+ (needs rootless Docker to be safe).
3. **User creation**: CLI-only bootstrap (`staxv-hypervisor useradd`) +
   admin API (`POST /api/admin/users`). `[auth] self_signup = false`,
   no email-invite flow.
4. **Quotas**: hard-fail on create. Homelab has finite RAM/disk; a warn
   path invites oversubscription bugs. Quota check returns 409 with the
   limiting resource named in the error.
5. **Shared ISO library**: admin-only writes to `/var/lib/staxv/shared/`.
   Users upload to their own `isos/`. All users get read access to shared
   via a read-only bind-mount or by accepting shared paths in VM create
   only when the ISO's `owner_id IS NULL`.
6. **User identity model**: Linux users (real Unix accounts), not
   app-only SQLite rows. Per-user state under `$HOME/.staxv/`.
   UID_MIN=20000 for staxv-created accounts; reserved-name blocklist;
   `/usr/sbin/nologin` default shell; all privileged host ops routed
   through a single `internal/provision/` package with argument
   allowlisting and audit logging. Soft-delete by default; hard
   `userdel --purge` is CLI-only and prompt-guarded.

## Related issues

- **Epic**: [#33 Multi-tenancy](https://github.com/zeshaq/staxv-hypervisor/issues/33) — tracking issue, milestone v0.1
- **Depends on**: #1 scaffold, #2 auth
- **Modifies**: #3 settings, #4 VM list, #5 VM create, #7 VM delete, #12 networks, #13 storage, #14 ISOs, #15 #16 Docker, #17 #18 OpenShift, #21 file manager
