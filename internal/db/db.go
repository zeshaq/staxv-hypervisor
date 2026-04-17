// Package db opens the SQLite store and runs embedded migrations.
//
// Uses modernc.org/sqlite (pure Go, no cgo) per the tech-stack decision
// in .claude/memory/project_context.md.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"path/filepath"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// DB wraps *sql.DB so package-specific methods (GetUserByID etc.) can
// hang off it without polluting the stdlib type.
type DB struct {
	*sql.DB
}

// Open opens (or creates) the SQLite database at path, runs any pending
// migrations, and returns a ready-to-use handle.
//
// Pragmas applied:
//   - journal_mode=WAL    — better concurrent-reader story
//   - foreign_keys=on     — enforce FK constraints (off by default in SQLite!)
//   - busy_timeout=5000   — wait up to 5s for locks instead of erroring
func Open(ctx context.Context, path string) (*DB, error) {
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)&_pragma=busy_timeout(5000)",
		filepath.Clean(path),
	)
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// modernc driver doesn't pool like mattn does — single connection is
	// safest for SQLite with WAL. Multiple writers still serialize, but
	// readers run concurrently via the WAL.
	sqldb.SetMaxOpenConns(1)

	if err := sqldb.PingContext(ctx); err != nil {
		_ = sqldb.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	db := &DB{sqldb}
	if err := db.migrate(ctx); err != nil {
		_ = sqldb.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

// migrate applies any .sql files in migrations/ that haven't run yet.
// Migrations are ordered lexicographically (0001_*, 0002_*, ...).
// Each migration runs in its own transaction; any error aborts the
// whole startup.
func (db *DB) migrate(ctx context.Context) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(entries)

	for _, path := range entries {
		version := strings.TrimSuffix(strings.TrimPrefix(path, "migrations/"), ".sql")

		var already int
		if err := db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version,
		).Scan(&already); err != nil {
			return err
		}
		if already > 0 {
			continue
		}

		body, err := migrationsFS.ReadFile(path)
		if err != nil {
			return err
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply %s: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations (version) VALUES (?)`, version,
		); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		slog.Info("applied migration", "version", version)
	}
	return nil
}
