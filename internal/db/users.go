package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
)

// ErrNotFound is returned when a lookup finds no matching row. Callers
// map this to HTTP 404 (never leak which ID exists vs which doesn't).
var ErrNotFound = errors.New("not found")

// ErrInvalidCredentials is the single error returned by VerifyCredentials
// for any failure mode (unknown user, bad password, disabled account).
// Don't distinguish — prevents user enumeration via timing or message.
var ErrInvalidCredentials = errors.New("invalid credentials")

// userColumns is the SELECT list used everywhere users are loaded —
// keeps the scan order identical across queries.
const userColumns = `
	id, username, unix_username, unix_uid, adopted,
	home_path, staxv_dir, is_admin, ssh_enabled,
	quota_vcpus, quota_ram_mb, quota_disk_gb, quota_vms, quota_clusters,
	created_at, disabled_at
`

func scanUser(row interface{ Scan(...any) error }) (*auth.User, error) {
	u := &auth.User{}
	var disabledAt sql.NullTime
	err := row.Scan(
		&u.ID, &u.Username, &u.UnixUsername, &u.UnixUID, &u.Adopted,
		&u.HomePath, &u.StaxvDir, &u.IsAdmin, &u.SSHEnabled,
		&u.QuotaVCPUs, &u.QuotaRAMMB, &u.QuotaDiskGB, &u.QuotaVMs, &u.QuotaClusters,
		&u.CreatedAt, &disabledAt,
	)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if disabledAt.Valid {
		u.DisabledAt = &disabledAt.Time
	}
	return u, nil
}

// GetUserByID satisfies auth.UserStore — this is what the middleware
// calls on every authenticated request. Keep it fast.
func (db *DB) GetUserByID(ctx context.Context, id int64) (*auth.User, error) {
	row := db.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT %s FROM users WHERE id = ?`, userColumns), id)
	return scanUser(row)
}

// GetUserByUsername is used by login and by admin tooling.
func (db *DB) GetUserByUsername(ctx context.Context, username string) (*auth.User, error) {
	row := db.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT %s FROM users WHERE username = ?`, userColumns), username)
	return scanUser(row)
}

// VerifyCredentials is the single entry point for password login. It
// returns the user on success, or a generic ErrInvalidCredentials on
// any failure (so 401 responses don't leak "this username exists but
// the password is wrong").
func (db *DB) VerifyCredentials(ctx context.Context, username, password string) (*auth.User, error) {
	// Fetch hash + full user in one query — avoid round-trips.
	row := db.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT password_hash, %s FROM users WHERE username = ?`, userColumns),
		username)

	var hash string
	u := &auth.User{}
	var disabledAt sql.NullTime
	err := row.Scan(
		&hash,
		&u.ID, &u.Username, &u.UnixUsername, &u.UnixUID, &u.Adopted,
		&u.HomePath, &u.StaxvDir, &u.IsAdmin, &u.SSHEnabled,
		&u.QuotaVCPUs, &u.QuotaRAMMB, &u.QuotaDiskGB, &u.QuotaVMs, &u.QuotaClusters,
		&u.CreatedAt, &disabledAt,
	)
	if err == sql.ErrNoRows {
		// Intentionally the same error the bad-password path returns.
		// Don't leak that the username is unknown.
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if disabledAt.Valid {
		u.DisabledAt = &disabledAt.Time
	}
	if u.Disabled() {
		return nil, ErrInvalidCredentials
	}
	if err := auth.VerifyPassword(hash, password); err != nil {
		return nil, ErrInvalidCredentials
	}
	return u, nil
}

// CreateUserArgs is the input to CreateUser. Quotas default to 0 for
// now (unlimited); the full multi-tenancy epic (#33) will wire up real
// defaults and admin-facing quota management.
//
// NOTE: this does NOT create a Linux account, a home directory, or a
// libvirt storage pool. Those steps are the job of
// `internal/provision/` (which doesn't exist yet). This is the
// DB-only half of user creation — useful for bootstrapping a test
// admin during development.
type CreateUserArgs struct {
	Username     string
	Password     string
	UnixUsername string
	UnixUID      int
	HomePath     string
	StaxvDir     string
	IsAdmin      bool
}

// CreateUser inserts a users row and returns the inserted user.
// Returns a wrapped error if username is already taken.
func (db *DB) CreateUser(ctx context.Context, a CreateUserArgs) (*auth.User, error) {
	hash, err := auth.HashPassword(a.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}
	res, err := db.ExecContext(ctx, `
		INSERT INTO users (
			username, password_hash, unix_username, unix_uid,
			home_path, staxv_dir, is_admin, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, a.Username, hash, a.UnixUsername, a.UnixUID,
		a.HomePath, a.StaxvDir, boolToInt(a.IsAdmin), time.Now())
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}
	id, _ := res.LastInsertId()
	return db.GetUserByID(ctx, id)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
