# Memory Index

- [Project context](project_context.md) — what staxv-hypervisor is, origin from vm-manager, tech decisions
- [Server inventory](servers.md) — all servers, SSH credentials, roles (staging/production). **Gitignored** (contains sudo passwords); lives local to each dev machine. If missing after a fresh clone, ask the owner for the current copy or recreate from the template convention.
- [Architecture decisions](architecture.md) — Go package layout, key design choices
- [Multi-tenancy design](multi_tenancy.md) — per-user ownership, file manager scoping, quotas, admin model
- [Cluster manager](cluster_manager.md) — sibling product (vCenter analog), gRPC+mTLS, enrollment, API submodule decision
- [vm-manager reference](vm_manager_ref.md) — where to find the Python source being ported

## GitHub pointers

### Repos in this project
- **staxv-hypervisor** (this repo) — https://github.com/zeshaq/staxv-hypervisor
- **staxv-cluster-manager** (sibling, see [cluster_manager.md](cluster_manager.md)) — https://github.com/zeshaq/staxv-cluster-manager. Local clone at `../staxv-cluster-manager/`. Own `.claude/memory/` but design doc canonical HERE until cluster-manager coding starts.

### Shared project board
- **Board**: https://github.com/users/zeshaq/projects/3 — one project, both repos linked. Views filter per-repo or show cross-cutting work.

### Milestones (per-repo, not shared)
- **staxv-hypervisor**: v0.1 Foundation → v0.2 VM Core → v0.3 Infrastructure → v0.4 OpenShift → v1.0 Production Ready → `Future`
- **staxv-cluster-manager**: v0.1 MVP → `Future` (more added as roadmap firms up)

### Labels
- **Status labels** (both repos): `status:idea` → `status:planned` → `status:ready` → on the board
- **Meta** (both repos): `epic`, `bug`
- **Hypervisor-specific type labels**: `foundation`, `vm`, `openshift`, `networking`, `docker`, `frontend`, `security`, `infra`, `cluster-manager`
- **Cluster-manager-specific type labels**: `fleet`, `scheduler`, `migration`, `redfish`, `sre`, `users`, `hypervisor-api`, `security`, `infra`
- The `cluster-manager` label on a **hypervisor** issue means "work in this repo that's driven by or for cluster-manager consumption" (e.g. gRPC API surface design). The `hypervisor-api` label on a **cluster-manager** issue means "work in this repo that depends on the hypervisor's API contract."

### Active epics
- [#33 Multi-tenancy](https://github.com/zeshaq/staxv-hypervisor/issues/33) — per-user ownership, file scoping, quotas, Linux-user identity model. Design: [multi_tenancy.md](multi_tenancy.md). Milestone: v0.1.

### Idea flow (the discipline)
1. Rough thought → `gh issue create` with **Idea** template (labels `status:idea`, no milestone or `Future`)
2. Worth committing → add milestone, swap label to `status:planned`, fill in design
3. Shovel-ready → label `status:ready`, add AC
4. Active → on the project board
5. Cross-cutting design → memory file, link back from issue body; add `## Related issues` to memory file
6. Decision changed in memory → comment on every related issue in the same session. Drift = tech debt.
