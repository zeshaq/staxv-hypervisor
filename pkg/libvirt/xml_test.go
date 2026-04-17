package libvirt

import (
	"testing"
)

// Representative domain XML — the shapes libvirt actually emits for a
// KVM VM created by staxv. Covers:
//   - <os> with arch/machine + multiple <boot dev> entries
//   - file-backed primary disk (virtio-bus, no <boot order/>)
//   - CDROM slot with a mounted .iso + <readonly/>
//   - NAT interface (<source network="default"/>, virtio model)
//   - VNC graphics with auto-assigned port
const sampleDomainXML = `<domain type='kvm' id='42'>
  <name>test-vm</name>
  <uuid>12345678-1234-1234-1234-1234567890ab</uuid>
  <memory unit='KiB'>2097152</memory>
  <currentMemory unit='KiB'>2097152</currentMemory>
  <vcpu placement='static'>2</vcpu>
  <os>
    <type arch='x86_64' machine='pc-q35-6.2'>hvm</type>
    <boot dev='cdrom'/>
    <boot dev='hd'/>
  </os>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='/var/lib/libvirt/images/test-vm.qcow2'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='/var/lib/staxv/shared/isos/ubuntu-24.04.iso'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
      <boot order='1'/>
    </disk>
    <interface type='network'>
      <mac address='52:54:00:aa:bb:cc'/>
      <source network='default'/>
      <target dev='vnet0'/>
      <model type='virtio'/>
    </interface>
    <interface type='bridge'>
      <mac address='52:54:00:dd:ee:ff'/>
      <source bridge='br0'/>
      <model type='e1000'/>
    </interface>
    <graphics type='vnc' port='-1' autoport='yes' listen='127.0.0.1'/>
  </devices>
</domain>`

func TestParseDomain_Basics(t *testing.T) {
	d, err := parseDomain(sampleDomainXML)
	if err != nil {
		t.Fatalf("parseDomain: %v", err)
	}
	if d.Name != "test-vm" {
		t.Errorf("Name: got %q, want %q", d.Name, "test-vm")
	}
	if d.OS.Type.Arch != "x86_64" {
		t.Errorf("OS.Arch: got %q, want %q", d.OS.Type.Arch, "x86_64")
	}
	if d.OS.Type.Machine != "pc-q35-6.2" {
		t.Errorf("OS.Machine: got %q, want %q", d.OS.Type.Machine, "pc-q35-6.2")
	}
	if d.OS.Type.Value != "hvm" {
		t.Errorf("OS.Type.Value: got %q, want %q", d.OS.Type.Value, "hvm")
	}
}

func TestParseDomain_BootOrder(t *testing.T) {
	d, _ := parseDomain(sampleDomainXML)
	order := d.bootOrderList()
	if len(order) != 2 || order[0] != "cdrom" || order[1] != "hd" {
		t.Errorf("bootOrderList: got %v, want [cdrom hd]", order)
	}
	if d.primaryBootDev() != "cdrom" {
		t.Errorf("primaryBootDev: got %q, want cdrom", d.primaryBootDev())
	}
}

func TestParseDomain_Disks(t *testing.T) {
	d, _ := parseDomain(sampleDomainXML)
	if len(d.Devices.Disks) != 2 {
		t.Fatalf("expected 2 disks, got %d", len(d.Devices.Disks))
	}

	// Primary disk: file-backed, virtio, not readonly.
	primary := d.Devices.Disks[0]
	if primary.Device != "disk" || primary.Target.Dev != "vda" || primary.Target.Bus != "virtio" {
		t.Errorf("primary disk: got device=%q target=%q bus=%q", primary.Device, primary.Target.Dev, primary.Target.Bus)
	}
	if primary.Source.File != "/var/lib/libvirt/images/test-vm.qcow2" {
		t.Errorf("primary source: got %q", primary.Source.File)
	}
	if primary.ReadOnly != nil {
		t.Errorf("primary disk unexpectedly marked readonly")
	}
	if primary.Boot != nil {
		t.Errorf("primary disk unexpectedly has <boot> element")
	}

	// CDROM: readonly, boot order = 1.
	cdrom := d.Devices.Disks[1]
	if cdrom.Device != "cdrom" {
		t.Errorf("cdrom device: got %q, want cdrom", cdrom.Device)
	}
	if cdrom.ReadOnly == nil {
		t.Errorf("cdrom missing <readonly/>")
	}
	if cdrom.Boot == nil || cdrom.Boot.Order != 1 {
		t.Errorf("cdrom boot order: got %+v, want order=1", cdrom.Boot)
	}
	if cdrom.Source.File != "/var/lib/staxv/shared/isos/ubuntu-24.04.iso" {
		t.Errorf("cdrom source: got %q", cdrom.Source.File)
	}

	// fileDiskPaths returns only the non-CDROM file-backed disks.
	paths := d.fileDiskPaths()
	if len(paths) != 1 || paths[0] != "/var/lib/libvirt/images/test-vm.qcow2" {
		t.Errorf("fileDiskPaths: got %v, want [/var/lib/libvirt/images/test-vm.qcow2]", paths)
	}
}

func TestParseDomain_Interfaces(t *testing.T) {
	d, _ := parseDomain(sampleDomainXML)
	if len(d.Devices.Interfaces) != 2 {
		t.Fatalf("expected 2 interfaces, got %d", len(d.Devices.Interfaces))
	}

	// NAT via libvirt "default" network.
	nat := d.Devices.Interfaces[0]
	if nat.Type != "network" || nat.Source.Network != "default" {
		t.Errorf("nat iface: type=%q source.network=%q", nat.Type, nat.Source.Network)
	}
	if nat.MAC.Address != "52:54:00:aa:bb:cc" || nat.Model.Type != "virtio" {
		t.Errorf("nat iface: mac=%q model=%q", nat.MAC.Address, nat.Model.Type)
	}
	if nat.Target.Dev != "vnet0" {
		t.Errorf("nat iface target: got %q, want vnet0", nat.Target.Dev)
	}

	// Bridged via br0.
	br := d.Devices.Interfaces[1]
	if br.Type != "bridge" || br.Source.Bridge != "br0" {
		t.Errorf("bridge iface: type=%q source.bridge=%q", br.Type, br.Source.Bridge)
	}
	if br.Model.Type != "e1000" {
		t.Errorf("bridge iface model: got %q, want e1000", br.Model.Type)
	}
}

func TestParseDomain_Graphics(t *testing.T) {
	d, _ := parseDomain(sampleDomainXML)
	if len(d.Devices.Graphics) != 1 {
		t.Fatalf("expected 1 graphics, got %d", len(d.Devices.Graphics))
	}
	g := d.Devices.Graphics[0]
	if g.Type != "vnc" || g.Port != "-1" || g.Listen != "127.0.0.1" {
		t.Errorf("graphics: %+v", g)
	}
	if g.Password != "" {
		t.Errorf("unexpected graphics password: %q", g.Password)
	}
}

// Empty / minimal domain XML shouldn't panic — parseDomain must degrade
// gracefully so the handler can return a valid-but-empty DomainDetail.
func TestParseDomain_Minimal(t *testing.T) {
	const minimal = `<domain type='kvm'><name>x</name><uuid>x</uuid></domain>`
	d, err := parseDomain(minimal)
	if err != nil {
		t.Fatalf("parseDomain minimal: %v", err)
	}
	if len(d.Devices.Disks) != 0 || len(d.Devices.Interfaces) != 0 {
		t.Errorf("minimal domain should have no devices, got disks=%d ifaces=%d",
			len(d.Devices.Disks), len(d.Devices.Interfaces))
	}
	if d.primaryBootDev() != "" {
		t.Errorf("minimal primaryBootDev: got %q, want empty", d.primaryBootDev())
	}
}
