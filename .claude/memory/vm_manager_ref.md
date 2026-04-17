# vm-manager Reference

## Source Location
/Users/ze/Documents/vm-manager/

## File Map (Python → Go port target)
```
views/api.py              → internal/vm/ (all VM CRUD operations)
views/listing.py          → internal/vm/list.go
views/creation.py         → internal/vm/create.go
views/console.py          → internal/api/websocket.go (VNC proxy)
views/terminal.py         → internal/api/websocket.go (VM serial)
views/host_terminal.py    → internal/api/websocket.go (host shell)
views/network_mgmt.py     → internal/network/
views/images.py           → internal/images/
views/storage.py          → internal/storage/
views/docker_mgmt.py      → internal/docker/
views/docker_exec.py      → internal/docker/exec.go
views/metrics.py          → internal/metrics/
views/dashboard.py        → internal/metrics/dashboard.go
views/system_mgmt.py      → internal/system/
views/files.py            → internal/files/
views/kubernetes.py       → internal/kubernetes/
views/settings.py         → internal/settings/
views/openshift/          → internal/openshift/
views/openshift_agent.py  → internal/ocp_agent/
views/openshift_legacy.py → internal/openshift/ (legacy routes)
```

## Frontend Location
/Users/ze/Documents/vm-manager/frontend/src/
Copy entire frontend/ directory to staxv-hypervisor/frontend/
All API paths must stay identical so frontend needs zero changes.

## Known Bugs Fixed in vm-manager (must not repeat in Go)
1. VM delete: use UndefineFlags(NVRAM) not plain Undefine() — EFI domains
2. NMState: pre-validate with nmstatectl gc, skip if nmstate 2.x fails
3. NMState: no mac-address in networkConfig interfaces block
4. Subprocess isolation: use Setsid=true, kill process group not just leader
5. Session key: 'username' not 'user' in auth checks

## Current vm-manager Production State
- GitHub: github.com/zeshaq/vm-manager
- Latest commit on dl385-2: ~cfd86a2 (NMState pre-validation fix)
- Service: vm-manager.service on port 5000
