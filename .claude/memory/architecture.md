# Architecture Decisions

## Package Layout
```
staxv-hypervisor/
├── go.mod                  — module: github.com/zeshaq/staxv-hypervisor
├── main.go
├── api/                    — PUBLISHED API CONTRACT (separate Go module)
│   ├── go.mod              — module: .../staxv-hypervisor/api
│   ├── proto/*.proto       — wire contract (gRPC + shared types)
│   └── gen/                — generated Go stubs, checked in
├── internal/
│   ├── handlers/     — HTTP + gRPC handlers (implement api/)
│   ├── provision/    — privileged host ops (useradd, setfacl, chsh) — allowlisted exec, audited
│   ├── vm/           — VM CRUD, power, disks, snapshots
│   ├── libvirt/      — shared libvirt client wrapper
│   ├── ocp_agent/    — Agent installer pipeline
│   ├── openshift/    — Assisted installer
│   ├── jobs/         — generic long-running job engine
│   ├── settings/     — secrets store
│   ├── files/        — file manager; home `ResolveForUser` path validator lives here
│   ├── docker/
│   ├── network/
│   └── auth/
├── frontend/         — React app (unchanged from vm-manager)
└── static/           — built frontend (embedded in binary)
```

**Naming note:** top-level `api/` is the wire contract (externally
consumable module). It replaces the name `internal/api/` from early
drafts — those handlers now live in `internal/handlers/` to keep the
"api" name reserved for the published contract. Cluster-manager imports
`github.com/zeshaq/staxv-hypervisor/api` via go.mod, pulling only the
`api/` subtree. See cluster_manager.md for the full rationale
("Rejected: third staxv-api repo").

## Key Patterns

### Job lifecycle (replaces Python threading model)
- Each long-running job gets a context.Context with cancel func
- Cancel stored on job struct: job.cancel = cancel
- Cancellation: job.cancel() — replaces _stop_jobs set
- Goroutine: go installer.runDeploy(ctx, jobID, cfg)

### libvirt domain delete (critical — learned from vm-manager bugs)
- ALWAYS use UndefineFlags(DomainUndefineFlagNvram) not plain Undefine()
- EFI VMs have NVRAM files, plain Undefine() fails silently
- Fallback: if UndefineFlags fails, try plain Undefine()

### NMState / OpenShift agent ISO (critical — learned from vm-manager bugs)
- nmstate 2.x requires interfaces to exist on build host
- Pre-validate with nmstatectl gc before including networkConfig
- If validation fails → skip networkConfig → nodes use DHCP
- Do NOT include mac-address in NMState interfaces block
- MAC binding handled separately by agent-config interfaces list

### Signal isolation for subprocesses
- All subprocess.Popen equivalents use SysProcAttr{Setsid: true}
- Equivalent of Python's start_new_session=True
- Kill via os.Kill(pgid, syscall.SIGKILL) not just cmd.Process.Kill()

## Multi-Tenancy (first-class constraint)
See multi_tenancy.md. Every owned resource has `owner_id`; every list/get
handler filters by `ctx.User().ID` unless admin; file manager paths are
validated through `internal/files/path.go::ResolveForUser` (no handler
constructs paths manually). libvirt domains carry `<staxv:owner>` metadata
as DR backup, SQLite `vms(uuid, owner_id)` is source of truth.

**Per-user state lives in the Linux user's `$HOME/.staxv/`** (e.g.
`/home/alice/.staxv/disk_images/`), NOT under `/var/lib/staxv/users/`.
Each user has a libvirt storage pool `user-<username>` pointing there.
Ubuntu's `libvirt-qemu:kvm` + `dynamic_ownership=1` + AppArmor
`virt-aa-helper` handle permissions automatically. User provisioning
(`staxv-hypervisor useradd`) creates the Unix account via `useradd -m
-s /usr/sbin/nologin` if missing, sets up `~/.staxv/{disk_images,isos,
clusters}` at 0750, ACL-grants `libvirt-qemu` traversal if home is
0700, and defines+starts the libvirt pool. Runs as root.

## API Endpoints (must match vm-manager exactly — frontend unchanged)
- /api/vms/*
- /api/openshift/*
- /api/ocp-agent/*
- /api/settings/*
- /api/docker/*
- /api/networks/*
- /api/storage/*
- /api/images/*
- /api/metrics/*
- /vm-console-ws
- /terminal-ws
- /vm-terminal-ws
