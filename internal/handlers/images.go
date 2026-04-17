package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/zeshaq/staxv-hypervisor/internal/db"
	"github.com/zeshaq/staxv-hypervisor/internal/isolib"
	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
)

// ISOStore is the subset of *db.DB the images handler needs.
type ISOStore interface {
	ListISOs(ctx context.Context, userID int64) ([]db.ISO, error)
	ListAllISOs(ctx context.Context) ([]db.ISO, error)
	GetISO(ctx context.Context, id int64) (*db.ISO, error)
	CreateISO(ctx context.Context, a db.CreateISOArgs) (*db.ISO, error)
	DeleteISO(ctx context.Context, id int64) error
}

// ImagesHandler serves /api/images — ISO library (and later, disk
// templates). For now: admin uploads shared ISOs, everyone can list.
// Per-user ISOs are deferred to #33 along with per-user storage pools.
type ImagesHandler struct {
	store ISOStore
	lib   *isolib.Library
}

func NewImagesHandler(store ISOStore, lib *isolib.Library) *ImagesHandler {
	return &ImagesHandler{store: store, lib: lib}
}

// Mount attaches /api/images. All routes require auth; upload+delete
// additionally require admin.
func (h *ImagesHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/images", func(r chi.Router) {
		r.Use(authMW)
		r.Get("/", h.List)
		r.Get("/catalog", h.Catalog) // stub — returns empty list until we wire a real catalog
		// Admin-only write operations
		r.With(auth.RequireAdmin).Post("/upload", h.Upload)
		r.With(auth.RequireAdmin).Post("/", h.CreateByURL) // async download; stubbed for now
		r.With(auth.RequireAdmin).Delete("/{id}", h.Delete)
	})
}

// List returns ISOs visible to the caller. Shared ISOs (owner_id NULL)
// are visible to everyone; each user sees their own plus shared.
// Admin sees every row.
//
// Response shape: {"images": [...]} matches vm-manager's API so the
// existing Images.jsx renders without changes.
func (h *ImagesHandler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())

	var (
		items []db.ISO
		err   error
	)
	if u.IsAdmin {
		items, err = h.store.ListAllISOs(r.Context())
	} else {
		items, err = h.store.ListISOs(r.Context(), u.ID)
	}
	if err != nil {
		slog.Error("images list", "err", err, "user_id", u.ID)
		writeError(w, "list failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": items})
}

// Catalog is a stub. vm-manager's version returns a curated distro
// list the admin can one-click download. Wiring it properly needs the
// job engine (#31) to manage the async downloads. For now: empty so
// the frontend renders cleanly.
func (h *ImagesHandler) Catalog(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"catalog": []any{}})
}

// CreateByURL is a stub for "download from URL" — placeholder until
// #31 job engine lands. Returns 501 with a clear message so the
// frontend's download-from-URL form surfaces a real error rather than
// silent hanging.
func (h *ImagesHandler) CreateByURL(w http.ResponseWriter, _ *http.Request) {
	writeError(w, "URL-based image download not yet supported — upload the file directly for now", http.StatusNotImplemented)
}

// Upload streams a multipart form upload directly to disk. Capped at
// isolib.MaxUploadBytes (20 GB). Writes the ISO under the shared
// library root with owner_id NULL.
//
// The frontend sends `file=@path` as a single part. We don't parse
// the whole form — just walk parts until we find the file, process
// it, and stop.
func (h *ImagesHandler) Upload(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	// RequireAdmin middleware already enforced; belt & braces below.
	if !u.IsAdmin {
		writeError(w, "admin only", http.StatusForbidden)
		return
	}

	// Cap total request size. The multipart framework enforces this
	// during Part reads — goes over → io.ErrUnexpectedEOF.
	r.Body = http.MaxBytesReader(w, r.Body, isolib.MaxUploadBytes+1024*1024) // +1MB for headers/form boilerplate

	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, "expected multipart/form-data", http.StatusBadRequest)
		return
	}

	for {
		part, err := reader.NextPart()
		if err == nil && part.FormName() != "file" {
			// Skip non-file form fields (frontend sometimes sends
			// metadata alongside; drain and move on).
			_ = part.Close()
			continue
		}
		if err != nil {
			if errors.Is(err, http.ErrNotMultipart) {
				writeError(w, "not a multipart form", http.StatusBadRequest)
				return
			}
			writeError(w, "no file part in form", http.StatusBadRequest)
			return
		}

		res, err := h.lib.Save(part)
		_ = part.Close()
		if err != nil {
			switch {
			case errors.Is(err, isolib.ErrBadFilename):
				writeError(w, "invalid filename", http.StatusBadRequest)
			case errors.Is(err, isolib.ErrBadFormat):
				writeError(w, "unsupported file extension (allowed: .iso .img .qcow2 .raw)", http.StatusBadRequest)
			case errors.Is(err, isolib.ErrExists):
				writeError(w, "file already exists — delete before re-uploading", http.StatusConflict)
			default:
				slog.Error("images upload", "err", err, "user_id", u.ID)
				writeError(w, "upload failed: "+err.Error(), http.StatusInternalServerError)
			}
			return
		}

		iso, err := h.store.CreateISO(r.Context(), db.CreateISOArgs{
			OwnerID: nil, // shared library
			Name:    res.Name,
			Path:    res.Path,
			Size:    res.Size,
			Format:  res.Format,
		})
		if err != nil {
			// File is on disk but DB row failed — clean up to avoid
			// orphan files. Best-effort.
			_ = h.lib.Remove(res.Path)
			slog.Error("images upload: db insert", "err", err, "path", res.Path)
			writeError(w, "registration failed", http.StatusInternalServerError)
			return
		}

		slog.Info("iso uploaded",
			"id", iso.ID, "name", iso.Name, "size", iso.Size,
			"by_user", u.ID,
		)
		writeJSON(w, http.StatusCreated, iso)
		return
	}
}

// Delete removes the ISO row and (by default) the file. Query param
// `delete_file=false` keeps the file on disk — use case: admin moved
// the file manually and wants only the DB entry dropped.
func (h *ImagesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if !u.IsAdmin {
		writeError(w, "admin only", http.StatusForbidden)
		return
	}
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	iso, err := h.store.GetISO(r.Context(), id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, "not found", http.StatusNotFound)
			return
		}
		writeError(w, "lookup failed", http.StatusInternalServerError)
		return
	}

	deleteFile := r.URL.Query().Get("delete_file") != "false"

	// DB row first. If file removal fails, the row is gone — admin
	// re-reconciles manually. Keeping the row while the file is gone
	// would be a worse failure mode (UI shows broken entries).
	if err := h.store.DeleteISO(r.Context(), id); err != nil {
		slog.Error("images delete: db", "err", err, "id", id)
		writeError(w, "delete failed", http.StatusInternalServerError)
		return
	}
	if deleteFile {
		if err := h.lib.Remove(iso.Path); err != nil {
			slog.Warn("images delete: file remove failed (row already gone)", "err", err, "path", iso.Path)
			// Don't fail the response — the DB row is gone, UI will
			// refresh correctly. Admin sees a warning in server logs.
		}
	}

	slog.Info("iso deleted", "id", id, "name", iso.Name, "by_user", u.ID, "removed_file", deleteFile)
	w.WriteHeader(http.StatusNoContent)
}
