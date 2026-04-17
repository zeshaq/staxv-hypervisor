// Package pamauth verifies usernames + passwords against the host's
// PAM stack by invoking pamtester(1) as a child process. This keeps
// staxv-hypervisor cgo-free (libpam's Go bindings require cgo).
//
// Host setup (Ubuntu):
//
//	apt install pamtester
//	sudo tee /etc/pam.d/staxv-hypervisor <<EOF
//	@include common-auth
//	@include common-account
//	EOF
//
// The @include lines pull in Ubuntu's standard pam_unix + pam_faillock
// + pam_pwquality configuration — lockout and complexity rules are
// handled by the distro's PAM stack without us reinventing them.
//
// A staxv user MUST exist in the users table before this verifier will
// accept them (created via `staxv-hypervisor useradd --link-existing`).
// We never auto-provision on first PAM success — that would let every
// Linux account on the host into the web UI.
package pamauth

import (
	"context"
	"errors"
	"log/slog"
	"os/exec"
	"strings"
	"time"

	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
)

// DefaultService is the PAM service name staxv expects at /etc/pam.d/<name>.
const DefaultService = "staxv-hypervisor"

// defaultTimeout is the ceiling for a single pamtester invocation.
// A well-configured pam_unix returns in <100ms; lock contention or a
// hung NSS lookup (LDAP, SSSD) can stretch it. 10s is generous.
const defaultTimeout = 10 * time.Second

// UserStore is the minimal DB surface: look up the staxv user by its
// staxv username. We use the returned User.UnixUsername to address PAM.
type UserStore interface {
	GetUserByUsername(ctx context.Context, username string) (*auth.User, error)
}

// CmdFunc builds the exec.Cmd that runs pamtester. Exported so tests
// can swap in a fake — production code always uses defaultCmd.
type CmdFunc func(ctx context.Context, service, unixUsername string) *exec.Cmd

// Verifier satisfies auth.CredentialVerifier.
type Verifier struct {
	service string
	store   UserStore
	cmd     CmdFunc
	timeout time.Duration
}

// NewVerifier wires a Verifier against a UserStore (normally *db.DB).
// Use DefaultService unless you genuinely need a custom PAM service
// name (and have written /etc/pam.d/<name> to match).
func NewVerifier(service string, store UserStore) *Verifier {
	return &Verifier{
		service: service,
		store:   store,
		cmd:     defaultCmd,
		timeout: defaultTimeout,
	}
}

// WithCmd swaps the pamtester command builder. Intended for tests.
func (v *Verifier) WithCmd(fn CmdFunc) *Verifier { v.cmd = fn; return v }

// WithTimeout overrides the per-call timeout.
func (v *Verifier) WithTimeout(d time.Duration) *Verifier { v.timeout = d; return v }

func defaultCmd(ctx context.Context, service, user string) *exec.Cmd {
	// pamtester <service> <user> authenticate
	// pamtester reads the password from stdin whenever the PAM conv
	// callback prompts for it (pam_unix always does).
	return exec.CommandContext(ctx, "pamtester", service, user, "authenticate")
}

// Verify satisfies auth.CredentialVerifier.
//
// Flow:
//  1. Look up the staxv user (no such user → ErrInvalidCredentials,
//     no existence leak).
//  2. Refuse disabled accounts (DisabledAt set).
//  3. Shell out to pamtester with the user's unix_username + stdin
//     password. Any non-zero exit → ErrInvalidCredentials.
//  4. If pamtester itself is missing (not an ExitError), log loudly —
//     the deployment is broken and the admin needs to know — but still
//     return ErrInvalidCredentials to the client.
func (v *Verifier) Verify(ctx context.Context, username, password string) (*auth.User, error) {
	ctx, cancel := context.WithTimeout(ctx, v.timeout)
	defer cancel()

	u, err := v.store.GetUserByUsername(ctx, username)
	if err != nil || u == nil || u.Disabled() {
		return nil, auth.ErrInvalidCredentials
	}

	cmd := v.cmd(ctx, v.service, u.UnixUsername)
	cmd.Stdin = strings.NewReader(password + "\n")
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			slog.Error("pamtester not available — PAM backend is broken",
				"err", err,
				"service", v.service,
				"hint", "apt install pamtester && ensure /etc/pam.d/"+v.service+" exists",
			)
		}
		return nil, auth.ErrInvalidCredentials
	}
	return u, nil
}
