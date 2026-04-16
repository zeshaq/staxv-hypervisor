# staxv-hypervisor

A hypervisor management platform built in Go. Manages KVM/libvirt virtual machines, OpenShift clusters (Assisted + Agent-based installer), Docker containers, networking, and storage — all from a single web UI and single deployable binary.

> **Rewritten from [vm-manager](https://github.com/zeshaq/vm-manager)** (Python/Flask) for better performance, simpler deployment, and long-term maintainability.

---

## Features

| Domain | Capabilities |
|--------|-------------|
| **Virtual Machines** | Create, list, start/stop/delete, disks, snapshots, console (VNC), serial terminal |
| **OpenShift** | Assisted Installer (Red Hat cloud API) + Agent-based Installer (air-gapped), cluster dashboard |
| **Docker** | Container list, start/stop/logs, exec shell |
| **Networking** | libvirt networks, host bridges, DHCP leases, firewall rules |
| **Storage** | Storage pool and volume management |
| **System** | Host metrics, file manager, system info, terminal |

---

## Why Go

- **Single binary** — `scp staxv-hypervisor server: && systemctl restart staxv-hypervisor`. No pip, no venv, no Python version conflicts.
- **Goroutines** — lightweight concurrency for long-running jobs (OCP installs, VM creation). Replaces daemon threads + stop-sets with `context.Context` cancellation.
- **go-libvirt** — talks to libvirt daemon directly over Unix socket. No C headers needed on build machine.
- **Compiler safety** — type errors and unhandled errors caught at build time, not at 2am in production.
- **~10MB idle** vs ~80MB for Flask + gunicorn.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Go 1.22+ |
| HTTP Router | [chi](https://github.com/go-chi/chi) |
| WebSockets | [gorilla/websocket](https://github.com/gorilla/websocket) |
| libvirt | [go-libvirt](https://github.com/digitalocean/go-libvirt) |
| YAML | [gopkg.in/yaml.v3](https://pkg.go.dev/gopkg.in/yaml.v3) |
| Auth | JWT (httpOnly cookie) |
| Config | TOML |
| Job state | SQLite via [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite) |
| Frontend | React (unchanged from vm-manager), served via `embed.FS` |

---

## Project Structure

```
staxv-hypervisor/
├── main.go                    # entry point
├── config.example.toml        # configuration reference
├── internal/
│   ├── api/                   # HTTP handlers (thin layer, no business logic)
│   │   ├── server.go
│   │   ├── middleware.go
│   │   ├── vms.go
│   │   ├── openshift.go
│   │   ├── ocp_agent.go
│   │   ├── docker.go
│   │   ├── settings.go
│   │   └── websocket.go
│   ├── vm/                    # VM lifecycle operations
│   ├── libvirt/               # shared libvirt client wrapper
│   ├── ocp_agent/             # Agent-based OCP installer pipeline
│   ├── openshift/             # Assisted installer
│   ├── jobs/                  # generic long-running job engine
│   ├── settings/              # secrets store
│   ├── docker/
│   ├── network/
│   ├── auth/
│   └── metrics/
├── frontend/                  # React app (unchanged API contract)
└── static/                    # built frontend (embedded in binary)
```

---

## Implementation Roadmap

### v0.1.0 — Foundation *(target: May 2026)*
> First deployable binary. Auth works. Settings store works. CI running.

- [ ] #1  Go scaffold: module, folder structure, main.go
- [ ] #2  Auth: JWT login/logout with httpOnly cookie
- [ ] #3  Settings: secrets store (pull secret, SSH key, tokens)
- [ ] #25 Health check and readiness probe endpoints
- [ ] #26 Configuration: TOML config file with env var overrides
- [ ] #27 Structured logging with slog

### v0.2.0 — VM Core *(target: June 2026)*
> Full VM lifecycle. Console and terminal working. Feature parity with vm-manager VM section.

- [ ] #4  VM list and detail (libvirt client wrapper)
- [ ] #5  VM create from ISO and cloud-init
- [ ] #6  VM power operations (start, stop, reboot, force kill)
- [ ] #7  VM delete with disk cleanup and NVRAM flag
- [ ] #8  VM disk management (add, resize, delete)
- [ ] #9  VM snapshots (create, list, revert, delete)
- [ ] #28 VM network interface management
- [ ] #10 Console: VNC over WebSocket proxy
- [ ] #11 Terminal: host shell and VM serial console (xterm.js)
- [ ] #31 Job engine: WebSocket live log streaming

### v0.3.0 — Infrastructure *(target: July 2026)*
> Networking, Docker, storage, metrics. All infrastructure features complete.

- [ ] #12 Networking: libvirt network and bridge management
- [ ] #13 Storage: pool and volume management
- [ ] #14 Images: ISO library management
- [ ] #15 Docker: container list, start, stop, logs
- [ ] #16 Docker: exec into container over WebSocket
- [ ] #20 Metrics: host and VM resource usage dashboard
- [ ] #21 System: file manager, system info
- [ ] #29 Kubernetes: cluster list and resource browser
- [ ] #30 Security: firewall rule management

### v0.4.0 — OpenShift *(target: August 2026)*
> Full OpenShift feature parity. Both installer types working.

- [ ] #17 OpenShift: Assisted Installer — deploy and monitor
- [ ] #18 OpenShift: Agent Installer — ISO build, VMs, bootstrap
- [ ] #19 OpenShift: Cluster Dashboard (nodes, operators, kubeconfig)

### v1.0.0 — Production Ready *(target: September 2026)*
> Feature parity with vm-manager. Cut over from vm-manager on production.

- [ ] #22 Frontend: integrate React app, serve via embed.FS
- [ ] #23 CI/CD: GitHub Actions build, test, release pipeline
- [ ] #24 Deployment: systemd service, server configuration
- [ ] #32 install.sh: one-line server install script
- [ ] Parallel run alongside vm-manager (port 5001)
- [ ] Cut over production from vm-manager → staxv-hypervisor

---

## Development

### Prerequisites
```bash
go 1.22+
node 18+  # for frontend
libvirt + qemu-kvm  # on target servers
```

### Run locally
```bash
git clone git@github.com:zeshaq/staxv-hypervisor.git
cd staxv-hypervisor
go run main.go
```

### Build
```bash
make build          # build binary + frontend
make build-linux    # cross-compile for linux/amd64
```

### Test
```bash
go test ./...
```

---

## Deployment

### Quick install (any Linux server)
```bash
curl -fsSL https://raw.githubusercontent.com/zeshaq/staxv-hypervisor/main/install.sh | bash
```

### Manual
```bash
wget https://github.com/zeshaq/staxv-hypervisor/releases/latest/download/staxv-hypervisor-linux-amd64
chmod +x staxv-hypervisor-linux-amd64
sudo mv staxv-hypervisor-linux-amd64 /usr/local/bin/staxv-hypervisor
sudo mkdir -p /etc/staxv-hypervisor
sudo cp config.example.toml /etc/staxv-hypervisor/config.toml
sudo systemctl enable --now staxv-hypervisor
```

### Environments

| Environment | Server | Branch | Deploy trigger |
|------------|--------|--------|----------------|
| Development | Laptop | `feature/*` | `go run main.go` |
| Staging | dl385-2 (59.153.29.100) | `dev` | Auto on merge to dev |
| Production | dl385 (160.30.63.130) | `main` | Manual on git tag |

---

## Migration from vm-manager

staxv-hypervisor exposes **identical API endpoints** — the existing React frontend works with zero changes.

1. Deploy staxv-hypervisor on port 5001 alongside vm-manager on port 5000
2. Verify all features on port 5001
3. Switch load balancer to port 5001
4. Decommission vm-manager

---

## Links

- [Project Board (Kanban)](https://github.com/users/zeshaq/projects/3)
- [vm-manager (predecessor)](https://github.com/zeshaq/vm-manager)

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
