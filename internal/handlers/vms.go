package handlers

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/zeshaq/staxv-hypervisor/internal/db"
	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
	lvpkg "github.com/zeshaq/staxv-hypervisor/pkg/libvirt"
)

// LibvirtLister is the subset of pkg/libvirt.Client the VMs handler
// uses. Kept as an interface so tests can substitute a fake.
type LibvirtLister interface {
	ListDomains() ([]lvpkg.DomainSummary, error)
}

// VMOwnershipStore is the subset of *db.DB the handler uses.
type VMOwnershipStore interface {
	ListVMOwnershipsForUser(ctx context.Context, userID int64) ([]db.VMOwnership, error)
	ListAllVMOwnerships(ctx context.Context) ([]db.VMOwnership, error)
}

// VMHandler serves /api/vms. Read-only in this iteration — start / stop /
// delete / lock / unlock land in #6 and #7.
type VMHandler struct {
	libvirt LibvirtLister
	store   VMOwnershipStore
}

func NewVMHandler(libvirt LibvirtLister, store VMOwnershipStore) *VMHandler {
	return &VMHandler{libvirt: libvirt, store: store}
}

// Mount attaches GET /api/vms, gated by authMW.
func (h *VMHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/vms", func(r chi.Router) {
		r.Use(authMW)
		r.Get("/", h.List)
	})
}

// vmResponse is the wire shape the frontend expects (one entry per VM).
// Keep this tight — uuid/name/state/state_code/memory_mb/vcpus/locked
// are all VMList.jsx reads.
//
// Two staxv-specific fields beyond that, useful to admins: owner_id
// (null = unowned) and adopted (true = exists in libvirt but staxv
// has no ownership row).
type vmResponse struct {
	UUID      string `json:"uuid"`
	Name      string `json:"name"`
	State     string `json:"state"`
	StateCode int    `json:"state_code"`
	VCPUs     uint16 `json:"vcpus"`
	MemoryMB  uint64 `json:"memory_mb"`
	Locked    bool   `json:"locked"`
	OwnerID   *int64 `json:"owner_id,omitempty"` // nil = unowned
	Adopted   bool   `json:"adopted,omitempty"`  // true = visible to admin only, no staxv ownership
}

func (h *VMHandler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		writeError(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	// Pull libvirt's live view first — it's the source of truth for
	// what VMs exist right now.
	doms, err := h.libvirt.ListDomains()
	if err != nil {
		slog.Error("vms list: libvirt", "err", err, "user_id", u.ID)
		writeError(w, "libvirt unavailable", http.StatusServiceUnavailable)
		return
	}

	// Build a UUID → ownership map. Admin gets all ownership rows;
	// regular users get only their own. That map then filters the
	// libvirt domain list.
	var owned []db.VMOwnership
	if u.IsAdmin {
		owned, err = h.store.ListAllVMOwnerships(r.Context())
	} else {
		owned, err = h.store.ListVMOwnershipsForUser(r.Context(), u.ID)
	}
	if err != nil {
		slog.Error("vms list: db", "err", err, "user_id", u.ID)
		writeError(w, "db error", http.StatusInternalServerError)
		return
	}
	ownerByUUID := make(map[string]db.VMOwnership, len(owned))
	for _, o := range owned {
		ownerByUUID[o.UUID] = o
	}

	// Stitch. A domain is visible when:
	//   - it has an ownership row for the caller (non-admin path already
	//     scoped that at the DB level), OR
	//   - the caller is admin (sees everything libvirt knows about,
	//     including pre-existing / unowned VMs marked adopted=true).
	out := make([]vmResponse, 0, len(doms))
	for _, d := range doms {
		o, claimed := ownerByUUID[d.UUID]
		switch {
		case claimed:
			ownerID := o.OwnerID
			out = append(out, vmResponse{
				UUID: d.UUID, Name: d.Name,
				State: d.State, StateCode: d.StateCode,
				VCPUs: d.VCPUs, MemoryMB: d.MemoryMB,
				Locked:  o.Locked,
				OwnerID: &ownerID,
			})
		case u.IsAdmin:
			// Admin sees unclaimed VMs with an adopted flag so the UI
			// can surface a "Claim" button later.
			out = append(out, vmResponse{
				UUID: d.UUID, Name: d.Name,
				State: d.State, StateCode: d.StateCode,
				VCPUs: d.VCPUs, MemoryMB: d.MemoryMB,
				Adopted: true,
			})
			// default: regular user, VM not owned by them — hidden.
		}
	}

	writeJSON(w, http.StatusOK, out)
}
