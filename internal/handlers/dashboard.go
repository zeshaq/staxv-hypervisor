package handlers

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/zeshaq/staxv-hypervisor/pkg/hostinfo"
)

// DashboardHandler serves /api/dashboard — host-level CPU, memory,
// disk, network, uptime, and top processes.
//
// Not admin-gated: host-wide utilization isn't sensitive in a
// homelab/small-team context. If that changes, wrap with
// auth.RequireAdmin inside Mount.
type DashboardHandler struct{}

func NewDashboardHandler() *DashboardHandler { return &DashboardHandler{} }

func (h *DashboardHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/dashboard", func(r chi.Router) {
		r.Use(authMW)
		r.Get("/", h.Get)
	})
}

// Get collects a host snapshot. The request context's deadline is
// honored — hostinfo.Collect will abort partial metrics if the client
// disconnects or the chi Timeout middleware fires.
func (h *DashboardHandler) Get(w http.ResponseWriter, r *http.Request) {
	snap, err := hostinfo.Collect(r.Context())
	if err != nil {
		slog.Error("dashboard collect", "err", err)
		writeError(w, "collect failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}
