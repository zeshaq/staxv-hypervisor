// The staxv-hypervisor API is a separate Go module so external consumers
// (notably staxv-cluster-manager) can import only the wire contract, not
// the binary's internal code.
//
// Tag independently: `api/v0.1.0`, `api/v0.2.0`, etc.
//
// See ../.claude/memory/cluster_manager.md §"API Contract — Where It Lives"
// for the rationale (no separate staxv-api repo).
module github.com/zeshaq/staxv-hypervisor/api

go 1.22
