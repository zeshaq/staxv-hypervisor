// Package hostinfo collects a snapshot of host-level metrics for the
// dashboard — uptime, CPU %, load average, memory, root-disk usage,
// cumulative network I/O, and top processes.
//
// Built on gopsutil, which reads /proc directly on Linux (no cgo).
// Each field is collected independently; a failure in one metric
// (e.g. /proc/net/dev unreadable for some reason) logs a warning
// but doesn't fail the whole snapshot — the JSON simply carries zero
// or empty values for that field.
package hostinfo

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

// Snapshot is the dashboard payload. Field names match vm-manager's
// /api/dashboard schema so the existing frontend renders without
// changes.
type Snapshot struct {
	UptimeStr  string     `json:"uptime_str"`
	UptimeSecs uint64     `json:"uptime_secs"`
	CPUPercent float64    `json:"cpu_percent"`
	LoadAvg    [3]float64 `json:"load_avg"`
	Mem        Memory     `json:"mem"`
	Disk       Disk       `json:"disk"`
	Net        Network    `json:"net"`
	Processes  []Process  `json:"processes"`
}

// Memory is free/used/total RAM in GB + percent used.
type Memory struct {
	TotalGB float64 `json:"total_gb"`
	UsedGB  float64 `json:"used_gb"`
	Percent float64 `json:"percent"`
}

// Disk is the root filesystem's usage.
type Disk struct {
	TotalGB float64 `json:"total_gb"`
	UsedGB  float64 `json:"used_gb"`
	Percent float64 `json:"percent"`
}

// Network is cumulative-since-boot I/O across all interfaces.
type Network struct {
	BytesRecv uint64 `json:"bytes_recv"`
	BytesSent uint64 `json:"bytes_sent"`
}

// Process is one row in the "top processes" table.
type Process struct {
	PID           int32   `json:"pid"`
	Name          string  `json:"name"`
	Username      string  `json:"username"`
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryPercent float64 `json:"memory_percent"`
}

// cpuSampleDuration is how long Collect blocks while sampling CPU.
// Shorter = less blocking, noisier number. 500ms is a decent balance.
const cpuSampleDuration = 500 * time.Millisecond

// topProcessCount is how many processes to return (sorted by memory
// percent). The frontend displays 8; we return 10 for a little slack.
const topProcessCount = 10

// Collect assembles a Snapshot. Never returns nil on success. Each
// sub-metric is independent — one failing doesn't abort the others.
// Fatal errors (ctx cancelled, panic) are still returned to the caller.
func Collect(ctx context.Context) (*Snapshot, error) {
	s := &Snapshot{}

	// Uptime — cheap, reliable.
	if up, err := host.UptimeWithContext(ctx); err == nil {
		s.UptimeSecs = up
		s.UptimeStr = formatUptime(up)
	} else {
		slog.Warn("hostinfo: uptime", "err", err)
	}

	// CPU percent — blocks for cpuSampleDuration. This is the main
	// latency cost of Collect (call it ~500ms).
	if ps, err := cpu.PercentWithContext(ctx, cpuSampleDuration, false); err == nil && len(ps) > 0 {
		s.CPUPercent = round1(ps[0])
	} else if err != nil {
		slog.Warn("hostinfo: cpu percent", "err", err)
	}

	// Load average (1/5/15 min).
	if la, err := load.AvgWithContext(ctx); err == nil {
		s.LoadAvg = [3]float64{round2(la.Load1), round2(la.Load5), round2(la.Load15)}
	} else {
		slog.Warn("hostinfo: load avg", "err", err)
	}

	// Memory.
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		s.Mem = Memory{
			TotalGB: round2(bytesToGB(vm.Total)),
			UsedGB:  round2(bytesToGB(vm.Used)),
			Percent: round1(vm.UsedPercent),
		}
	} else {
		slog.Warn("hostinfo: memory", "err", err)
	}

	// Root filesystem.
	if du, err := disk.UsageWithContext(ctx, "/"); err == nil {
		s.Disk = Disk{
			TotalGB: round2(bytesToGB(du.Total)),
			UsedGB:  round2(bytesToGB(du.Used)),
			Percent: round1(du.UsedPercent),
		}
	} else {
		slog.Warn("hostinfo: disk /", "err", err)
	}

	// Network — aggregate across all interfaces (per-interface could be
	// exposed later via /api/network/interfaces if useful).
	if nios, err := net.IOCountersWithContext(ctx, false); err == nil && len(nios) > 0 {
		s.Net = Network{BytesRecv: nios[0].BytesRecv, BytesSent: nios[0].BytesSent}
	} else if err != nil {
		slog.Warn("hostinfo: net", "err", err)
	}

	// Top processes, sorted by memory percent (stable, no CPU sampling
	// needed per-process). Memory % proxies "big processes" adequately
	// for a dashboard glance; real-time CPU ranking would require a
	// second pass of sampling that slows the endpoint ~linearly in
	// process count.
	s.Processes = collectTopProcesses(ctx, topProcessCount)

	return s, nil
}

// collectTopProcesses enumerates running processes and returns the top
// N by memory %. Tolerant to per-process errors (processes exit mid-
// iteration, permission errors for some procs).
func collectTopProcesses(ctx context.Context, n int) []Process {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		slog.Warn("hostinfo: list processes", "err", err)
		return nil
	}
	out := make([]Process, 0, len(procs))
	for _, p := range procs {
		if ctx.Err() != nil {
			break
		}
		memPct, err := p.MemoryPercentWithContext(ctx)
		if err != nil {
			continue // process vanished or unreadable
		}
		name, _ := p.NameWithContext(ctx)
		username, _ := p.UsernameWithContext(ctx)
		cpuPct, _ := p.CPUPercentWithContext(ctx) // cumulative since start, good enough for display

		out = append(out, Process{
			PID:           p.Pid,
			Name:          name,
			Username:      username,
			CPUPercent:    round1(cpuPct),
			MemoryPercent: round1(float64(memPct)),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].MemoryPercent > out[j].MemoryPercent
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// formatUptime turns a seconds count into "3 days, 4 hours" style.
func formatUptime(secs uint64) string {
	d := secs / 86400
	h := (secs % 86400) / 3600
	m := (secs % 3600) / 60
	switch {
	case d > 0:
		return fmt.Sprintf("%d days, %d hours", d, h)
	case h > 0:
		return fmt.Sprintf("%d hours, %d minutes", h, m)
	case m > 0:
		return fmt.Sprintf("%d minutes", m)
	default:
		return fmt.Sprintf("%d seconds", secs)
	}
}

func bytesToGB(b uint64) float64 { return float64(b) / (1024 * 1024 * 1024) }
func round1(f float64) float64   { return math.Round(f*10) / 10 }
func round2(f float64) float64   { return math.Round(f*100) / 100 }
