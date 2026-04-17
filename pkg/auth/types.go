// Package auth provides user identity primitives: the User type, password
// hashing, JWT signing, request-context helpers, and HTTP middleware.
//
// It is intentionally dependency-light: no database driver, no router, no
// HTTP routes. Those live in internal/db and internal/handlers. Anyone
// wanting to implement a different storage backend (e.g. LDAP, an external
// identity service) can do so by satisfying auth.UserStore.
package auth

import "time"

// User is the in-memory representation of a staxv user. It mirrors the
// `users` table schema defined in .claude/memory/multi_tenancy.md, minus
// the password hash (which never leaves the DB layer).
type User struct {
	ID            int64
	Username      string
	UnixUsername  string
	UnixUID       int
	Adopted       bool
	HomePath      string
	StaxvDir      string
	IsAdmin       bool
	SSHEnabled    bool
	QuotaVCPUs    int
	QuotaRAMMB    int
	QuotaDiskGB   int
	QuotaVMs      int
	QuotaClusters int
	CreatedAt     time.Time
	DisabledAt    *time.Time // nil = active
}

// Disabled reports whether the account is soft-deleted.
func (u *User) Disabled() bool {
	return u != nil && u.DisabledAt != nil
}
