package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/zeshaq/staxv-hypervisor/internal/db"
	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
	lvpkg "github.com/zeshaq/staxv-hypervisor/pkg/libvirt"
)

// LibvirtClient is the subset of pkg/libvirt.Client the VMs handler
// uses. Kept as an interface so tests can substitute a fake.
type LibvirtClient interface {
	ListDomains() ([]lvpkg.DomainSummary, error)
	StartDomain(uuid string) error
	ShutdownDomain(uuid string) error
	ForceStopDomain(uuid string) error
	RebootDomain(uuid string) error
}

// VMOwnershipStore is the subset of *db.DB the handler uses.
type VMOwnershipStore interface {
	ListVMOwnershipsForUser(ctx context.Context, userID int64) ([]db.VMOwnership, error)
	ListAllVMOwnerships(ctx context.Context) ([]db.VMOwnership, error)
	GetVMOwnership(ctx context.Context, uuid string) (*db.VMOwnership, error)
	SetVMLocked(ctx context.Context, uuid string, locked bool) error
}

// VMHandler serves /api/vms. Read + power ops + lock/unlock.
// Delete (#7) and create (#5) still pending.
type VMHandler struct {
	libvirt LibvirtClient
	store   VMOwnershipStore
}

func NewVMHandler(libvirt LibvirtClient, store VMOwnershipStore) *VMHandler {
	return &VMHandler{libvirt: libvirt, store: store}
}

// Mount attaches /api/vms routes, all gated by authMW.
func (h *VMHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/vms", func(r chi.Router) {
		r.Use(authMW)
		r.Get("/", h.List)
		// Power ops — owner or admin. Not gated by locked flag;
		// "locked" protects delete, not power cycling.
		r.Post("/{uuid}/start", h.Start)
		r.Post("/{uuid}/shutdown", h.Shutdown)
		r.Post("/{uuid}/stop", h.ForceStop) // frontend calls "stop" for force — keep the name
		r.Post("/{uuid}/reboot", h.Reboot)
		// Lock toggle — owner or admin. Refused on adopted VMs (no
		// ownership row → no row to flip). Admin claims first.
		r.Post("/{uuid}/lock", h.Lock)
		r.Post("/{uuid}/unlock", h.Unlock)
	})
}

// requireVMAccess enforces the per-user/admin view rules on any action.
// Returns:
//   - (ownership, nil) — caller owns the VM, or caller is admin and VM is claimed
//   - (nil, nil)       — caller is admin and VM is UNCLAIMED (adopted=true in List).
//                        Caller can proceed for libvirt-only actions (power ops),
//                        but ownership-flag actions (lock/unlock) must refuse.
//   - (nil, ErrNotFound) — caller has no visibility on this UUID
//
// All non-authorized paths return db.ErrNotFound, not a "forbidden"
// error. No cross-user existence leaks.
func (h *VMHandler) requireVMAccess(ctx context.Context, u *auth.User, uuid string) (*db.VMOwnership, error) {
	own, err := h.store.GetVMOwnership(ctx, uuid)
	switch {
	case errors.Is(err, db.ErrNotFound):
		if u.IsAdmin {
			return nil, nil // admin acting on unclaimed libvirt VM
		}
		return nil, db.ErrNotFound
	case err != nil:
		return nil, err
	case !u.IsAdmin && own.OwnerID != u.ID:
		return nil, db.ErrNotFound
	default:
		return own, nil
	}
}

// writeActionResult maps action errors to HTTP responses consistently
// across start/shutdown/stop/reboot/lock/unlock.
func (h *VMHandler) writeActionResult(w http.ResponseWriter, action, uuid string, err error) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, db.ErrNotFound), errors.Is(err, lvpkg.ErrDomainNotFound):
		writeError(w, "not found", http.StatusNotFound)
	default:
		// Real libvirt/DB error — log, return 400 (most user-facing
		// power-op failures are "VM already in requested state" or
		// "guest not ACPI-capable" which are legit 400s).
		slog.Warn("vm action failed", "action", action, "uuid", uuid, "err", err)
		writeError(w, "action failed: "+err.Error(), http.StatusBadRequest)
	}
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

// -----------------------------------------------------------------------
// Power operations
// -----------------------------------------------------------------------

// Start boots a VM.
func (h *VMHandler) Start(w http.ResponseWriter, r *http.Request) {
	h.doPowerAction(w, r, "start", h.libvirt.StartDomain)
}

// Shutdown sends ACPI shutdown. Graceful — may take minutes.
func (h *VMHandler) Shutdown(w http.ResponseWriter, r *http.Request) {
	h.doPowerAction(w, r, "shutdown", h.libvirt.ShutdownDomain)
}

// ForceStop is the "pull the plug" equivalent. Guest filesystems may
// end up dirty. Mounted at /stop because that's what vm-manager's
// frontend calls it.
func (h *VMHandler) ForceStop(w http.ResponseWriter, r *http.Request) {
	h.doPowerAction(w, r, "force-stop", h.libvirt.ForceStopDomain)
}

// Reboot sends ACPI reboot.
func (h *VMHandler) Reboot(w http.ResponseWriter, r *http.Request) {
	h.doPowerAction(w, r, "reboot", h.libvirt.RebootDomain)
}

// doPowerAction is the shared skeleton: auth-check, then call the given
// libvirt function. All four power ops use this; only the libvirt method
// and the action name differ.
func (h *VMHandler) doPowerAction(w http.ResponseWriter, r *http.Request, action string, fn func(string) error) {
	u := auth.UserFromCtx(r.Context())
	uuid := chi.URLParam(r, "uuid")

	if _, err := h.requireVMAccess(r.Context(), u, uuid); err != nil {
		h.writeActionResult(w, action, uuid, err)
		return
	}
	if err := fn(uuid); err != nil {
		h.writeActionResult(w, action, uuid, err)
		return
	}
	slog.Info("vm power action",
		"action", action, "uuid", uuid, "user_id", u.ID, "is_admin", u.IsAdmin)
	w.WriteHeader(http.StatusNoContent)
}

// -----------------------------------------------------------------------
// Lock / unlock — DB-only; refused on adopted (unclaimed) VMs
// -----------------------------------------------------------------------

// Lock marks the VM as protected from destructive operations (delete
// will refuse; power ops still allowed). Requires an ownership row —
// admin must claim an adopted VM before locking.
func (h *VMHandler) Lock(w http.ResponseWriter, r *http.Request) { h.setLocked(w, r, true) }

// Unlock clears the lock flag.
func (h *VMHandler) Unlock(w http.ResponseWriter, r *http.Request) { h.setLocked(w, r, false) }

func (h *VMHandler) setLocked(w http.ResponseWriter, r *http.Request, locked bool) {
	u := auth.UserFromCtx(r.Context())
	uuid := chi.URLParam(r, "uuid")

	own, err := h.requireVMAccess(r.Context(), u, uuid)
	if err != nil {
		h.writeActionResult(w, lockAction(locked), uuid, err)
		return
	}
	if own == nil {
		// Admin on an adopted (unclaimed) VM — there's no row to update.
		writeError(w, "VM must be claimed before it can be locked", http.StatusConflict)
		return
	}
	if err := h.store.SetVMLocked(r.Context(), uuid, locked); err != nil {
		h.writeActionResult(w, lockAction(locked), uuid, err)
		return
	}
	slog.Info("vm lock change",
		"uuid", uuid, "locked", locked, "user_id", u.ID, "is_admin", u.IsAdmin)
	w.WriteHeader(http.StatusNoContent)
}

func lockAction(locked bool) string {
	if locked {
		return "lock"
	}
	return "unlock"
}
