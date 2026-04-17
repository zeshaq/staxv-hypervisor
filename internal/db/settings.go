package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/zeshaq/staxv-hypervisor/pkg/secrets"
)

// Settings key/value constraints. Kept explicit so callers can surface
// helpful error messages.
var (
	ErrKeyInvalid  = errors.New("invalid setting key")
	ErrValueTooBig = errors.New("value exceeds max size")

	// keyRe: lowercase letter start, then lowercase alphanum/_/. up to
	// 64 chars total. Prevents weirdness like empty keys, path tricks,
	// or mixed-case drift (e.g. both "PullSecret" and "pull_secret").
	keyRe = regexp.MustCompile(`^[a-z][a-z0-9_.]{0,63}$`)
)

// MaxSettingValueSize caps each value at 128 KB — plenty for SSH keys
// (~5 KB), pull secrets (~2 KB), kubeconfigs (~10 KB), and tokens.
// Larger blobs belong in a file/object store, not here.
const MaxSettingValueSize = 128 * 1024

// Setting is one decrypted key/value pair for the caller.
type Setting struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SettingsStore is CRUD over the settings table, with AES-GCM at rest.
type SettingsStore struct {
	db  *DB
	enc *secrets.AEAD
}

// NewSettingsStore wires a SettingsStore against an open DB and an
// initialized AEAD. Pass the AEAD built from the configured secret key.
func NewSettingsStore(db *DB, enc *secrets.AEAD) *SettingsStore {
	return &SettingsStore{db: db, enc: enc}
}

// Get returns the decrypted value for (ownerID, key). Pass ownerID=nil
// for a system-wide setting. Returns ErrNotFound on miss — do NOT
// convert that to 403/forbidden upstream; the "doesn't exist for you"
// behavior is intentional (no existence leak across owners).
func (s *SettingsStore) Get(ctx context.Context, ownerID *int64, key string) (*Setting, error) {
	if !keyRe.MatchString(key) {
		return nil, ErrKeyInvalid
	}
	var encrypted []byte
	var updatedAt time.Time
	row := s.db.QueryRowContext(ctx, `
		SELECT value_encrypted, updated_at FROM settings
		WHERE IFNULL(owner_id, -1) = IFNULL(?, -1) AND key = ?
	`, ownerID, key)
	if err := row.Scan(&encrypted, &updatedAt); err == sql.ErrNoRows {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	plain, err := s.enc.Decrypt(encrypted)
	if err != nil {
		return nil, fmt.Errorf("decrypt settings key %q: %w", key, err)
	}
	return &Setting{Key: key, Value: string(plain), UpdatedAt: updatedAt}, nil
}

// Set upserts (ownerID, key) = value, encrypting the value. Implemented
// as delete+insert in one tx — simpler than ON CONFLICT with expression
// indexes and still atomic.
func (s *SettingsStore) Set(ctx context.Context, ownerID *int64, key, value string) error {
	if !keyRe.MatchString(key) {
		return ErrKeyInvalid
	}
	if len(value) > MaxSettingValueSize {
		return ErrValueTooBig
	}
	enc, err := s.enc.Encrypt([]byte(value))
	if err != nil {
		return fmt.Errorf("encrypt: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck — safe no-op if already committed

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM settings
		WHERE IFNULL(owner_id, -1) = IFNULL(?, -1) AND key = ?
	`, ownerID, key); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO settings (owner_id, key, value_encrypted, updated_at)
		VALUES (?, ?, ?, ?)
	`, ownerID, key, enc, time.Now()); err != nil {
		return err
	}
	return tx.Commit()
}

// Delete removes (ownerID, key). Returns ErrNotFound if no row exists
// (including "exists for another owner") — again, no existence leak.
func (s *SettingsStore) Delete(ctx context.Context, ownerID *int64, key string) error {
	if !keyRe.MatchString(key) {
		return ErrKeyInvalid
	}
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM settings
		WHERE IFNULL(owner_id, -1) = IFNULL(?, -1) AND key = ?
	`, ownerID, key)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// List returns just the keys for an owner, ordered. Values are NOT
// returned — callers fetch individual values via Get. This keeps
// listing cheap and avoids shipping decrypted blobs when the caller
// only wants to know "what do I have stored?".
func (s *SettingsStore) List(ctx context.Context, ownerID *int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT key FROM settings
		WHERE IFNULL(owner_id, -1) = IFNULL(?, -1)
		ORDER BY key
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}
