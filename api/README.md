# staxv-hypervisor/api

Public wire contract for the hypervisor. Separate Go module — external
consumers (staxv-cluster-manager, future Terraform providers, CLIs)
import this path without pulling in the hypervisor's internal code.

```go
import "github.com/zeshaq/staxv-hypervisor/api/gen/..."
```

## Layout (planned)

```
api/
├── go.mod                 — this module
├── proto/                 — .proto definitions (the source of truth)
│   ├── vm.proto
│   ├── node.proto
│   ├── migration.proto
│   └── events.proto
└── gen/                   — generated Go stubs, checked in
    ├── vmpb/
    ├── nodepb/
    └── ...
```

## Versioning

Tagged independently of the main binary: `api/v0.x.y` alongside
hypervisor's own `v0.y.z`. Breaking changes bump major.

## Why a submodule, not a separate repo

Over-engineering at current scale (1 server, 1 consumer). Revisit when
a third consumer exists. See
[`.claude/memory/cluster_manager.md`](../.claude/memory/cluster_manager.md)
§ "API Contract — Where It Lives" for the trade-off.
