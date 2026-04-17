package hostinfo

import (
	"context"
	"runtime"
	"testing"
	"time"
)

// TestCollect runs against the actual host (wherever the test is
// running). It sanity-checks that values are plausible — not exact
// matches, since we can't predict a CI runner's uptime or memory.
//
// Skips on non-Linux so developers on macOS can still run `go test
// ./...` locally without failing on fields that gopsutil stubs out
// (gopsutil works on macOS too, but some fields are less reliable).
func TestCollect(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skipf("hostinfo Collect is only exercised on Linux (got %s)", runtime.GOOS)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	snap, err := Collect(ctx)
	if err != nil {
		t.Fatalf("Collect: %v", err)
	}
	if snap == nil {
		t.Fatal("Collect returned nil snapshot")
	}

	// Uptime is always > 0 on a running system.
	if snap.UptimeSecs == 0 {
		t.Error("UptimeSecs should be > 0")
	}
	if snap.UptimeStr == "" {
		t.Error("UptimeStr should be set")
	}

	// CPU % is 0..100 per core, but we return system-wide which is
	// 0..100. Be lenient for burst spikes.
	if snap.CPUPercent < 0 || snap.CPUPercent > 100 {
		t.Errorf("CPUPercent %.2f outside [0,100]", snap.CPUPercent)
	}

	// Memory totals are always > 0 on a real host.
	if snap.Mem.TotalGB <= 0 {
		t.Errorf("Mem.TotalGB should be > 0, got %.2f", snap.Mem.TotalGB)
	}
	if snap.Mem.Percent < 0 || snap.Mem.Percent > 100 {
		t.Errorf("Mem.Percent %.2f outside [0,100]", snap.Mem.Percent)
	}

	// Disk — root fs should exist and be > 0.
	if snap.Disk.TotalGB <= 0 {
		t.Errorf("Disk.TotalGB should be > 0, got %.2f", snap.Disk.TotalGB)
	}

	// At least one process should be returned.
	if len(snap.Processes) == 0 {
		t.Error("Processes should be non-empty")
	}
	for _, p := range snap.Processes {
		if p.PID <= 0 {
			t.Errorf("Process PID %d invalid", p.PID)
		}
	}
}

func TestFormatUptime(t *testing.T) {
	cases := []struct {
		in   uint64
		want string
	}{
		{0, "0 seconds"},
		{45, "45 seconds"},
		{90, "1 minutes"},
		{3600, "1 hours, 0 minutes"},
		{3700, "1 hours, 1 minutes"},
		{86400, "1 days, 0 hours"},
		{86400 * 3, "3 days, 0 hours"},
		{86400*3 + 3600*4, "3 days, 4 hours"},
	}
	for _, c := range cases {
		if got := formatUptime(c.in); got != c.want {
			t.Errorf("formatUptime(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestRounders(t *testing.T) {
	if round1(12.345) != 12.3 {
		t.Errorf("round1(12.345) = %v, want 12.3", round1(12.345))
	}
	if round2(12.345) != 12.35 {
		t.Errorf("round2(12.345) = %v, want 12.35", round2(12.345))
	}
}

func TestBytesToGB(t *testing.T) {
	const gib = 1024 * 1024 * 1024
	if got := bytesToGB(gib); got != 1.0 {
		t.Errorf("bytesToGB(1 GiB) = %v, want 1.0", got)
	}
}
