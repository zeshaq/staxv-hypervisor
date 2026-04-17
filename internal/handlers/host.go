package handlers

import (
	"net/http"
	"os"
	"runtime"

	"github.com/go-chi/chi/v5"
)

// HostHandler serves /api/host — minimal info about the hypervisor host
// that the frontend Layout displays in the header.
//
// Anyone authenticated can read this. Sensitive host info (kernel
// versions, NIC MACs, etc.) lives behind more specific endpoints
// with scoped permissions.
type HostHandler struct{}

func NewHostHandler() *HostHandler { return &HostHandler{} }

func (h *HostHandler) Mount(r chi.Router, authMW func(http.Handler) http.Handler) {
	r.Route("/api/host", func(r chi.Router) {
		r.Use(authMW)
		r.Get("/", h.Get)
	})
}

type hostInfo struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
}

func (h *HostHandler) Get(w http.ResponseWriter, _ *http.Request) {
	name, _ := os.Hostname()
	writeJSON(w, http.StatusOK, hostInfo{
		Hostname: name,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
	})
}
