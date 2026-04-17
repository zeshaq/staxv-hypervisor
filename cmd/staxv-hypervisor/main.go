// Command staxv-hypervisor is the per-node hypervisor agent.
//
// It is invoked with a subcommand:
//
//	staxv-hypervisor serve     — run the HTTP server (and later, gRPC)
//	staxv-hypervisor useradd   — create a staxv user (requires root)
//	staxv-hypervisor userdel   — remove a staxv user (requires root)
//	staxv-hypervisor migrate   — run SQLite migrations
//	staxv-hypervisor version   — print version and exit
//
// Most of the real logic lives in internal/ and pkg/ packages that this
// binary wires together. Keep this file small.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// version is set at build time via -ldflags "-X main.version=..."
var version = "dev"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	cmd, args := os.Args[1], os.Args[2:]

	switch cmd {
	case "serve":
		cmdServe(args)
	case "useradd":
		cmdNotImplemented("useradd", "see issue #33 multi-tenancy — create staxv user with Linux account provisioning")
	case "userdel":
		cmdNotImplemented("userdel", "see issue #33 — soft-disable; --purge requires double confirmation")
	case "migrate":
		cmdNotImplemented("migrate", "see issue #1 scaffold — SQLite schema migrations")
	case "version", "-v", "--version":
		fmt.Println("staxv-hypervisor", version)
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %q\n\n", cmd)
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `staxv-hypervisor — per-node hypervisor agent

Usage:
  staxv-hypervisor <command> [flags]

Commands:
  serve      Run the HTTP server (and later, gRPC)
  useradd    Create a staxv user (requires root)
  userdel    Remove a staxv user (requires root; --purge for hard delete)
  migrate    Run SQLite migrations
  version    Print version
  help       Show this help

Use "staxv-hypervisor <command> -h" for command-specific flags.

Design docs: .claude/memory/
Issue tracker: https://github.com/zeshaq/staxv-hypervisor/issues
`)
}

func cmdNotImplemented(name, hint string) {
	fmt.Fprintf(os.Stderr, "%s: not yet implemented — %s\n", name, hint)
	os.Exit(2)
}

func cmdServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", ":5001", "HTTP listen address (coexists with vm-manager on :5000)")
	configPath := fs.String("config", "/etc/staxv-hypervisor/config.toml", "path to TOML config file")
	_ = fs.Parse(args)

	// Structured JSON logs by default — easy to tail, easy to ship.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	slog.Info("starting",
		"component", "staxv-hypervisor",
		"version", version,
		"addr", *addr,
		"config", *configPath,
		"pid", os.Getpid(),
	)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// Liveness. Kept dumb — doesn't touch DB or libvirt.
	// Real readiness check (DB pingable, libvirt connected) comes in its own handler.
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","version":"` + version + `"}` + "\n"))
	})

	// Placeholder root — replace with the embedded React app once the frontend integrates.
	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("staxv-hypervisor " + version + " — scaffolding. See /healthz.\n"))
	})

	srv := &http.Server{
		Addr:              *addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Graceful shutdown on SIGINT/SIGTERM — matters for air, matters for systemd.
	// Without this, air's kill_delay can leave SQLite locks and held ports.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", *addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		slog.Error("listener exited unexpectedly", "err", err)
		os.Exit(1)
	case <-ctx.Done():
		slog.Info("shutdown signal received, draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
		os.Exit(1)
	}
	slog.Info("shutdown complete")
}
