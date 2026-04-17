// Package handlers is the thin HTTP layer — it decodes requests, calls
// into pkg/auth / internal/db / pkg/vm / etc., and encodes responses.
// No business logic lives here.
package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/zeshaq/staxv-hypervisor/internal/db"
	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
)

// CredentialStore is the subset of DB ops the auth handlers need.
// Kept as an interface so tests (and future LDAP/OIDC backends) can
// substitute without touching the HTTP layer.
type CredentialStore interface {
	VerifyCredentials(ctx context.Context, username, password string) (*auth.User, error)
}

// AuthHandler wires login/logout/me.
type AuthHandler struct {
	store  CredentialStore
	signer *auth.Signer
	secure bool // set cookie Secure=true when serving behind TLS
}

// NewAuthHandler constructs the handler. secure=true in prod/staging
// (behind TLS), false in local dev (plain HTTP).
func NewAuthHandler(store CredentialStore, signer *auth.Signer, secure bool) *AuthHandler {
	return &AuthHandler{store: store, signer: signer, secure: secure}
}

// Mount attaches /api/auth/{login,logout,me} to r. `me` is wrapped in
// authMW; login/logout stay public.
func (h *AuthHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/login", h.Login)
		r.Post("/logout", h.Logout)
		r.With(authMW).Get("/me", h.Me)
	})
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type userResponse struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
}

func userResp(u *auth.User) userResponse {
	return userResponse{ID: u.ID, Username: u.Username, IsAdmin: u.IsAdmin}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" {
		writeError(w, "username and password required", http.StatusBadRequest)
		return
	}

	u, err := h.store.VerifyCredentials(r.Context(), req.Username, req.Password)
	if err != nil {
		// Same status + message for all failure modes (see db.ErrInvalidCredentials).
		if !errors.Is(err, db.ErrInvalidCredentials) {
			slog.Error("login: unexpected DB error", "err", err, "username", req.Username)
		}
		writeError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := h.signer.Issue(u)
	if err != nil {
		slog.Error("login: issue token", "err", err)
		writeError(w, "internal error", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(h.signer.TTL()),
	})

	slog.Info("login", "user_id", u.ID, "username", u.Username, "admin", u.IsAdmin)
	writeJSON(w, http.StatusOK, userResp(u))
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1, // expire immediately
	})
	w.WriteHeader(http.StatusNoContent)
}

// Me returns the currently-authenticated user. Used by the frontend to
// bootstrap the login state on page load.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		// Should never happen — middleware guarantees this.
		writeError(w, "no user in context", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, userResp(u))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, msg string, status int) {
	writeJSON(w, status, map[string]string{"error": msg})
}
