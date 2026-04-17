package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ISO is one row of the library. Wire shape matches vm-manager's
// /api/images so the existing Images.jsx renders without changes.
type ISO struct {
	ID         int64     `json:"id"`
	OwnerID    *int64    `json:"owner_id,omitempty"` // nil = shared
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Size       int64     `json:"size"`
	Format     string    `json:"format"`
	Status     string    `json:"status"`
	Error      string    `json:"error,omitempty"`
	UploadedAt time.Time `json:"uploaded_at"`
}

// CreateISOArgs is the input for registering a newly-saved file.
type CreateISOArgs struct {
	OwnerID *int64 // nil for shared/admin library
	Name    string
	Path    string
	Size    int64
	Format  string // "iso" | "qcow2" | "raw" | "img"
}

const isoColumns = `id, owner_id, name, path, size, format, status, error, uploaded_at`

func scanISO(row interface{ Scan(...any) error }) (*ISO, error) {
	i := &ISO{}
	var ownerID sql.NullInt64
	var errMsg sql.NullString
	err := row.Scan(&i.ID, &ownerID, &i.Name, &i.Path, &i.Size, &i.Format, &i.Status, &errMsg, &i.UploadedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if ownerID.Valid {
		v := ownerID.Int64
		i.OwnerID = &v
	}
	if errMsg.Valid {
		i.Error = errMsg.String
	}
	return i, nil
}

// CreateISO inserts a row. Path must be unique (enforced by DB).
func (db *DB) CreateISO(ctx context.Context, a CreateISOArgs) (*ISO, error) {
	var ownerIDArg any
	if a.OwnerID != nil {
		ownerIDArg = *a.OwnerID
	}
	res, err := db.ExecContext(ctx, `
		INSERT INTO isos (owner_id, name, path, size, format, status, uploaded_at)
		VALUES (?, ?, ?, ?, ?, 'ready', ?)
	`, ownerIDArg, a.Name, a.Path, a.Size, a.Format, time.Now())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return db.GetISO(ctx, id)
}

// GetISO looks up a single row by id.
func (db *DB) GetISO(ctx context.Context, id int64) (*ISO, error) {
	row := db.QueryRowContext(ctx, `SELECT `+isoColumns+` FROM isos WHERE id = ?`, id)
	return scanISO(row)
}

// ListISOs returns rows visible to the caller: all shared (owner_id IS
// NULL) + any owned by userID. Pass userID=0 for shared-only.
// Admin-visibility (see everything) is enforced at the handler level
// by passing a special sentinel; we keep this method narrow on purpose.
func (db *DB) ListISOs(ctx context.Context, userID int64) ([]ISO, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT `+isoColumns+` FROM isos
		WHERE owner_id IS NULL OR owner_id = ?
		ORDER BY uploaded_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	return scanISOs(rows)
}

// ListAllISOs — admin view, includes every user's uploads. Used only
// by the admin API (not yet mounted) — handlers otherwise use ListISOs.
func (db *DB) ListAllISOs(ctx context.Context) ([]ISO, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT `+isoColumns+` FROM isos ORDER BY uploaded_at DESC
	`)
	if err != nil {
		return nil, err
	}
	return scanISOs(rows)
}

func scanISOs(rows *sql.Rows) ([]ISO, error) {
	defer rows.Close()
	out := []ISO{}
	for rows.Next() {
		iso, err := scanISO(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *iso)
	}
	return out, rows.Err()
}

// DeleteISO removes the row. Handler is responsible for removing the
// file from disk — DB operation is intentionally narrow so cleanup
// order is explicit in the handler (file first, then row, to avoid
// a dangling row pointing at a deleted file on crash mid-op).
func (db *DB) DeleteISO(ctx context.Context, id int64) error {
	res, err := db.ExecContext(ctx, `DELETE FROM isos WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
