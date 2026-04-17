package libvirt

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	golibvirt "github.com/digitalocean/go-libvirt"
	"github.com/google/uuid"
)

// CreateSpec is the minimum-viable set of knobs for a first-pass VM.
// Deliberately narrow: everything the current frontend form surfaces
// plus sensible defaults for the rest. Bigger features (multiple
// disks, multiple NICs, UEFI, cloud-init, PCI passthrough) land as
// follow-up work — extend this struct, don't re-architect.
type CreateSpec struct {
	Name     string // libvirt-unique; we don't sanitize here — caller enforces format
	VCPUs    int    // >= 1
	MemoryMB int    // >= 64; libvirt reports in KiB, we accept MiB
	HostCPU  bool   // true → <cpu mode='host-passthrough'/>, else libvirt default

	// DiskGB: size of the primary disk image. 0 = no primary disk
	// (rare; useful for VMs booting from iSCSI or PXE).
	DiskGB int

	// PoolPath: directory where the qcow2 disk file is created.
	// Empty → DefaultPoolPath.
	PoolPath string

	// OwnerID is embedded in libvirt metadata under <staxv:owner> for
	// disaster-recovery of ownership if our DB is ever lost. Not
	// trusted over SQLite — see memory/multi_tenancy.md §Ownership.
	OwnerID int64
}

// DefaultPoolPath is where disk files land unless the spec overrides.
// Matches libvirt's default dir pool on Ubuntu.
const DefaultPoolPath = "/var/lib/libvirt/images"

// CreatedDomain is what CreateDomain returns — enough for the handler
// to insert an ownership row and echo back to the caller.
type CreatedDomain struct {
	UUID     string
	Name     string
	DiskPath string // primary qcow2 path, "" if DiskGB=0
}

// CreateDomain provisions a new VM:
//
//  1. Validate the spec.
//  2. If DiskGB > 0, `qemu-img create` the qcow2 file.
//  3. Render the domain XML from the template.
//  4. DomainDefineXML (persistent, defined-but-stopped).
//
// Does NOT auto-start. Caller can StartDomain(uuid) separately so the
// operator has a chance to review before boot.
//
// If the qcow2 was created but DomainDefineXML fails, the qcow2 is
// removed to avoid orphans. Best-effort: if the cleanup itself fails
// we log and return the original libvirt error — operator can rm -f.
func (c *Client) CreateDomain(ctx context.Context, spec CreateSpec) (*CreatedDomain, error) {
	if err := validateSpec(&spec); err != nil {
		return nil, err
	}
	if spec.PoolPath == "" {
		spec.PoolPath = DefaultPoolPath
	}

	// New UUID up-front so the disk file name can embed it if we ever
	// want to, and so the handler knows the UUID before libvirt tells us.
	newUUID := uuid.New().String()

	var diskPath string
	if spec.DiskGB > 0 {
		diskPath = filepath.Join(spec.PoolPath, spec.Name+"-osdisk.qcow2")
		if err := qemuImgCreate(ctx, diskPath, spec.DiskGB); err != nil {
			return nil, err
		}
	}

	xmlStr, err := renderDomainXML(domainXMLArgs{
		Name:     spec.Name,
		UUID:     newUUID,
		MemoryMB: spec.MemoryMB,
		VCPUs:    spec.VCPUs,
		HostCPU:  spec.HostCPU,
		DiskPath: diskPath,
		OwnerID:  spec.OwnerID,
	})
	if err != nil {
		// Template rendering shouldn't realistically fail, but if it
		// does, cleanup the disk we just created.
		_ = removeIfSafe(diskPath)
		return nil, err
	}

	lv, err := c.libvirt()
	if err != nil {
		_ = removeIfSafe(diskPath)
		return nil, err
	}
	defer c.Unlock()

	if _, err := lv.DomainDefineXML(xmlStr); err != nil {
		_ = removeIfSafe(diskPath)
		return nil, fmt.Errorf("libvirt: define domain %q: %w", spec.Name, err)
	}

	return &CreatedDomain{UUID: newUUID, Name: spec.Name, DiskPath: diskPath}, nil
}

func validateSpec(s *CreateSpec) error {
	if s.Name == "" {
		return fmt.Errorf("name is required")
	}
	// libvirt permits a lot here; we're stricter to avoid XML injection
	// and filesystem weirdness.
	for _, r := range s.Name {
		ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.'
		if !ok {
			return fmt.Errorf("name %q: only letters, digits, '-', '_', '.' allowed", s.Name)
		}
	}
	if len(s.Name) > 64 {
		return fmt.Errorf("name too long (max 64 chars)")
	}
	if s.VCPUs < 1 || s.VCPUs > 256 {
		return fmt.Errorf("vcpus must be 1..256, got %d", s.VCPUs)
	}
	if s.MemoryMB < 64 || s.MemoryMB > 4*1024*1024 {
		return fmt.Errorf("memory must be 64..%d MiB, got %d", 4*1024*1024, s.MemoryMB)
	}
	if s.DiskGB < 0 || s.DiskGB > 16*1024 {
		return fmt.Errorf("disk_gb must be 0..16384, got %d", s.DiskGB)
	}
	return nil
}

// qemuImgCreate shells out to qemu-img to materialize a sparse qcow2.
// We don't use libvirt's storage pool APIs here because (a) we haven't
// wired up per-user pools yet, (b) qemu-img is the tool the memory-doc
// "bug map" from vm-manager references — staying consistent.
//
// Fails if the file already exists (qemu-img's default behavior).
func qemuImgCreate(ctx context.Context, path string, sizeGB int) error {
	cmd := exec.CommandContext(ctx, "qemu-img", "create", "-f", "qcow2", path, fmt.Sprintf("%dG", sizeGB))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("qemu-img create %s: %w (stderr: %s)", path, err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// removeIfSafe is a best-effort unlink used by CreateDomain's
// rollback path. Deliberately calls our allow-list-aware remover so
// a bad PoolPath doesn't let us unlink something weird.
func removeIfSafe(path string) error {
	if path == "" {
		return nil
	}
	return removeDiskFile(path)
}

// -----------------------------------------------------------------------
// Domain XML template
// -----------------------------------------------------------------------

type domainXMLArgs struct {
	Name     string
	UUID     string
	MemoryMB int
	VCPUs    int
	HostCPU  bool
	DiskPath string // "" means no primary disk (rare)
	OwnerID  int64
}

// domainXMLTemplate is the minimum sensible libvirt domain. Choices
// locked here with rationale:
//
//   - machine 'pc-q35-6.2': modern chipset; PCIe root port natively.
//     Ubuntu 24.04's qemu ships q35-6.2 and newer. Works on BIOS boot.
//   - firmware: SeaBIOS (implicit — no <loader>/<nvram>). UEFI would
//     need additional NVRAM plumbing; skip for v1.
//   - disk bus virtio, device type='file' qcow2 — fast path on KVM.
//   - CDROM on SATA, deliberately empty — caller attaches ISO later
//     via a future `edit` flow.
//   - NIC on the libvirt 'default' NAT network (10.0.122.0/24). Fine
//     for homelab first-boot; bridged networks come with #12.
//   - VNC bound to 127.0.0.1 auto-port. The WebSocket proxy (#10)
//     will surface this to browsers without exposing the raw TCP.
//   - Channels: libvirt's qemu-guest-agent socket so later features
//     (shutdown-via-agent, file-pull) can work if the guest installs
//     qemu-ga.
const domainXMLTemplate = `<domain type='kvm'>
  <name>{{.Name}}</name>
  <uuid>{{.UUID}}</uuid>
  <metadata>
    <staxv:owner xmlns:staxv='https://staxv.io/schema'>{{.OwnerID}}</staxv:owner>
  </metadata>
  <memory unit='MiB'>{{.MemoryMB}}</memory>
  <currentMemory unit='MiB'>{{.MemoryMB}}</currentMemory>
  <vcpu placement='static'>{{.VCPUs}}</vcpu>
  <os>
    <type arch='x86_64' machine='pc-q35-6.2'>hvm</type>
    <boot dev='hd'/>
    <boot dev='cdrom'/>
    <boot dev='network'/>
  </os>
  <features>
    <acpi/>
    <apic/>
  </features>{{if .HostCPU}}
  <cpu mode='host-passthrough' check='none' migratable='on'/>{{end}}
  <clock offset='utc'>
    <timer name='rtc' tickpolicy='catchup'/>
    <timer name='pit' tickpolicy='delay'/>
    <timer name='hpet' present='no'/>
  </clock>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>destroy</on_crash>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>{{if .DiskPath}}
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' discard='unmap'/>
      <source file='{{.DiskPath}}'/>
      <target dev='vda' bus='virtio'/>
    </disk>{{end}}
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <serial type='pty'><target port='0'/></serial>
    <console type='pty'><target type='serial' port='0'/></console>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
    </channel>
    <graphics type='vnc' port='-1' autoport='yes' listen='127.0.0.1'/>
    <video><model type='qxl' ram='65536' vram='65536' vgamem='16384'/></video>
    <memballoon model='virtio'/>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
  </devices>
</domain>
`

var domainTmpl = template.Must(template.New("domain").Parse(domainXMLTemplate))

func renderDomainXML(args domainXMLArgs) (string, error) {
	var buf bytes.Buffer
	if err := domainTmpl.Execute(&buf, args); err != nil {
		return "", fmt.Errorf("libvirt: render domain xml: %w", err)
	}
	return buf.String(), nil
}

// -----------------------------------------------------------------------
// CD-ROM (ISO) media swap
// -----------------------------------------------------------------------

// AttachISO inserts/replaces the contents of the VM's primary CD-ROM
// slot (target dev='sda', bus='sata' — matches what CreateDomain puts
// in the XML template). Equivalent to `virsh change-media --insert`.
//
// Works on both running and stopped VMs; pick flags based on live state
// so the change is both persistent (survives reboot) AND visible to a
// running guest right now.
//
// Assumes the VM was created by staxv or vm-manager (both use sda/sata
// for the empty CD-ROM slot). A VM with a different CD-ROM target
// would need us to parse its XML first — not worth the complexity in
// v1; admin can `virsh change-media` manually for weird layouts.
func (c *Client) AttachISO(uuidStr, isoPath string) error {
	return c.changeMedia(uuidStr, isoPath)
}

// DetachISO ejects the CD-ROM. Equivalent to `virsh change-media
// --eject`. No-op if the slot is already empty.
func (c *Client) DetachISO(uuidStr string) error {
	return c.changeMedia(uuidStr, "")
}

// changeMedia is the shared implementation. isoPath="" → eject.
func (c *Client) changeMedia(uuidStr, isoPath string) error {
	lv, err := c.libvirt()
	if err != nil {
		return err
	}
	defer c.Unlock()
	d, err := c.lookupByUUID(lv, uuidStr)
	if err != nil {
		return err
	}

	// Choose flags: Config always (persist across reboot). Also Live
	// if VM is running so the guest sees the change immediately.
	state, _, err := lv.DomainGetState(d, 0)
	if err != nil {
		return fmt.Errorf("libvirt: get state %s: %w", uuidStr, err)
	}
	flags := golibvirt.DomainDeviceModifyConfig
	if state == 1 { // running
		flags |= golibvirt.DomainDeviceModifyLive
	}

	xmlStr := renderCDROMXML(isoPath)
	if err := lv.DomainUpdateDeviceFlags(d, xmlStr, flags); err != nil {
		return fmt.Errorf("libvirt: update cdrom %s: %w", uuidStr, err)
	}
	return nil
}

// renderCDROMXML builds a <disk> fragment for the CD-ROM slot. With
// isoPath != "" we include a <source> element (insert); empty path
// means no <source> → ejected/empty media.
//
// Hand-rolled string build because the disk fragment is 5 lines and
// the paths we see have no XML-special chars (they come from our own
// ISO library which enforces an extension allow-list). xml.Marshal
// would be overkill.
func renderCDROMXML(isoPath string) string {
	var src string
	if isoPath != "" {
		src = fmt.Sprintf("    <source file='%s'/>\n", isoPath)
	}
	return "<disk type='file' device='cdrom'>\n" +
		"    <driver name='qemu' type='raw'/>\n" +
		src +
		"    <target dev='sda' bus='sata'/>\n" +
		"    <readonly/>\n" +
		"</disk>"
}
