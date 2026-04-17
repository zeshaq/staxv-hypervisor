package libvirt

import (
	"encoding/xml"
	"fmt"
)

// domainXML is the subset of libvirt domain XML we parse — just enough
// to extract file-backed disk paths. NOT a full schema; we rely on
// libvirt for the rest. For a full typed schema see
// libvirt.org/go/libvirtxml, which we could adopt later if we start
// doing complex XML manipulation.
type domainXML struct {
	XMLName xml.Name `xml:"domain"`
	Name    string   `xml:"name"`
	UUID    string   `xml:"uuid"`
	Devices struct {
		Disks []disk `xml:"disk"`
	} `xml:"devices"`
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
