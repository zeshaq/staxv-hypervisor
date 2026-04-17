// Package webui embeds the built React frontend and serves it over HTTP
// with SPA fallback (unknown paths serve index.html so client-side
// routing works).
//
// Build flow:
//
//	make frontend  # npm install && npm run build && copy dist → internal/webui/dist/
//	go build ...   # embed directive below picks up the copied dist/
//
// Fresh clones see only dist/.gitkeep; the Go binary builds but serves a
// friendly placeholder until `make frontend` runs.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// Handler returns an http.Handler that:
//   - serves files from the embedded dist/ when they exist
//   - falls back to index.html for any unknown path (SPA client-side routing)
//   - returns a placeholder message if dist/ is empty (frontend not built yet)
//
// Mount it LAST on your router — after /api/* — so it catches everything
// the API doesn't.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return placeholder("webui: fs.Sub failed: " + err.Error())
	}

	// Check if the frontend has actually been built (index.html present).
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return placeholder(
			"staxv-hypervisor is running, but the web UI hasn't been built yet.\n" +
				"Run `make frontend` to build it, then rebuild the Go binary.\n",
		)
	}

	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Don't SPA-fallback API paths — an unknown /api/... should 404
		// (honest "this endpoint doesn't exist") rather than quietly
		// returning index.html and confusing clients that expected JSON.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		// Strip leading slash for fs lookups.
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// If the file exists in dist/, serve it directly. Otherwise
		// hand back index.html so React Router can take over on the
		// client side (deep-link refresh works).
		if _, err := fs.Stat(sub, path); err != nil {
			r = cloneWithPath(r, "/")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func cloneWithPath(r *http.Request, newPath string) *http.Request {
	r2 := r.Clone(r.Context())
	r2.URL.Path = newPath
	return r2
}

func placeholder(msg string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte(msg))
	})
}
