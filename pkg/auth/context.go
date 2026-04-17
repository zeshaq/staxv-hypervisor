package auth

import "context"

// ctxKey is unexported so no other package can accidentally write to
// the same key — standard Go context-key hygiene.
type ctxKey struct{}

// WithUser returns a copy of ctx with u attached. Call this in the auth
// middleware, not from handlers.
func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

// UserFromCtx retrieves the user attached by WithUser. Returns nil if
// no user is set — handlers behind auth middleware can assume non-nil,
// but defensive code should nil-check.
//
// This is the ONE way handlers access the current user. Never read the
// JWT cookie directly in a handler. (See multi_tenancy.md §API Scoping.)
func UserFromCtx(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}
