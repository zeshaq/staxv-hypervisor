# staxv-cluster-manager

vCenter analog for managing a fleet of staxv-hypervisor nodes. Separate
product, separate repo, separate release cadence.

## Status
Repo does not exist yet. Planned for after staxv-hypervisor reaches a
minimum (probably ~v0.3 when VM basics + multi-tenancy land). This
memory file is seeded now so design decisions stick.

## Scope (planned features)
- **Site Reliability Manager** — fleet health, alerts, SLIs, maintenance
  modes
- **Centralized user management** — authoritative user + UID registry
  across the fleet. Users created once in cluster-manager;
  cluster-manager provisions Linux accounts on target hypervisors via
  the hypervisor's `useradd` gRPC RPC. Same UID everywhere. Unified
  fleet-wide view in cluster-manager's web UI. Hypervisors never talk
  to each other about users — cluster-manager is the only authority.
  See `multi_tenancy.md` § Fleet-Wide vs Per-Hypervisor Identity.
- **Redfish management** — power, hardware inventory, firmware, sensor
  data for underlying physical servers via their BMCs (iDRAC / iLO)
- **Hypervisor clustering** — group hypervisors that share storage/
  network so VMs can move between them
- **Live migration orchestration** — memory-copy, memory+disk, evacuate
  node for maintenance
- **Scheduler** — pick the right hypervisor for a new VM based on
  resources, tenant affinity, policy

## Why separate repo (LOCKED 2026-04-17)
- **Different product shape**: per-node agent binary vs central HA
  control plane. Different install scripts, configs, uptime guarantees,
  trust boundaries.
- **Release independence is a hard requirement**: must upgrade
  cluster-manager without touching every hypervisor (vCenter 8 /
  ESXi 7 model).
- **Clean API boundary**: separate repos make "only the public API"
  a physical constraint — no reaching into `internal/` packages.
- **Prior art**: oVirt engine (manager) + vdsm (node agent) live in
  separate repos. CloudStack's monorepo is often regretted. Go with
  oVirt's shape.

## Repo layout (when created)
```
github.com/zeshaq/staxv-cluster-manager
├── main.go
├── internal/
│   ├── fleet/        — node registry, enrollment, health
│   ├── scheduler/    — VM placement
│   ├── migration/    — live migration orchestration
│   ├── redfish/      — BMC client, hardware inventory
│   ├── users/        — fleet-level user federation
│   ├── sre/          — site reliability manager
│   ├── grpcclient/   — typed client pool to hypervisors
│   ├── handlers/     — HTTP handlers for cluster-manager's own web UI
│   └── auth/         — session for cluster-manager's UI
├── frontend/         — React web UI (separate from hypervisor's)
└── .claude/memory/   — its own memory tree
```

## Connection Architecture — Three Channels

Cluster-manager is not a single-protocol client. Three channels with
distinct responsibilities:

### 1. gRPC + mTLS (cluster-manager → hypervisor) — primary control
Every operation on a VM, user, or cluster goes here:
- **Unary RPCs** for commands (create VM, drain node)
- **Server streams** for events (VM state changes, health heartbeats,
  migration progress)

**Why gRPC over REST**: unified unary + streaming in one contract,
strongly typed via proto, efficient binary wire. Hypervisor's existing
HTTP REST API stays — browsers use it for per-node web UI. gRPC is the
machine-to-machine channel only.

**Why mTLS**: no shared secrets in config files. Certs issued per-node
on enrollment, rotatable, revocable individually. Same pattern as
Kubernetes kube-apiserver ↔ kubelet and HashiCorp Nomad.

Hypervisor listens on `:5443`. Firewall allows only cluster-manager IPs.

### 2. Redfish HTTPS (cluster-manager → BMC directly)
Physical-server management: power, hardware inventory, firmware,
sensors, system logs. BMCs (iDRAC, HPE iLO) live on the management
network with their own HTTPS endpoint. Cluster-manager talks to them
**directly**, not through the hypervisor — same as vCenter does via
CIM/Redfish to iLO/iDRAC, not through ESXi.

Cluster-manager needs network reachability to two planes:
- Hypervisor data network (gRPC :5443)
- BMC management network (Redfish :443)

In homelabs these are often the same VLAN.

### 3. QEMU Migration Protocol (hypervisor → hypervisor, direct)
Live migration data plane. Memory pages stream hypervisor-to-hypervisor
over QEMU's own migration protocol (ports 49152-49215 default, or a
pinned port). Cluster-manager orchestrates ("source: start; destination:
prepare receiver") via gRPC but is **not in the data path**.

Implication: every hypervisor must have network reachability to every
other hypervisor it might migrate with, on the migration port range.

## Enrollment Flow (cert exchange, one-time trust)

```
1. Admin on cluster-manager:
   staxv-cluster-manager enroll-token --valid 10m
   → prints: ey7Kq3... (one-time bearer token, 10-min TTL)

2. Admin on hypervisor:
   staxv-hypervisor enroll --manager https://mgr:5443 --token ey7Kq3...
   → hypervisor generates keypair + CSR
   → POSTs CSR + token to manager's /enroll endpoint
   → manager validates token, issues signed cert + CA bundle, returns
   → hypervisor writes to /etc/staxv/tls/{cert.pem,key.pem,ca.pem}
   → hypervisor starts gRPC server bound to those certs
   → cluster-manager registers node, state=Enrolled

3. Ongoing:
   cluster-manager → gRPC (mTLS) → hypervisor :5443
   Certs auto-rotate ~30 days before expiry via a rotation RPC.
```

No shared secret ends up persisted in any config. Revocation: remove
node from fleet table; gRPC TLS handshake fails on next connect.

## API Contract — Where It Lives (LOCKED 2026-04-17)

**Not a third repo.** The API contract lives in
`staxv-hypervisor/api/` as a **separate Go module** (multi-module repo
pattern, same as HashiCorp Nomad).

```
staxv-hypervisor/
├── go.mod                     module: github.com/zeshaq/staxv-hypervisor
├── main.go, internal/...
└── api/
    ├── go.mod                 module: github.com/zeshaq/staxv-hypervisor/api
    ├── proto/*.proto          wire contract
    └── gen/                   generated Go stubs (checked in)
```

- Hypervisor imports its own `./api/gen` via a local `replace` directive.
- Cluster-manager imports `github.com/zeshaq/staxv-hypervisor/api v0.x.y`
  via `go.mod` — pulls **only** the `api/` subtree, not hypervisor's
  internal code.
- API versioned independently: tags like `api/v0.3.0` alongside
  hypervisor's `v0.5.0`. Git + Go's module resolver handle both.

### Rejected: third `staxv-api` repo
Over-engineering at current scale (1 server, 1 consumer). Triples PR
ceremony (3 repos per change) without benefit until there are 3+
consumers. Prior art: Kubernetes extracted `k8s.io/api` only after
100+ consumers existed and regretted not using submodules earlier.
HashiCorp Nomad still uses `api/` submodule pattern after 10 years
in production.

### Trigger to extract to a third repo
When a **third consumer** appears — Terraform provider, standalone CLI,
Prometheus exporter — and sync overhead starts hurting. Extraction is
mechanical once real consumers exist. Do NOT preempt.

## Impact on Hypervisor Repo Structure

The existing `internal/api/` package (HTTP handlers) conflicts
optically with the new top-level `api/` module (wire contract).
**Before either the gRPC server or the first external consumer lands,
rename `internal/api/` → `internal/handlers/`.** See architecture.md
for the updated package layout.

## Resolved Decisions

1. **User identity is authoritative in cluster-manager** (2026-04-17).
   Cluster-manager owns the UID registry and orchestrates Linux-account
   creation on hypervisors via the `useradd` gRPC RPC. Hypervisors are
   dumb about cross-host identity — they only know their own local
   users. Same UID on every host where a user exists, enforced by
   cluster-manager. Direct per-hypervisor login remains available as
   break-glass. Resolves the earlier "centralized vs federated"
   question. See `multi_tenancy.md` § Fleet-Wide vs Per-Hypervisor
   Identity for the hypervisor-side implications.

## Open Questions (need user input before cluster-manager coding starts)

1. **SRM scope** — alerting + dashboards only, or includes automated
   remediation (auto-drain + reschedule on node failure)? Former is
   much simpler; latter needs consensus + fencing design.
2. **Redfish scope for v1** — power on/off + inventory only, or
   firmware update + RAID config too? Firmware mgmt is serious
   complexity.
3. **Live-migration network** — dedicated migration VLAN, or same
   network as VM traffic? Separate is standard for production but
   needs NIC planning.
4. **Storage for live migration** — shared storage required (NFS,
   iSCSI) for memory-only migration, or target "storage + memory"
   migration from day one (slower but no shared-storage requirement)?
5. **User provisioning timing** — when admin creates alice in
   cluster-manager, does it (a) **eagerly** push her Linux account to
   every hypervisor in the fleet at user-creation time, or (b) **lazily**
   provision on hypervisor-N only when her first VM lands there?
   Eager = simpler mental model, wastes account slots on hypervisors
   she'll never use. Lazy = Kubernetes-style just-in-time, cleaner at
   scale. Leaning lazy; defer final decision to cluster-manager design
   phase.

## Related issues
(None yet — repo doesn't exist. Once the hypervisor epic
*"Public gRPC API for cluster-manager consumption"* lands, link it here.)
