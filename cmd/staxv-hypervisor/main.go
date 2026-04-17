// Command staxv-hypervisor is the per-node hypervisor agent.
//
// It is invoked with a subcommand:
//
//	staxv-hypervisor serve     — run the HTTP server (and later, gRPC)
//	staxv-hypervisor useradd   — create a staxv user (DB stub — see note below)
//	staxv-hypervisor userdel   — remove a staxv user
//	staxv-hypervisor migrate   — run SQLite migrations (no-op if up to date)
//	staxv-hypervisor version   — print version and exit
//
// Most of the real logic lives in internal/ and pkg/ packages. Keep
// this file focused on wiring.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"os/user"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/zeshaq/staxv-hypervisor/internal/config"
	"github.com/zeshaq/staxv-hypervisor/internal/db"
	"github.com/zeshaq/staxv-hypervisor/internal/handlers"
	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
	"golang.org/x/term"
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
		cmdUseradd(args)
	case "userdel":
		cmdNotImplemented("userdel", "see issue #33 multi-tenancy — soft delete + --purge")
	case "migrate":
		cmdMigrate(args)
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
  serve      Run the HTTP server
  useradd    Create a staxv user (stub — DB only, no Linux account yet)
  userdel    Remove a staxv user (not yet implemented)
  migrate    Apply pending SQLite migrations
  version    Print version
  help       Show this help

Use "staxv-hypervisor <command> -h" for command-specific flags.

Design docs: .claude/memory/
Issues:      https://github.com/zeshaq/staxv-hypervisor/issues
`)
}

func cmdNotImplemented(name, hint string) {
	fmt.Fprintf(os.Stderr, "%s: not yet implemented — %s\n", name, hint)
	os.Exit(2)
}

// -----------------------------------------------------------------------
// serve
// -----------------------------------------------------------------------

func cmdServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	configPath := fs.String("config", "/etc/staxv-hypervisor/config.toml", "path to TOML config file")
	addrOverride := fs.String("addr", "", "override [server].addr from config (e.g. :5001)")
	_ = fs.Parse(args)

	cfg := mustLoadConfig(*configPath)
	if *addrOverride != "" {
		cfg.Server.Addr = *addrOverride
	}
	initLogger(cfg.Log.Level)

	slog.Info("starting",
		"component", "staxv-hypervisor",
		"version", version,
		"addr", cfg.Server.Addr,
		"config", *configPath,
		"db", cfg.DB.Path,
		"pid", os.Getpid(),
	)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := db.Open(ctx, cfg.DB.Path)
	if err != nil {
		slog.Error("open db", "err", err)
		os.Exit(1)
	}
	defer store.Close()

	secret, err := auth.LoadOrCreateSecret(cfg.Auth.SecretPath)
	if err != nil {
		slog.Error("load/create jwt secret", "err", err, "path", cfg.Auth.SecretPath)
		os.Exit(1)
	}
	signer := auth.NewSigner(secret, cfg.Auth.TTL)
	authMW := auth.Middleware(signer, store)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// Public
	r.Get("/healthz", healthzHandler)
	r.Get("/", rootHandler)

	// Auth — login/logout public, /me gated by authMW (attached inside Mount)
	authH := handlers.NewAuthHandler(store, signer, cfg.Server.Secure)
	authH.Mount(r, authMW)

	srv := &http.Server{
		Addr:              cfg.Server.Addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Server.Addr)
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

func healthzHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok","version":"` + version + `"}` + "\n"))
}

func rootHandler(w http.ResponseWriter, _ *http.Request) {
	_, _ = w.Write([]byte("staxv-hypervisor " + version + "\n\n" +
		"Try:\n" +
		"  GET  /healthz\n" +
		"  POST /api/auth/login\n" +
		"  GET  /api/auth/me         (requires cookie)\n" +
		"  POST /api/auth/logout\n"))
}

// -----------------------------------------------------------------------
// useradd (STUB — DB only)
// -----------------------------------------------------------------------

// cmdUseradd creates a users row with a hashed password. It does NOT
// create a Linux account, a home dir, or a libvirt storage pool — those
// steps belong to internal/provision/ and land with the multi-tenancy
// epic (#33).
//
// Until then, this is enough to bootstrap a test admin:
//
//	$ sudo ./staxv-hypervisor useradd --username admin --admin
//	password: ****
//
// The inserted row has unix_uid = the caller's own UID if we can detect
// it (so the app running as that user can touch files there), else 0.
// This is a TEST-ONLY hack — the real flow will assign a proper UID in
// the UID_MIN=20000 range via Linux `useradd`.
func cmdUseradd(args []string) {
	fs := flag.NewFlagSet("useradd", flag.ExitOnError)
	configPath := fs.String("config", "/etc/staxv-hypervisor/config.toml", "path to TOML config file")
	username := fs.String("username", "", "username (required)")
	unixName := fs.String("unix-username", "", "Linux account name (default: same as --username)")
	uidStr := fs.String("uid", "", "UID (default: current user's UID)")
	homePath := fs.String("home", "", "home path (default: /home/<unix-username>)")
	admin := fs.Bool("admin", false, "grant admin privileges")
	_ = fs.Parse(args)

	if *username == "" {
		fmt.Fprintln(os.Stderr, "useradd: --username is required")
		os.Exit(2)
	}
	if *unixName == "" {
		*unixName = *username
	}
	uid, err := resolveUID(*uidStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "useradd: %v\n", err)
		os.Exit(2)
	}
	if *homePath == "" {
		*homePath = "/home/" + *unixName
	}

	password := promptPassword()

	cfg := mustLoadConfig(*configPath)
	initLogger(cfg.Log.Level)

	ctx := context.Background()
	store, err := db.Open(ctx, cfg.DB.Path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "useradd: open db: %v\n", err)
		os.Exit(1)
	}
	defer store.Close()

	u, err := store.CreateUser(ctx, db.CreateUserArgs{
		Username:     *username,
		Password:     password,
		UnixUsername: *unixName,
		UnixUID:      uid,
		HomePath:     *homePath,
		StaxvDir:     *homePath + "/.staxv",
		IsAdmin:      *admin,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "useradd: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("created user %q (id=%d, uid=%d, admin=%t)\n",
		u.Username, u.ID, u.UnixUID, u.IsAdmin)
	fmt.Println()
	fmt.Println("NOTE: this is the STUB useradd. No Linux account, no storage pool, no ACL.")
	fmt.Println("      The full provisioning flow lands with multi-tenancy (#33).")
}

func resolveUID(s string) (int, error) {
	if s != "" {
		n, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("--uid: %w", err)
		}
		return n, nil
	}
	u, err := user.Current()
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(u.Uid)
}

func promptPassword() string {
	fmt.Fprint(os.Stderr, "password: ")
	b, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read password: %v\n", err)
		os.Exit(1)
	}
	pw := strings.TrimSpace(string(b))
	if pw == "" {
		fmt.Fprintln(os.Stderr, "password cannot be empty")
		os.Exit(2)
	}
	return pw
}

// -----------------------------------------------------------------------
// migrate
// -----------------------------------------------------------------------

func cmdMigrate(args []string) {
	fs := flag.NewFlagSet("migrate", flag.ExitOnError)
	configPath := fs.String("config", "/etc/staxv-hypervisor/config.toml", "path to TOML config file")
	_ = fs.Parse(args)

	cfg := mustLoadConfig(*configPath)
	initLogger(cfg.Log.Level)

	ctx := context.Background()
	store, err := db.Open(ctx, cfg.DB.Path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
	defer store.Close()
	fmt.Println("migrations up to date")
}

// -----------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------

func mustLoadConfig(path string) *config.Config {
	cfg, err := config.Load(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	return cfg
}

func initLogger(level string) {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(strings.ToUpper(level))); err != nil {
		lvl = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: lvl,
	})))
}
