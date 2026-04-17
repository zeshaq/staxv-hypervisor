# Project Context

## What is staxv-hypervisor
A Go rewrite of vm-manager — a hypervisor management platform for KVM/libvirt, 
OpenShift (assisted + agent-based installer), Docker, networking, and storage.
Single binary deployment, no Python/pip/venv dependencies.

## Origin
Rewritten from vm-manager (Python/Flask) at /Users/ze/Documents/vm-manager
Decision made April 2026. vm-manager stays in production during parallel development.

## GitHub
Repo: https://github.com/zeshaq/staxv-hypervisor
Project/Kanban: https://github.com/users/zeshaq/projects/3
24 issues created, all in Backlog, grouped into 7 phases

## Why Go (not Python/Spring)
- Single binary deploy (scp + systemctl restart)
- libvirt bindings via go-libvirt (no C headers needed)
- Goroutines replace daemon threads + stop-sets
- Context-based cancellation replaces _stop_jobs set
- Compiler catches errors Python misses at runtime
- 10x less memory at idle vs Flask+gunicorn

## Tech Stack
- Language: Go 1.22+
- HTTP router: chi
- WebSockets: gorilla/websocket
- libvirt: github.com/digitalocean/go-libvirt
- YAML: gopkg.in/yaml.v3
- Auth: JWT (httpOnly cookie)
- Config: TOML
- Job state: SQLite (modernc.org/sqlite — no cgo)
- Frontend: existing React app (unchanged), served via embed.FS

## Host OS (LOCKED 2026-04-17)
**Ubuntu 24.04 LTS.** No RHEL/Debian/other support in v1. Supported
until April 2029 — past the cutover timeline.

Design assumes:
- `libvirt-qemu:kvm` process user (Ubuntu's libvirt package)
- `dynamic_ownership=1` in `/etc/libvirt/qemu.conf` (Ubuntu default)
- AppArmor via `virt-aa-helper` (auto-generates per-VM policies from
  domain XML — no hand-written policy needed for `/home/*/.staxv/`)
- `useradd -K UID_MIN=20000 -m -s /usr/sbin/nologin` syntax
- `.deb` packaging, `apt` for system deps, systemd for service mgmt

Revisit only on a concrete regression, not speculatively.

### Keep the port additive for future OS support
Three disciplines in v0.1 code to avoid locking in Ubuntu assumptions
too deeply:
1. **Config, not constants**: `[host] qemu_user = "libvirt-qemu"`,
   `qemu_group = "kvm"`. Never hardcode.
2. **OS-agnostic provisioning interface** in `internal/provision/`.
   Ubuntu impl lives in one file; adding RHEL later is `+1 file`
   behind a build tag or runtime detect, not a refactor.
3. **`install.sh` detects OS**: clean error on non-Ubuntu with a
   pointer to the RHEL-support tracking issue. No half-installs on
   untested platforms.

### Related issues
- [#40 RHEL/Rocky/Alma host support](https://github.com/zeshaq/staxv-hypervisor/issues/40) — parked (`status:idea`, `Future` milestone). Debian 12 likely comes ~free with config-driven qemu user.

## Development Workflow
- Develop on laptop
- Auto-deploy to staging (dl385-2) on merge to dev branch
- Manual deploy to production (dl385) on git tag
- vm-manager runs on port 5000, staxv-hypervisor on 5001 during parallel run
- Cut over when feature parity reached (v1.0.0)
