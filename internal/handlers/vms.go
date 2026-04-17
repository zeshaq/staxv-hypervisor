package handlers

import (
	"context"
	"encoding/json"
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
	GetDomainInfo(uuid string) (lvpkg.DomainSummary, error)
	GetDomainDetail(uuid string) (*lvpkg.DomainDetail, error)
	StartDomain(uuid string) error
	ShutdownDomain(uuid string) error
	ForceStopDomain(uuid string) error
	RebootDomain(uuid string) error
	DeleteDomain(uuid string, wipeDisks bool) error
	CreateDomain(ctx context.Context, spec lvpkg.CreateSpec) (*lvpkg.CreatedDomain, error)
	AttachISO(uuid, isoPath string) error
	DetachISO(uuid string) error
}

// VMISOStore is the ISO-lookup surface the VMs handler needs to
// validate attach-iso requests. *db.DB satisfies it.
type VMISOStore interface {
	GetISO(ctx context.Context, id int64) (*db.ISO, error)
}

// VMOwnershipStore is the subset of *db.DB the handler uses.
type VMOwnershipStore interface {
	ListVMOwnershipsForUser(ctx context.Context, userID int64) ([]db.VMOwnership, error)
	ListAllVMOwnerships(ctx context.Context) ([]db.VMOwnership, error)
	GetVMOwnership(ctx context.Context, uuid string) (*db.VMOwnership, error)
	SetVMLocked(ctx context.Context, uuid string, locked bool) error
	ClaimVM(ctx context.Context, uuid, name string, ownerID int64) (*db.VMOwnership, error)
	ReleaseVM(ctx context.Context, uuid string) error
}

// VMHandler serves /api/vms. Full CRUD + power ops + lock/unlock +
// claim/release + attach-iso / detach-iso.
type VMHandler struct {
	libvirt LibvirtClient
	store   VMOwnershipStore
	isos    VMISOStore
}

func NewVMHandler(libvirt LibvirtClient, store VMOwnershipStore, isos VMISOStore) *VMHandler {
	return &VMHandler{libvirt: libvirt, store: store, isos: isos}
}

// Mount attaches /api/vms routes, all gated by authMW.
func (h *VMHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/vms", func(r chi.Router) {
		r.Use(authMW)
		r.Get("/", h.List)
		r.Get("/{uuid}", h.Get)
		r.Post("/", h.Create)
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
		// Claim / Release — admin-only. Used to adopt a pre-existing
		// libvirt VM into staxv's ownership model, or to let one go.
		r.Post("/{uuid}/claim", h.Claim)
		r.Post("/{uuid}/release", h.Release)
		// Delete — owner or admin, refused on locked VMs (→ 409).
		// Removes the VM from libvirt (destroy if running + undefine
		// with NVRAM+ManagedSave+Snapshots flags), wipes its qcow2
		// disks, and drops our ownership row.
		r.Delete("/{uuid}", h.Delete)
		// CD-ROM media — insert/eject an ISO at the VM's CDROM slot.
		// Live change if VM is running; persistent in any case.
		r.Post("/{uuid}/attach-iso", h.AttachISO)
		r.Post("/{uuid}/detach-iso", h.DetachISO)
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

// vmDetailResponse is the wire shape for GET /api/vms/{uuid}. It
// combines libvirt's DomainDetail (specs, disks, NICs, graphics) with
// staxv's ownership state (owner_id, locked, adopted). The frontend
// detail page consumes this as a single source of truth.
type vmDetailResponse struct {
	*lvpkg.DomainDetail
	Locked  bool   `json:"locked"`
	OwnerID *int64 `json:"owner_id,omitempty"`
	Adopted bool   `json:"adopted,omitempty"` // true = libvirt-visible but no staxv ownership row
}

// Get returns one VM's full detail. Same visibility rules as List:
// regular users see only VMs they own; admins see everything, with an
// `adopted=true` flag on libvirt VMs staxv hasn't claimed yet.
//
// Error mapping:
//   - Unknown UUID (or owned-by-someone-else, regular user) → 404.
//     Non-admins never distinguish "doesn't exist" from "not yours" —
//     matches the List+requireVMAccess pattern.
//   - libvirt unreachable → 503.
func (h *VMHandler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		writeError(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	uuid := chi.URLParam(r, "uuid")

	own, err := h.requireVMAccess(r.Context(), u, uuid)
	if err != nil {
		// Same mapping as writeActionResult — ErrNotFound → 404, other
		// errors → 500 via writeActionResult. Inline the 404 path since
		// writeActionResult writes 204 on nil which we don't want here.
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, "not found", http.StatusNotFound)
			return
		}
		slog.Error("vms get: access check", "err", err, "uuid", uuid)
		writeError(w, "lookup failed", http.StatusInternalServerError)
		return
	}

	detail, err := h.libvirt.GetDomainDetail(uuid)
	if err != nil {
		if errors.Is(err, lvpkg.ErrDomainNotFound) {
			// Ownership row existed (requireVMAccess returned own != nil)
			// but libvirt doesn't know this UUID — admin likely deleted
			// it via virsh out-of-band. Drop the orphan row and 404 to
			// match list behaviour.
			if own != nil {
				_ = h.store.ReleaseVM(r.Context(), uuid)
			}
			writeError(w, "not found", http.StatusNotFound)
			return
		}
		slog.Error("vms get: libvirt", "err", err, "uuid", uuid)
		writeError(w, "libvirt unavailable", http.StatusServiceUnavailable)
		return
	}

	resp := vmDetailResponse{DomainDetail: detail}
	switch {
	case own != nil:
		resp.Locked = own.Locked
		ownerID := own.OwnerID
		resp.OwnerID = &ownerID
	default:
		// Admin viewing an unclaimed libvirt VM — surface the adopted
		// flag so the UI can offer a Claim button identical to the
		// list page's behaviour.
		resp.Adopted = true
	}
	writeJSON(w, http.StatusOK, resp)
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

// -----------------------------------------------------------------------
// Claim / Release — admin-only adoption of libvirt domains
// -----------------------------------------------------------------------

type claimRequest struct {
	// OwnerID: whom to assign. Omit / null → claim for the caller.
	OwnerID *int64 `json:"owner_id,omitempty"`
}

// Claim writes an ownership row for a libvirt domain that staxv isn't
// tracking yet (adopted=true in List output). Admin-only — a random
// user auto-claiming would leak the host's entire VM table to whoever
// logs in first.
func (h *VMHandler) Claim(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if !u.IsAdmin {
		writeError(w, "admin only", http.StatusForbidden)
		return
	}
	uuid := chi.URLParam(r, "uuid")

	// Parse body (optional). Empty body = claim for self.
	req := claimRequest{}
	if r.ContentLength > 0 {
		// Tolerate the occasional trailing newline or empty object.
		dec := json.NewDecoder(r.Body)
		if err := dec.Decode(&req); err != nil && err.Error() != "EOF" {
			writeError(w, "invalid request body", http.StatusBadRequest)
			return
		}
	}
	ownerID := u.ID
	if req.OwnerID != nil {
		ownerID = *req.OwnerID
	}

	// Reject if already claimed. Re-assignment = Release then Claim.
	if existing, err := h.store.GetVMOwnership(r.Context(), uuid); err == nil && existing != nil {
		writeError(w, "VM already has owner — release first", http.StatusConflict)
		return
	} else if err != nil && !errors.Is(err, db.ErrNotFound) {
		slog.Error("claim: db lookup", "err", err, "uuid", uuid)
		writeError(w, "db error", http.StatusInternalServerError)
		return
	}

	// Confirm the VM exists in libvirt, and grab its name for the new
	// ownership row (we store name as a denormalized cache so list /
	// search doesn't need to re-hit libvirt for every row).
	info, err := h.libvirt.GetDomainInfo(uuid)
	if err != nil {
		if errors.Is(err, lvpkg.ErrDomainNotFound) {
			writeError(w, "not found", http.StatusNotFound)
			return
		}
		slog.Error("claim: libvirt lookup", "err", err, "uuid", uuid)
		writeError(w, "libvirt unavailable", http.StatusServiceUnavailable)
		return
	}

	// Insert. SQLite FK will fail if ownerID doesn't reference a real
	// user — surface as 400 so the admin sees a clean message.
	own, err := h.store.ClaimVM(r.Context(), uuid, info.Name, ownerID)
	if err != nil {
		slog.Warn("claim: insert failed", "err", err, "uuid", uuid, "owner_id", ownerID)
		writeError(w, "claim failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	slog.Info("vm claimed",
		"uuid", uuid, "name", info.Name, "owner_id", ownerID,
		"claimed_by", u.ID, "is_admin", u.IsAdmin,
	)
	writeJSON(w, http.StatusOK, own)
}

// Delete destroys a VM and wipes its backing disks. Flow:
//   1. Authorize (owner or admin; 404 otherwise).
//   2. Refuse if locked (409).
//   3. Ask libvirt to destroy+undefine with the NVRAM etc. flag
//      bundle that vm-manager forgot to set (see memory/architecture.md
//      "libvirt domain delete" — the bug-we-must-not-repeat).
//   4. Drop the staxv ownership row. Order matters: libvirt first, so
//      that a libvirt failure doesn't leave us with an orphan DB row
//      pointing at a VM that still exists.
func (h *VMHandler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	uuid := chi.URLParam(r, "uuid")

	own, err := h.requireVMAccess(r.Context(), u, uuid)
	if err != nil {
		h.writeActionResult(w, "delete", uuid, err)
		return
	}
	if own != nil && own.Locked {
		writeError(w, "VM is locked; unlock before deleting", http.StatusConflict)
		return
	}

	if err := h.libvirt.DeleteDomain(uuid, true); err != nil {
		if errors.Is(err, lvpkg.ErrDomainNotFound) {
			// Libvirt doesn't know this VM — but we might still have
			// an orphan ownership row (e.g., admin deleted via virsh
			// out-of-band). Sweep the DB row either way.
			_ = h.store.ReleaseVM(r.Context(), uuid)
			writeError(w, "not found", http.StatusNotFound)
			return
		}
		slog.Warn("delete: libvirt", "err", err, "uuid", uuid)
		writeError(w, "delete failed: "+err.Error(), http.StatusBadRequest)
		return
	}
	// libvirt delete succeeded — clear our row. Release is idempotent,
	// so a no-op if the row didn't exist (adopted-VM admin delete).
	if err := h.store.ReleaseVM(r.Context(), uuid); err != nil {
		slog.Error("delete: release ownership row", "err", err, "uuid", uuid)
		// VM is gone from libvirt; DB row leak is cosmetic. Return
		// success so the UI refreshes — manual cleanup later if needed.
	}

	slog.Info("vm deleted",
		"uuid", uuid, "user_id", u.ID, "is_admin", u.IsAdmin,
		"had_ownership_row", own != nil,
	)
	w.WriteHeader(http.StatusNoContent)
}

// -----------------------------------------------------------------------
// CD-ROM / ISO attach-detach
// -----------------------------------------------------------------------

type attachISORequest struct {
	ISOID int64 `json:"iso_id"`
}

// AttachISO inserts an ISO from the library into the VM's CDROM slot.
// Requires VM ownership (or admin). ISO visibility: shared (owner_id
// NULL) or owned by the caller. Non-admin trying to attach another
// user's ISO → 404 (not "forbidden") to avoid leaking existence.
func (h *VMHandler) AttachISO(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	uuid := chi.URLParam(r, "uuid")

	if _, err := h.requireVMAccess(r.Context(), u, uuid); err != nil {
		h.writeActionResult(w, "attach-iso", uuid, err)
		return
	}

	var req attachISORequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid body (expected {iso_id: <n>})", http.StatusBadRequest)
		return
	}

	iso, err := h.isos.GetISO(r.Context(), req.ISOID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, "iso not found", http.StatusNotFound)
			return
		}
		slog.Error("attach-iso: lookup", "err", err, "iso_id", req.ISOID)
		writeError(w, "iso lookup failed", http.StatusInternalServerError)
		return
	}
	// Visibility: shared (owner_id NULL) OR owned by caller OR caller
	// is admin.
	if iso.OwnerID != nil && *iso.OwnerID != u.ID && !u.IsAdmin {
		writeError(w, "iso not found", http.StatusNotFound) // no existence leak
		return
	}

	if err := h.libvirt.AttachISO(uuid, iso.Path); err != nil {
		slog.Warn("attach-iso: libvirt", "err", err, "uuid", uuid, "iso", iso.Name)
		writeError(w, "attach failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	slog.Info("iso attached",
		"vm_uuid", uuid, "iso_id", iso.ID, "iso_name", iso.Name,
		"user_id", u.ID,
	)
	w.WriteHeader(http.StatusNoContent)
}

// DetachISO ejects whatever media is in the CDROM slot. No-op if
// already empty (libvirt doesn't error on "eject nothing").
func (h *VMHandler) DetachISO(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	uuid := chi.URLParam(r, "uuid")

	if _, err := h.requireVMAccess(r.Context(), u, uuid); err != nil {
		h.writeActionResult(w, "detach-iso", uuid, err)
		return
	}
	if err := h.libvirt.DetachISO(uuid); err != nil {
		slog.Warn("detach-iso: libvirt", "err", err, "uuid", uuid)
		writeError(w, "detach failed: "+err.Error(), http.StatusBadRequest)
		return
	}
	slog.Info("iso detached", "vm_uuid", uuid, "user_id", u.ID)
	w.WriteHeader(http.StatusNoContent)
}

// -----------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------

// createRequest matches the JSON the current CreateVM.jsx form sends:
//
//	{name, ram, cpu, host_cpu, disks, devices}
//
// `ram` is MiB (frontend convention). `cpu` is vCPU count. `disks` and
// `devices` are present but empty in the basic form — we honor empty
// and apply defaults (10 GB primary disk, default NAT NIC, etc.).
type createRequest struct {
	Name    string `json:"name"`
	RAM     int    `json:"ram"`      // MiB
	CPU     int    `json:"cpu"`      // vCPU count
	HostCPU bool   `json:"host_cpu"` // host-passthrough CPU mode
	// disks/devices: ignored for now — #8 disk mgmt and future edit
	// flows handle extras. v1 just provisions a single 10 GB qcow2.
	DiskGB int `json:"disk_gb,omitempty"` // optional override; 0 → 10
}

// Create provisions a new VM. Caller becomes the owner (staxv
// ownership row inserted). Does NOT auto-start the VM — operator
// clicks Start from the VM list after reviewing. That gap also gives
// us a natural place to attach an ISO before boot in a future edit
// flow.
//
// Quotas: not enforced here yet. #33 epic's quota-check work lands
// when we have real numbers to enforce against. Current behavior:
// accept any sane spec; document deferred work explicitly.
func (h *VMHandler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		writeError(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	diskGB := req.DiskGB
	if diskGB == 0 {
		diskGB = 10 // sensible default for a blank install; user can resize later
	}

	spec := lvpkg.CreateSpec{
		Name:     req.Name,
		VCPUs:    req.CPU,
		MemoryMB: req.RAM,
		HostCPU:  req.HostCPU,
		DiskGB:   diskGB,
		// PoolPath empty → lvpkg.DefaultPoolPath (/var/lib/libvirt/images).
		// Per-user pools (#33) land when internal/provision/ ships.
		OwnerID: u.ID,
	}

	created, err := h.libvirt.CreateDomain(r.Context(), spec)
	if err != nil {
		slog.Warn("vm create", "err", err, "name", req.Name, "user_id", u.ID)
		writeError(w, "create failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Insert ownership row. If this fails we leave the libvirt domain
	// in place — admin can Claim later. Shouldn't silently eat the
	// primary success (the VM really does exist), so just log.
	if _, err := h.store.ClaimVM(r.Context(), created.UUID, created.Name, u.ID); err != nil {
		slog.Error("vm create: claim ownership row", "err", err, "uuid", created.UUID)
	}

	slog.Info("vm created",
		"uuid", created.UUID, "name", created.Name,
		"vcpus", spec.VCPUs, "memory_mb", spec.MemoryMB, "disk_gb", diskGB,
		"user_id", u.ID, "disk_path", created.DiskPath,
	)

	// Frontend navigates to /vms/:uuid on success — response shape
	// just needs `uuid`. Return the full summary so future UX could
	// show a confirmation banner with the spec.
	writeJSON(w, http.StatusCreated, map[string]any{
		"uuid":      created.UUID,
		"name":      created.Name,
		"disk_path": created.DiskPath,
	})
}

// Release removes the ownership row, returning the VM to adopted/
// unclaimed status. Admin-only. Does NOT touch libvirt — the VM keeps
// running; only staxv's view of ownership changes.
func (h *VMHandler) Release(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if !u.IsAdmin {
		writeError(w, "admin only", http.StatusForbidden)
		return
	}
	uuid := chi.URLParam(r, "uuid")

	if err := h.store.ReleaseVM(r.Context(), uuid); err != nil {
		slog.Error("release: db", "err", err, "uuid", uuid)
		writeError(w, "release failed", http.StatusInternalServerError)
		return
	}
	slog.Info("vm released", "uuid", uuid, "released_by", u.ID)
	w.WriteHeader(http.StatusNoContent)
}
