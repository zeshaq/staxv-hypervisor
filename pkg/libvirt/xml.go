package libvirt

import (
	"encoding/xml"
	"fmt"
)

// domainXML is the subset of libvirt domain XML we parse. NOT a full
// schema; we rely on libvirt for the rest. For a full typed schema see
// libvirt.org/go/libvirtxml, which we could adopt later if we start
// doing complex XML manipulation.
//
// We parse:
//   - <name> / <uuid> — identity (mostly for logging; GetDomainInfo
//     already gives us these)
//   - <os><type arch machine>boot</type></os> — arch + machine + primary
//     boot device, shown on the detail page
//   - <devices><disk>…</disk></devices> — target, bus, path, read-only
//     used both for delete-disk safety and the detail page's disk table
//   - <devices><interface>…</interface></devices> — MAC, model, source
//     network/bridge; detail-page only
type domainXML struct {
	XMLName xml.Name  `xml:"domain"`
	Name    string    `xml:"name"`
	UUID    string    `xml:"uuid"`
	OS      domainOS  `xml:"os"`
	Devices domainDev `xml:"devices"`
}

// domainOS captures <os>'s type element + first <boot> device. Libvirt
// lists <boot dev="…"/> in order; frontend surfaces only the primary so
// admins can quickly see "this VM boots from CD before disk".
type domainOS struct {
	Type struct {
		Arch    string `xml:"arch,attr"`
		Machine string `xml:"machine,attr"`
		Value   string `xml:",chardata"` // "hvm" for normal KVM; kept for completeness
	} `xml:"type"`
	Boot []struct {
		Dev string `xml:"dev,attr"` // "hd" | "cdrom" | "network"
	} `xml:"boot"`
}

type domainDev struct {
	Disks      []disk      `xml:"disk"`
	Interfaces []iface     `xml:"interface"`
	Graphics   []graphic   `xml:"graphics"`
}

type disk struct {
	// Attributes
	Device string `xml:"device,attr"` // "disk" | "cdrom" | "floppy" | ...
	Type   string `xml:"type,attr"`   // "file" | "block" | "network" | ...

	Source struct {
		File string `xml:"file,attr"` // only set when Type="file"
		Dev  string `xml:"dev,attr"`  // only set when Type="block"
	} `xml:"source"`

	Target struct {
		Dev string `xml:"dev,attr"` // "vda", "sda", ...
		Bus string `xml:"bus,attr"`
	} `xml:"target"`

	// <readonly/> is a presence-only tag. If the element exists, the
	// encoding/xml Go decoder populates an empty struct at this pointer
	// — nil means "writable".
	ReadOnly *struct{} `xml:"readonly"`

	// <boot order="N"/> — present only when the admin has declared a
	// boot order (CDROM as boot-first, typically). Zero = unset.
	Boot *struct {
		Order int `xml:"order,attr"`
	} `xml:"boot"`
}

// iface is the subset of <interface> we care about. libvirt supports
// many NIC types (network, bridge, direct, hostdev, udp, …); we surface
// the two common ones (network + bridge) and render whatever else we
// encounter as raw type strings.
type iface struct {
	Type string `xml:"type,attr"` // "network" | "bridge" | "direct" | "hostdev" | …

	MAC struct {
		Address string `xml:"address,attr"`
	} `xml:"mac"`

	Source struct {
		Network string `xml:"network,attr"` // type="network"
		Bridge  string `xml:"bridge,attr"`  // type="bridge"
		Dev     string `xml:"dev,attr"`     // type="direct"
	} `xml:"source"`

	Target struct {
		Dev string `xml:"dev,attr"` // "vnet0" etc. on the host
	} `xml:"target"`

	Model struct {
		Type string `xml:"type,attr"` // "virtio" | "e1000" | "rtl8139"
	} `xml:"model"`
}

// graphic captures <graphics> — VNC / SPICE. The detail page shows
// this so admin can see if console access is available without dialing
// libvirt's graphic-stream RPC directly.
type graphic struct {
	Type     string `xml:"type,attr"` // "vnc" | "spice" | "rdp"
	Port     string `xml:"port,attr"` // "-1" = auto-allocate; concrete port once running
	Listen   string `xml:"listen,attr"`
	Password string `xml:"passwd,attr"` // present iff set
}

// parseDomain unmarshals a domain XML string. Returns an error with
// context if the XML is malformed.
func parseDomain(xmlStr string) (*domainXML, error) {
	d := &domainXML{}
	if err := xml.Unmarshal([]byte(xmlStr), d); err != nil {
		return nil, fmt.Errorf("libvirt: parse domain xml: %w", err)
	}
	return d, nil
}

// fileDiskPaths returns the file paths of every file-backed disk on
// the domain (excludes CD-ROMs, floppies, and non-file disks). Used
// by DeleteDomain to know which qcow2 files to remove.
func (d *domainXML) fileDiskPaths() []string {
	out := []string{}
	for _, dk := range d.Devices.Disks {
		if dk.Device == "disk" && dk.Type == "file" && dk.Source.File != "" {
			out = append(out, dk.Source.File)
		}
	}
	return out
}

// primaryBootDev returns the first <os><boot dev="…"/> entry, or "" if
// none declared (libvirt falls back to boot order on disk elements).
// Shown on the detail page as "Boot order: hd, cdrom" so the admin can
// spot "why won't this VM boot from the ISO I just attached?".
func (d *domainXML) primaryBootDev() string {
	if len(d.OS.Boot) == 0 {
		return ""
	}
	return d.OS.Boot[0].Dev
}

// bootOrderList returns the full <boot dev> order as shown in virsh
// dumpxml — e.g. ["hd", "cdrom", "network"]. Empty when per-disk
// <boot order="…"/> is used instead (that per-device mode overrides
// the global list).
func (d *domainXML) bootOrderList() []string {
	out := make([]string, 0, len(d.OS.Boot))
	for _, b := range d.OS.Boot {
		if b.Dev != "" {
			out = append(out, b.Dev)
		}
	}
	return out
}
