package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// VMOwnership is our per-VM metadata: who owns it, whether it's locked
// against destructive operations. Joined with libvirt's live domain
// state to build the full VMList response.
type VMOwnership struct {
	UUID      string    `json:"uuid"`
	OwnerID   int64     `json:"owner_id"`
	Name      string    `json:"name"`
	Locked    bool      `json:"locked"`
	CreatedAt time.Time `json:"created_at"`
}

// GetVMOwnership returns the ownership row for uuid, or ErrNotFound if
// the VM isn't staxv-managed.
func (db *DB) GetVMOwnership(ctx context.Context, uuid string) (*VMOwnership, error) {
	row := db.QueryRowContext(ctx, `
		SELECT uuid, owner_id, name, locked, created_at
		FROM vms WHERE uuid = ?
	`, uuid)
	return scanVMOwnership(row)
}

// ListVMOwnershipsForUser returns every VM owned by userID. Use this
// alongside libvirt.ListDomains() to scope per-tenant views.
func (db *DB) ListVMOwnershipsForUser(ctx context.Context, userID int64) ([]VMOwnership, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT uuid, owner_id, name, locked, created_at
		FROM vms WHERE owner_id = ?
		ORDER BY name
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []VMOwnership{}
	for rows.Next() {
		vm, err := scanVMOwnership(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *vm)
	}
	return out, rows.Err()
}

// ListAllVMOwnerships returns every staxv-managed VM across all users.
// Admin-only helper — the handler must gate access.
func (db *DB) ListAllVMOwnerships(ctx context.Context) ([]VMOwnership, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT uuid, owner_id, name, locked, created_at
		FROM vms ORDER BY owner_id, name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []VMOwnership{}
	for rows.Next() {
		vm, err := scanVMOwnership(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *vm)
	}
	return out, rows.Err()
}

// SetVMLocked flips the locked flag. Returns ErrNotFound if the VM has
// no ownership row. Callers (handlers) enforce admin-or-owner.
func (db *DB) SetVMLocked(ctx context.Context, uuid string, locked bool) error {
	res, err := db.ExecContext(ctx, `
		UPDATE vms SET locked = ? WHERE uuid = ?
	`, boolToInt(locked), uuid)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ClaimVM inserts an ownership row for an unowned libvirt domain.
// Returns an error if the UUID is already claimed (by anyone). Typical
// call-site: admin adopt-UI, or the VM-create flow (issue #5).
func (db *DB) ClaimVM(ctx context.Context, uuid, name string, ownerID int64) (*VMOwnership, error) {
	_, err := db.ExecContext(ctx, `
		INSERT INTO vms (uuid, owner_id, name, locked, created_at)
		VALUES (?, ?, ?, 0, ?)
	`, uuid, ownerID, name, time.Now())
	if err != nil {
		return nil, fmt.Errorf("claim vm %s: %w", uuid, err)
	}
	return db.GetVMOwnership(ctx, uuid)
}

// ReleaseVM removes the ownership row (e.g. VM deleted in libvirt or
// admin unclaim). Idempotent — no error if the row already didn't exist.
func (db *DB) ReleaseVM(ctx context.Context, uuid string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM vms WHERE uuid = ?`, uuid)
	return err
}

func scanVMOwnership(row interface{ Scan(...any) error }) (*VMOwnership, error) {
	v := &VMOwnership{}
	var locked int
	err := row.Scan(&v.UUID, &v.OwnerID, &v.Name, &locked, &v.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	v.Locked = locked != 0
	return v, nil
}
