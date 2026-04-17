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
	"bufio"
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
	"github.com/zeshaq/staxv-hypervisor/internal/webui"
	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
	"github.com/zeshaq/staxv-hypervisor/pkg/pamauth"
	"github.com/zeshaq/staxv-hypervisor/pkg/secrets"
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

	// Pick the credential verifier based on [auth] backend config.
	// - "db"  (default): *db.DB's bcrypt Verify method
	// - "pam": shell out to pamtester against the host's PAM stack
	var verifier auth.CredentialVerifier
	switch cfg.Auth.Backend {
	case "db":
		verifier = store
	case "pam":
		verifier = pamauth.NewVerifier(cfg.Auth.PAMService, store)
	default:
		slog.Error("unknown [auth] backend", "backend", cfg.Auth.Backend, "valid", "db, pam")
		os.Exit(1)
	}
	slog.Info("auth backend", "backend", cfg.Auth.Backend, "pam_service", cfg.Auth.PAMService)

	// Settings at-rest encryption key.
	encKey, err := secrets.LoadOrCreateKey(cfg.Secrets.KeyPath)
	if err != nil {
		slog.Error("load/create settings key", "err", err, "path", cfg.Secrets.KeyPath)
		os.Exit(1)
	}
	aead, err := secrets.NewAEAD(encKey)
	if err != nil {
		slog.Error("init AEAD", "err", err)
		os.Exit(1)
	}
	settingsStore := db.NewSettingsStore(store, aead)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// Public API
	r.Get("/healthz", healthzHandler)

	// Auth — login/logout public, /me gated by authMW (attached inside Mount)
	authH := handlers.NewAuthHandler(verifier, signer, cfg.Server.Secure)
	authH.Mount(r, authMW)

	// Settings — all routes gated.
	settingsH := handlers.NewSettingsHandler(settingsStore)
	settingsH.Mount(r, authMW)

	// Host info — authenticated users only.
	hostH := handlers.NewHostHandler()
	hostH.Mount(r, authMW)

	// Web UI — mounted LAST so it catches everything unmatched above.
	// Serves the embedded React app with SPA fallback (unknown paths →
	// index.html so React Router handles deep links).
	r.Handle("/*", webui.Handler())

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

// rootHandler removed — internal/webui now serves / (React SPA).

// -----------------------------------------------------------------------
// useradd
// -----------------------------------------------------------------------

// cmdUseradd creates a staxv users row. Two modes:
//
// 1. DB mode (default)
//      sudo ./staxv-hypervisor useradd --username admin --admin
//      password: ****
//    Inserts a row with a bcrypt password hash. No Linux account is
//    created (that belongs to internal/provision/, epic #33). Suitable
//    for [auth] backend = "db".
//
// 2. --link-existing (for [auth] backend = "pam")
//      sudo ./staxv-hypervisor useradd --username ze --link-existing
//    Requires the Linux account to already exist. Reads its real UID
//    and home directory from /etc/passwd. Stores NO password — auth
//    will verify against the host's /etc/shadow via PAM.
//
// Linux account creation, home-dir setup, libvirt storage pool, and
// ACLs are all internal/provision/ work (not yet implemented).
func cmdUseradd(args []string) {
	fs := flag.NewFlagSet("useradd", flag.ExitOnError)
	configPath := fs.String("config", "/etc/staxv-hypervisor/config.toml", "path to TOML config file")
	username := fs.String("username", "", "username (required)")
	unixName := fs.String("unix-username", "", "Linux account name (default: same as --username)")
	uidStr := fs.String("uid", "", "UID (default: current user's UID, or the Linux user's UID when --link-existing)")
	homePath := fs.String("home", "", "home path (default: /home/<unix-username>, or the Linux user's home when --link-existing)")
	admin := fs.Bool("admin", false, "grant admin privileges")
	linkExisting := fs.Bool("link-existing", false, "link to an existing Linux account (for PAM backend; skips password prompt)")
	_ = fs.Parse(args)

	if *username == "" {
		fmt.Fprintln(os.Stderr, "useradd: --username is required")
		os.Exit(2)
	}
	if *unixName == "" {
		*unixName = *username
	}

	var (
		uid      int
		password string
		adopted  bool
		err      error
	)

	if *linkExisting {
		// Require the Linux account to exist. Pull its real UID and home
		// from /etc/passwd so what we store matches reality.
		lu, err := user.Lookup(*unixName)
		if err != nil {
			fmt.Fprintf(os.Stderr, "useradd: --link-existing: Linux account %q not found: %v\n", *unixName, err)
			os.Exit(2)
		}
		n, err := strconv.Atoi(lu.Uid)
		if err != nil {
			fmt.Fprintf(os.Stderr, "useradd: Linux UID %q not numeric: %v\n", lu.Uid, err)
			os.Exit(1)
		}
		uid = n
		if *homePath == "" {
			*homePath = lu.HomeDir
		}
		if *uidStr != "" {
			override, err := strconv.Atoi(*uidStr)
			if err != nil {
				fmt.Fprintf(os.Stderr, "useradd: --uid: %v\n", err)
				os.Exit(2)
			}
			if override != n {
				fmt.Fprintf(os.Stderr, "useradd: --uid=%d does not match Linux %s UID=%d; remove --uid or fix\n", override, *unixName, n)
				os.Exit(2)
			}
		}
		adopted = true
		// No password prompt — PAM will verify against /etc/shadow.
	} else {
		uid, err = resolveUID(*uidStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "useradd: %v\n", err)
			os.Exit(2)
		}
		if *homePath == "" {
			*homePath = "/home/" + *unixName
		}
		password = promptPassword()
	}

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
		Password:     password, // "" when --link-existing; PAM verifies instead
		UnixUsername: *unixName,
		UnixUID:      uid,
		HomePath:     *homePath,
		StaxvDir:     *homePath + "/.staxv",
		IsAdmin:      *admin,
		Adopted:      adopted,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "useradd: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("created user %q (id=%d, uid=%d, admin=%t, adopted=%t)\n",
		u.Username, u.ID, u.UnixUID, u.IsAdmin, u.Adopted)
	if *linkExisting {
		fmt.Printf("  → linked to Linux account %q; authenticates via PAM (requires [auth] backend=\"pam\")\n", u.UnixUsername)
	} else {
		fmt.Println()
		fmt.Println("NOTE: Linux account was NOT created — internal/provision/ work is still pending (#33).")
		fmt.Println("      Use --link-existing to link against a Linux user you've already created.")
	}
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

// promptPassword reads a password from stdin. If stdin is a terminal,
// reads it invisibly via term.ReadPassword. If stdin is a pipe (scripts,
// CI), reads a single line of plaintext — no prompt printed to avoid
// polluting captured stdout.
func promptPassword() string {
	fd := int(os.Stdin.Fd())
	var raw []byte
	var err error
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "password: ")
		raw, err = term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
	} else {
		// Non-TTY: read one line as-is. Supports `echo pw | staxv-hypervisor useradd ...`
		reader := bufio.NewReader(os.Stdin)
		var line string
		line, err = reader.ReadString('\n')
		raw = []byte(strings.TrimRight(line, "\r\n"))
	}
	if err != nil && err.Error() != "EOF" {
		fmt.Fprintf(os.Stderr, "read password: %v\n", err)
		os.Exit(1)
	}
	pw := strings.TrimSpace(string(raw))
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
