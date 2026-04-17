package secrets

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
)

// LoadOrCreateKey reads a KeySize-byte encryption key from path, or
// generates and persists one if missing. The file is created 0600 and
// its parent directory 0700.
//
// Losing this key renders all encrypted settings unreadable. Operators
// should back it up when they start storing real secrets (and rotate
// it with a migration when that feature lands).
func LoadOrCreateKey(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) != KeySize {
			return nil, fmt.Errorf("secrets: key at %s has wrong length (%d, want %d) — delete to regenerate", path, len(b), KeySize)
		}
		return b, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	k := make([]byte, KeySize)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, k, 0600); err != nil {
		return nil, err
	}
	return k, nil
}
