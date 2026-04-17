package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/zeshaq/staxv-hypervisor/internal/db"
	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
)

// SettingsHandler serves /api/settings — per-user encrypted key/value.
//
// System-wide settings (owner_id IS NULL in the table) are intentionally
// NOT exposed here. They land with the admin API.
type SettingsHandler struct {
	store *db.SettingsStore
}

func NewSettingsHandler(store *db.SettingsStore) *SettingsHandler {
	return &SettingsHandler{store: store}
}

// Mount attaches the routes. All require a valid session.
func (h *SettingsHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/settings", func(r chi.Router) {
		r.Use(authMW)
		r.Get("/", h.List)
		r.Get("/{key}", h.Get)
		r.Put("/{key}", h.Set)
		r.Delete("/{key}", h.Delete)
	})
}

type listResponse struct {
	Keys []string `json:"keys"`
}

func (h *SettingsHandler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	keys, err := h.store.List(r.Context(), &u.ID)
	if err != nil {
		slog.Error("settings list", "err", err, "user_id", u.ID)
		writeError(w, "list failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, listResponse{Keys: keys})
}

func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	key := chi.URLParam(r, "key")

	setting, err := h.store.Get(r.Context(), &u.ID, key)
	switch {
	case errors.Is(err, db.ErrNotFound), errors.Is(err, db.ErrKeyInvalid):
		// Same 404 for "not found" and "invalid key" — keeps clients
		// unable to probe the key-format rules for enumeration.
		writeError(w, "not found", http.StatusNotFound)
		return
	case err != nil:
		slog.Error("settings get", "err", err, "user_id", u.ID, "key", key)
		writeError(w, "get failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, setting)
}

type setRequest struct {
	Value string `json:"value"`
}

func (h *SettingsHandler) Set(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	key := chi.URLParam(r, "key")

	// Defend against absurd request bodies even before JSON parse.
	r.Body = http.MaxBytesReader(w, r.Body, int64(db.MaxSettingValueSize)+4096)
	var req setRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	err := h.store.Set(r.Context(), &u.ID, key, req.Value)
	switch {
	case errors.Is(err, db.ErrKeyInvalid):
		writeError(w, `invalid key (must match ^[a-z][a-z0-9_.]{0,63}$)`, http.StatusBadRequest)
		return
	case errors.Is(err, db.ErrValueTooBig):
		writeError(w, "value too large (max 128KB)", http.StatusBadRequest)
		return
	case err != nil:
		slog.Error("settings set", "err", err, "user_id", u.ID, "key", key)
		writeError(w, "set failed", http.StatusInternalServerError)
		return
	}
	slog.Info("settings set", "user_id", u.ID, "key", key, "bytes", len(req.Value))
	w.WriteHeader(http.StatusNoContent)
}

func (h *SettingsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	key := chi.URLParam(r, "key")

	err := h.store.Delete(r.Context(), &u.ID, key)
	switch {
	case errors.Is(err, db.ErrNotFound), errors.Is(err, db.ErrKeyInvalid):
		writeError(w, "not found", http.StatusNotFound)
		return
	case err != nil:
		slog.Error("settings delete", "err", err, "user_id", u.ID, "key", key)
		writeError(w, "delete failed", http.StatusInternalServerError)
		return
	}
	slog.Info("settings delete", "user_id", u.ID, "key", key)
	w.WriteHeader(http.StatusNoContent)
}
