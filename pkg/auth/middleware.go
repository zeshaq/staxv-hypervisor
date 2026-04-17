package auth

import (
	"context"
	"encoding/json"
	"net/http"
)

// CookieName is the name of the session cookie. Consistent across login,
// logout, and middleware.
const CookieName = "staxv_session"

// UserStore is the minimal DB interface the middleware needs — just
// "load user by ID." internal/db satisfies it; test fakes also do.
type UserStore interface {
	GetUserByID(ctx context.Context, id int64) (*User, error)
}

// Middleware returns a chi-compatible middleware that:
//  1. Reads the session cookie
//  2. Verifies the JWT with signer
//  3. Loads the user by ID from store
//  4. Rejects with 401 if disabled
//  5. Attaches the user to the request context via WithUser
//
// Subsequent handlers use UserFromCtx to get the user. Errors respond
// with 401 + a JSON {"error": "..."} body — never 500 — so the frontend
// can redirect to login cleanly.
func Middleware(signer *Signer, store UserStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(CookieName)
			if err != nil {
				writeAuthError(w, "missing session", http.StatusUnauthorized)
				return
			}
			claims, err := signer.Verify(c.Value)
			if err != nil {
				writeAuthError(w, "invalid session", http.StatusUnauthorized)
				return
			}
			u, err := store.GetUserByID(r.Context(), claims.UserID)
			if err != nil || u == nil {
				writeAuthError(w, "unknown user", http.StatusUnauthorized)
				return
			}
			if u.Disabled() {
				writeAuthError(w, "account disabled", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), u)))
		})
	}
}

// RequireAdmin is mounted after Middleware. Returns 403 if the user is
// not an admin. Does NOT return 404 on non-admin — existence of admin
// routes isn't a secret, and 403 is more honest than pretending the
// route doesn't exist.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromCtx(r.Context())
		if u == nil || !u.IsAdmin {
			writeAuthError(w, "admin only", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeAuthError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
