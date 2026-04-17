package pamauth

import (
	"context"
	"errors"
	"os/exec"
	"testing"
	"time"

	"github.com/zeshaq/staxv-hypervisor/pkg/auth"
)

// fakeStore implements UserStore for tests.
type fakeStore struct {
	users map[string]*auth.User
	err   error
}

func (f *fakeStore) GetUserByUsername(_ context.Context, u string) (*auth.User, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.users[u], nil
}

// fakeCmd returns a CmdFunc that runs `/bin/sh -c` with a script that
// reads a line from stdin and exits 0 iff it equals `expected`, else 2.
// This lets us verify the password is piped correctly AND that we
// respect pamtester's exit code.
func fakeCmd(expected string) CmdFunc {
	return func(ctx context.Context, _service, _user string) *exec.Cmd {
		script := `read pw; [ "$pw" = "` + expected + `" ]`
		return exec.CommandContext(ctx, "/bin/sh", "-c", script)
	}
}

// notInstalledCmd simulates pamtester being missing — the command fails
// to start at all (not an *exec.ExitError, triggers the "loud log" path).
func notInstalledCmd() CmdFunc {
	return func(ctx context.Context, _service, _user string) *exec.Cmd {
		return exec.CommandContext(ctx, "/definitely/not/a/real/path/pamtester")
	}
}

func alice() *auth.User {
	return &auth.User{ID: 1, Username: "alice", UnixUsername: "alice"}
}

func storeWithAlice() UserStore {
	return &fakeStore{users: map[string]*auth.User{"alice": alice()}}
}

func TestVerifyHappyPath(t *testing.T) {
	v := NewVerifier("test", storeWithAlice()).WithCmd(fakeCmd("correct"))

	u, err := v.Verify(context.Background(), "alice", "correct")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if u == nil || u.Username != "alice" {
		t.Errorf("got user %+v, want alice", u)
	}
}

func TestVerifyWrongPassword(t *testing.T) {
	v := NewVerifier("test", storeWithAlice()).WithCmd(fakeCmd("correct"))

	_, err := v.Verify(context.Background(), "alice", "WRONG")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("got %v, want ErrInvalidCredentials", err)
	}
}

func TestVerifyUserMissingFromStaxv(t *testing.T) {
	// ghost has no row in staxv's users table, even if PAM would accept
	// their Linux password. Must fail with ErrInvalidCredentials and
	// must NOT invoke pamtester (would be user enumeration via timing).
	called := false
	cmd := func(ctx context.Context, _, _ string) *exec.Cmd {
		called = true
		return exec.CommandContext(ctx, "true")
	}
	v := NewVerifier("test", &fakeStore{users: map[string]*auth.User{}}).WithCmd(cmd)

	_, err := v.Verify(context.Background(), "ghost", "anything")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("got %v, want ErrInvalidCredentials", err)
	}
	if called {
		t.Errorf("should not have invoked pamtester for a non-existent staxv user")
	}
}

func TestVerifyDisabledUser(t *testing.T) {
	now := time.Now()
	u := &auth.User{ID: 1, Username: "alice", UnixUsername: "alice", DisabledAt: &now}
	store := &fakeStore{users: map[string]*auth.User{"alice": u}}
	v := NewVerifier("test", store).WithCmd(fakeCmd("correct"))

	_, err := v.Verify(context.Background(), "alice", "correct")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("got %v, want ErrInvalidCredentials", err)
	}
}

func TestVerifyPamtesterMissing(t *testing.T) {
	v := NewVerifier("test", storeWithAlice()).WithCmd(notInstalledCmd())

	_, err := v.Verify(context.Background(), "alice", "anything")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("got %v, want ErrInvalidCredentials (even when pamtester is missing)", err)
	}
}

func TestVerifyContextTimeout(t *testing.T) {
	// pamtester hangs — our per-call timeout fires. Still collapse to
	// ErrInvalidCredentials (don't leak deadline info to clients).
	hang := func(ctx context.Context, _, _ string) *exec.Cmd {
		return exec.CommandContext(ctx, "sleep", "30")
	}
	v := NewVerifier("test", storeWithAlice()).WithCmd(hang).WithTimeout(100 * time.Millisecond)

	start := time.Now()
	_, err := v.Verify(context.Background(), "alice", "pw")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("got %v, want ErrInvalidCredentials", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("took %s, expected timeout near 100ms", elapsed)
	}
}
