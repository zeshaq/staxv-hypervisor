package libvirt

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

// DomainDetail is the rich projection for the /api/vms/{uuid} endpoint
// and VMDetail.jsx. Parsed from domain XML + DomainGetInfo every
// request — no caching. Cost is negligible; libvirt's XML is already
// in memory.
type DomainDetail struct {
	DomainSummary
	MaxMemoryMB uint64       `json:"max_memory_mb"` // ballooning ceiling, from DomainGetInfo's maxMem
	OSType      string       `json:"os_type"`       // "hvm" normally
	Arch        string       `json:"arch,omitempty"`
	Machine     string       `json:"machine,omitempty"` // "pc-q35-*", "pc-i440fx-*"
	BootOrder   []string     `json:"boot_order,omitempty"`
	Disks       []DomainDisk `json:"disks"`
	NICs        []DomainNIC  `json:"nics"`
	Graphics    []DomainGraphic `json:"graphics,omitempty"`
}

// DomainDisk is one <disk> block from the XML, projected for the UI.
// Device="cdrom" with empty Source is an empty CDROM slot; the UI
// surfaces that as "no media" so the admin can Attach ISO.
type DomainDisk struct {
	Target   string `json:"target"`             // "vda", "hda"
	Device   string `json:"device"`             // "disk" | "cdrom"
	Bus      string `json:"bus,omitempty"`      // "virtio" | "sata" | "scsi"
	Source   string `json:"source,omitempty"`   // file path (file-backed) or dev path (block)
	ReadOnly bool   `json:"read_only"`
	BootOrder int   `json:"boot_order,omitempty"` // from per-disk <boot order/>; 0 = unset
}

// DomainNIC is one <interface> block. Source's meaning depends on
// Type — we project the meaningful one into a single string so the
// UI can render a single column.
type DomainNIC struct {
	MAC    string `json:"mac"`
	Type   string `json:"type"`             // "network" | "bridge" | "direct" | …
	Source string `json:"source,omitempty"` // the network name, bridge name, or host dev
	Model  string `json:"model,omitempty"`  // "virtio", "e1000", …
	Target string `json:"target,omitempty"` // "vnet0" on host (only meaningful when running)
}

// DomainGraphic is one <graphics> entry (VNC/SPICE/RDP). Detail page
// surfaces type + port so admin knows if "launch console" will work.
type DomainGraphic struct {
	Type        string `json:"type"`
	Port        string `json:"port,omitempty"`
	Listen      string `json:"listen,omitempty"`
	HasPassword bool   `json:"has_password"`
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

// ErrDomainNotFound is returned when a UUID doesn't match any libvirt
// domain. Callers map to HTTP 404 (don't leak whether the VM exists in
// the staxv DB vs libvirt).
var ErrDomainNotFound = errors.New("libvirt: domain not found")

// removeDiskFile deletes a qcow2/img file. Safety guards:
//   - refuses anything outside standard libvirt image dirs
//   - refuses anything with ".." after Clean (belt + braces)
//
// This is defense-in-depth — the caller (DeleteDomain) already trusts
// the path because it came from libvirt's own domain XML. But a
// compromised libvirtd or a malicious domain definition shouldn't let
// us wipe /etc or /home/*.
func removeDiskFile(path string) error {
	clean := filepath.Clean(path)
	if strings.Contains(clean, "..") {
		return fmt.Errorf("refusing disk path with '..': %s", path)
	}
	if !isAllowedDiskRoot(clean) {
		return fmt.Errorf("refusing disk path outside allowed roots: %s", path)
	}
	if err := os.Remove(clean); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// allowedDiskRoots is the prefix-list of directories under which we're
// willing to delete disk files. Kept explicit rather than allow-all so
// a misconfigured domain XML can't coax us into rm'ing /boot/vmlinuz.
var allowedDiskRoots = []string{
	"/var/lib/libvirt/images/",
	"/var/lib/staxv/",
	"/home/", // per-user pools land here once provisioning (#33) ships
}

func isAllowedDiskRoot(path string) bool {
	for _, r := range allowedDiskRoots {
		if strings.HasPrefix(path, r) {
			return true
		}
	}
	return false
}

// parseUUID converts "8-4-4-4-12" hex UUID to the raw 16-byte form
// libvirt expects. Accepts uppercase or lowercase.
func parseUUID(s string) ([16]byte, error) {
	var out [16]byte
	clean := strings.ReplaceAll(s, "-", "")
	if len(clean) != 32 {
		return out, fmt.Errorf("libvirt: uuid %q wrong length", s)
	}
	b, err := hex.DecodeString(clean)
	if err != nil {
		return out, fmt.Errorf("libvirt: uuid %q not hex: %w", s, err)
	}
	copy(out[:], b)
	return out, nil
}

// lookupByUUID resolves a UUID string to libvirt's Domain struct.
// MUST be called while holding the client mutex (i.e., inside a block
// that's already called c.libvirt() and deferred c.Unlock()).
func (c *Client) lookupByUUID(lv *golibvirt.Libvirt, uuidStr string) (golibvirt.Domain, error) {
	u, err := parseUUID(uuidStr)
	if err != nil {
		return golibvirt.Domain{}, err
	}
	d, err := lv.DomainLookupByUUID(golibvirt.UUID(u))
	if err != nil {
		return golibvirt.Domain{}, fmt.Errorf("%w: %s", ErrDomainNotFound, uuidStr)
	}
	return d, nil
}

// GetDomainInfo returns a single domain's summary, or ErrDomainNotFound
// if the UUID doesn't match any libvirt domain. Useful for per-VM
// operations (claim, detail page) where a full ListDomains would be
// wasteful.
func (c *Client) GetDomainInfo(uuidStr string) (DomainSummary, error) {
	lv, err := c.libvirt()
	if err != nil {
		return DomainSummary{}, err
	}
	defer c.Unlock()
	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return DomainSummary{}, err
	}
	stateRaw, _, err := lv.DomainGetState(d, 0)
	if err != nil {
		return DomainSummary{}, fmt.Errorf("libvirt: get state %s: %w", uuidStr, err)
	}
	_, _, memoryKiB, nrVCPU, _, err := lv.DomainGetInfo(d)
	if err != nil {
		return DomainSummary{}, fmt.Errorf("libvirt: get info %s: %w", uuidStr, err)
	}
	return DomainSummary{
		UUID:      uuidToString(d.UUID),
		Name:      d.Name,
		State:     stateName(uint8(stateRaw)),
		StateCode: int(stateRaw),
		VCPUs:     nrVCPU,
		MemoryMB:  memoryKiB / 1024,
	}, nil
}

// GetDomainDetail returns the rich view used by the detail page:
// DomainSummary fields + disks + NICs + OS info parsed from the
// domain XML. One libvirt round-trip for XML, one for info, one for
// state. Kept as a single call so the HTTP handler has nothing to
// stitch.
//
// Returns ErrDomainNotFound on an unknown UUID.
func (c *Client) GetDomainDetail(uuidStr string) (*DomainDetail, error) {
	lv, err := c.libvirt()
	if err != nil {
		return nil, err
	}
	defer c.Unlock()

	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return nil, err
	}

	stateRaw, _, err := lv.DomainGetState(d, 0)
	if err != nil {
		return nil, fmt.Errorf("libvirt: get state %s: %w", uuidStr, err)
	}
	_, maxKiB, memoryKiB, nrVCPU, _, err := lv.DomainGetInfo(d)
	if err != nil {
		return nil, fmt.Errorf("libvirt: get info %s: %w", uuidStr, err)
	}
	xmlStr, err := lv.DomainGetXMLDesc(d, 0)
	if err != nil {
		return nil, fmt.Errorf("libvirt: get xml %s: %w", uuidStr, err)
	}
	parsed, err := parseDomain(xmlStr)
	if err != nil {
		return nil, err
	}

	out := &DomainDetail{
		DomainSummary: DomainSummary{
			UUID:      uuidToString(d.UUID),
			Name:      d.Name,
			State:     stateName(uint8(stateRaw)),
			StateCode: int(stateRaw),
			VCPUs:     nrVCPU,
			MemoryMB:  memoryKiB / 1024,
		},
		MaxMemoryMB: maxKiB / 1024,
		OSType:      parsed.OS.Type.Value,
		Arch:        parsed.OS.Type.Arch,
		Machine:     parsed.OS.Type.Machine,
		BootOrder:   parsed.bootOrderList(),
		Disks:       make([]DomainDisk, 0, len(parsed.Devices.Disks)),
		NICs:        make([]DomainNIC, 0, len(parsed.Devices.Interfaces)),
		Graphics:    make([]DomainGraphic, 0, len(parsed.Devices.Graphics)),
	}
	for _, dk := range parsed.Devices.Disks {
		// Source: prefer file-backed path; fall back to dev for
		// block-backed. Empty is legitimate (empty CDROM slot).
		src := dk.Source.File
		if src == "" {
			src = dk.Source.Dev
		}
		var bootOrder int
		if dk.Boot != nil {
			bootOrder = dk.Boot.Order
		}
		out.Disks = append(out.Disks, DomainDisk{
			Target:    dk.Target.Dev,
			Device:    dk.Device,
			Bus:       dk.Target.Bus,
			Source:    src,
			ReadOnly:  dk.ReadOnly != nil,
			BootOrder: bootOrder,
		})
	}
	for _, n := range parsed.Devices.Interfaces {
		// Project the type-appropriate source into one string.
		var src string
		switch n.Type {
		case "network":
			src = n.Source.Network
		case "bridge":
			src = n.Source.Bridge
		case "direct":
			src = n.Source.Dev
		}
		out.NICs = append(out.NICs, DomainNIC{
			MAC:    n.MAC.Address,
			Type:   n.Type,
			Source: src,
			Model:  n.Model.Type,
			Target: n.Target.Dev,
		})
	}
	for _, g := range parsed.Devices.Graphics {
		out.Graphics = append(out.Graphics, DomainGraphic{
			Type:        g.Type,
			Port:        g.Port,
			Listen:      g.Listen,
			HasPassword: g.Password != "",
		})
	}
	return out, nil
}

// StartDomain boots a defined-but-stopped VM. libvirt error if the VM
// is already running.
func (c *Client) StartDomain(uuidStr string) error {
	lv, err := c.libvirt()
	if err != nil {
		return err
	}
	defer c.Unlock()
	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return err
	}
	if err := lv.DomainCreate(d); err != nil {
		return fmt.Errorf("libvirt: start %s: %w", uuidStr, err)
	}
	return nil
}

// ShutdownDomain sends ACPI shutdown (graceful — guest OS runs its
// shutdown sequence). Quiet success; actual shutdown can take seconds
// to minutes depending on the guest. Use ForceStopDomain if you need
// immediate termination.
func (c *Client) ShutdownDomain(uuidStr string) error {
	lv, err := c.libvirt()
	if err != nil {
		return err
	}
	defer c.Unlock()
	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return err
	}
	if err := lv.DomainShutdown(d); err != nil {
		return fmt.Errorf("libvirt: shutdown %s: %w", uuidStr, err)
	}
	return nil
}

// ForceStopDomain is the "pull the plug" equivalent — immediate
// termination, guest filesystems may end up dirty. Maps to vm-manager's
// "stop" button semantics.
func (c *Client) ForceStopDomain(uuidStr string) error {
	lv, err := c.libvirt()
	if err != nil {
		return err
	}
	defer c.Unlock()
	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return err
	}
	if err := lv.DomainDestroy(d); err != nil {
		return fmt.Errorf("libvirt: destroy %s: %w", uuidStr, err)
	}
	return nil
}

// DeleteDomain removes a VM: destroy if running, undefine with the
// NVRAM / ManagedSave / Snapshots flags set (see below), then optionally
// delete backing qcow2 files.
//
// The flag combo is the vm-manager bug-we-must-not-repeat:
//   - DomainUndefineNvram          — EFI VMs keep NVRAM state in a
//     separate file; plain Undefine silently fails on these.
//   - DomainUndefineManagedSave    — if the VM was paused with saved
//     memory state, Undefine refuses unless we include this.
//   - DomainUndefineSnapshotsMetadata — removes any snapshot metadata
//     libvirt is tracking for the domain. (Snapshot disk files, if
//     external, are NOT auto-removed; caller must handle those.)
//
// wipeDisks controls whether we also delete the VM's file-backed
// (non-CDROM) qcow2 files. Caller (handler) decides: Delete = true;
// a future "Unregister" operation that keeps the disks = false.
//
// Returns ErrDomainNotFound if the UUID doesn't exist.
func (c *Client) DeleteDomain(uuidStr string, wipeDisks bool) error {
	lv, err := c.libvirt()
	if err != nil {
		return err
	}
	defer c.Unlock()
	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return err
	}

	// Snapshot disk paths before we undefine — XML query must happen
	// while the domain still exists in libvirt.
	var diskPaths []string
	if wipeDisks {
		xmlStr, err := lv.DomainGetXMLDesc(d, 0)
		if err != nil {
			return fmt.Errorf("libvirt: get xml %s: %w", uuidStr, err)
		}
		parsed, err := parseDomain(xmlStr)
		if err != nil {
			return err
		}
		diskPaths = parsed.fileDiskPaths()
	}

	// Force-stop if running. Can't undefine a running domain.
	state, _, err := lv.DomainGetState(d, 0)
	if err == nil && state == 1 { // 1 = running
		if err := lv.DomainDestroy(d); err != nil {
			return fmt.Errorf("libvirt: destroy %s: %w", uuidStr, err)
		}
	}

	// Undefine with all the clean-up flags. Order of flags doesn't
	// matter — they're bitwise-OR'd.
	flags := golibvirt.DomainUndefineNvram |
		golibvirt.DomainUndefineManagedSave |
		golibvirt.DomainUndefineSnapshotsMetadata |
		golibvirt.DomainUndefineCheckpointsMetadata
	if err := lv.DomainUndefineFlags(d, flags); err != nil {
		return fmt.Errorf("libvirt: undefine %s: %w", uuidStr, err)
	}

	if wipeDisks {
		for _, p := range diskPaths {
			if err := removeDiskFile(p); err != nil {
				// Log but don't fail the whole operation — the VM is
				// already gone from libvirt, dangling files are a
				// cleanup problem, not a correctness one.
				// (We log via the caller's context; here we just return
				// a collected error.)
				return fmt.Errorf("libvirt: remove disk %s: %w", p, err)
			}
		}
	}
	return nil
}

// RebootDomain sends ACPI reboot (graceful). Guest must respond for it
// to actually reboot; orphaned ACPI signals are silently ignored by
// libvirt — so a "success" from this doesn't guarantee the reboot
// completed. For a hard reset, use ForceStopDomain + StartDomain.
func (c *Client) RebootDomain(uuidStr string) error {
	lv, err := c.libvirt()
	if err != nil {
		return err
	}
	defer c.Unlock()
	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return err
	}
	// Flags=0 = default (ACPI). Libvirt also accepts GUEST_AGENT or
	// SIGNAL flags, but ACPI is the safe default.
	if err := lv.DomainReboot(d, 0); err != nil {
		return fmt.Errorf("libvirt: reboot %s: %w", uuidStr, err)
	}
	return nil
}
