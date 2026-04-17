package libvirt

import (
	"encoding/hex"
	"fmt"
	"strings"

	golibvirt "github.com/digitalocean/go-libvirt"
)

// DomainSummary is the lean projection of a libvirt domain that staxv
// exposes over HTTP. Keep this tight — anything bigger goes in
// DomainDetail (lazy detail endpoint, not this one).
type DomainSummary struct {
	UUID      string `json:"uuid"`
	Name      string `json:"name"`
	State     string `json:"state"`       // human-readable: "running", "shut off", ...
	StateCode int    `json:"state_code"`  // libvirt VIR_DOMAIN_STATE enum, for UI icon logic
	VCPUs     uint16 `json:"vcpus"`
	MemoryMB  uint64 `json:"memory_mb"`   // current memory, in MiB (libvirt reports KiB)
}

// stateNames maps libvirt's VIR_DOMAIN_STATE enum values to the
// human-readable strings vm-manager's frontend expects. The space in
// "shut off" is deliberate — that's how virsh(1) prints it.
var stateNames = map[uint8]string{
	0: "no state",
	1: "running",
	2: "blocked",
	3: "paused",
	4: "shutting down",
	5: "shut off",
	6: "crashed",
	7: "suspended",
}

func stateName(code uint8) string {
	if s, ok := stateNames[code]; ok {
		return s
	}
	return fmt.Sprintf("unknown (%d)", code)
}

// uuidToString formats libvirt's [16]byte UUID as canonical
// 8-4-4-4-12 hex (what's stored in our DB's vms.uuid column and
// displayed in the UI).
func uuidToString(u golibvirt.UUID) string {
	hexs := hex.EncodeToString(u[:])
	var b strings.Builder
	b.Grow(36)
	b.WriteString(hexs[0:8])
	b.WriteByte('-')
	b.WriteString(hexs[8:12])
	b.WriteByte('-')
	b.WriteString(hexs[12:16])
	b.WriteByte('-')
	b.WriteString(hexs[16:20])
	b.WriteByte('-')
	b.WriteString(hexs[20:32])
	return b.String()
}

// ListDomains returns a summary of every domain libvirt knows about —
// running, stopped, or paused. Sorted by name (stable for UI rendering).
func (c *Client) ListDomains() ([]DomainSummary, error) {
	lv, err := c.libvirt()
	if err != nil {
		return nil, err
	}
	defer c.Unlock()

	// ConnectListAllDomains with flags=0 returns ALL domains (persistent
	// + transient, active + inactive). Don't filter by state here; the
	// caller/UI decides visibility.
	doms, _, err := lv.ConnectListAllDomains(-1, golibvirt.ConnectListAllDomainsFlags(0))
	if err != nil {
		return nil, fmt.Errorf("libvirt: list domains: %w", err)
	}

	out := make([]DomainSummary, 0, len(doms))
	for _, d := range doms {
		stateRaw, _, err := lv.DomainGetState(d, 0)
		if err != nil {
			// Domain may have vanished between ListAll and GetState —
			// skip rather than aborting the whole list.
			continue
		}
		// DomainGetInfo returns a flat tuple, not a struct:
		// (state, maxMem, memory, nrVirtCPU, cpuTime, err)
		_, _, memoryKiB, nrVCPU, _, err := lv.DomainGetInfo(d)
		if err != nil {
			continue
		}
		out = append(out, DomainSummary{
			UUID:      uuidToString(d.UUID),
			Name:      d.Name,
			State:     stateName(uint8(stateRaw)),
			StateCode: int(stateRaw),
			VCPUs:     nrVCPU,
			MemoryMB:  memoryKiB / 1024, // libvirt reports KiB
		})
	}
	return out, nil
}
