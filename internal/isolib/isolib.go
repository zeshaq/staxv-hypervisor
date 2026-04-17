// Package isolib handles the filesystem side of the ISO library —
// streaming saves from multipart forms, safe removes, basic validation.
// It doesn't touch the DB or HTTP; the handler wires those.
package isolib

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
)

// Errors the handler maps to HTTP statuses.
var (
	ErrBadFilename = errors.New("isolib: filename contains disallowed characters")
	ErrBadFormat   = errors.New("isolib: unsupported file extension")
	ErrExists      = errors.New("isolib: file already exists")
)

// SupportedExtensions is the allow-list of file extensions. Handlers
// reject uploads that don't match; prevents users from stashing
// arbitrary files in the library.
var SupportedExtensions = map[string]string{
	".iso":   "iso",
	".img":   "img",
	".qcow2": "qcow2",
	".raw":   "raw",
}

// MaxUploadBytes caps a single upload. 20 GB covers the biggest
// distro ISO (Windows Server with all options) with headroom.
const MaxUploadBytes int64 = 20 * 1024 * 1024 * 1024

// Library is the handle a handler uses. Instantiated once in main.go
// per root directory.
type Library struct {
	root string
}

// New constructs a Library rooted at absolute dir. Creates the
// directory (0755) if missing.
func New(root string) (*Library, error) {
	if !filepath.IsAbs(root) {
		return nil, fmt.Errorf("isolib: root must be absolute, got %q", root)
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("isolib: mkdir %s: %w", root, err)
	}
	return &Library{root: root}, nil
}

// Root returns the library's root directory — e.g. for the
// path-allow-list in pkg/libvirt's disk cleanup.
func (l *Library) Root() string { return l.root }

// SaveResult describes a completed upload.
type SaveResult struct {
	Name   string // basename
	Path   string // full path on disk
	Size   int64
	Format string // matches one of the keys of SupportedExtensions, minus the dot
}

// Save streams a multipart.Part to disk, validating along the way.
// Caller is responsible for limiting how much data the client can send
// (use http.MaxBytesReader on the request body upstream).
//
// On failure the partially-written file is removed — callers don't
// have to clean up. Refuses O_EXCL-style: won't silently overwrite.
func (l *Library) Save(part *multipart.Part) (*SaveResult, error) {
	name := filepath.Base(part.FileName())
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return nil, ErrBadFilename
	}
	ext := strings.ToLower(filepath.Ext(name))
	format, ok := SupportedExtensions[ext]
	if !ok {
		return nil, ErrBadFormat
	}

	dst := filepath.Join(l.root, name)
	// O_EXCL prevents overwriting a VM's in-use ISO silently. Admin
	// must Delete and re-Upload to replace.
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return nil, ErrExists
		}
		return nil, fmt.Errorf("isolib: open %s: %w", dst, err)
	}

	n, copyErr := io.Copy(f, part)
	closeErr := f.Close()

	if copyErr != nil {
		_ = os.Remove(dst) // best-effort cleanup
		return nil, fmt.Errorf("isolib: copy to %s: %w", dst, copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(dst)
		return nil, fmt.Errorf("isolib: close %s: %w", dst, closeErr)
	}

	return &SaveResult{Name: name, Path: dst, Size: n, Format: format}, nil
}

// Remove deletes a file, but only if it lives inside the library root
// (defense-in-depth against a tampered DB path row telling us to
// unlink /etc/passwd). Idempotent — returns nil if the file is
// already gone.
func (l *Library) Remove(path string) error {
	clean := filepath.Clean(path)
	// os.SameFile is overkill; prefix-check against the rooted,
	// cleaned library directory.
	libRoot := filepath.Clean(l.root) + string(filepath.Separator)
	if !strings.HasPrefix(clean, libRoot) {
		return fmt.Errorf("isolib: refusing to remove path outside library: %s", path)
	}
	if err := os.Remove(clean); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("isolib: remove %s: %w", clean, err)
	}
	return nil
}
