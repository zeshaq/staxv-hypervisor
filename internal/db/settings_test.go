package db

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"testing"

	"github.com/zeshaq/staxv-hypervisor/pkg/secrets"
)

// newTestStore spins up an in-memory SQLite with migrations applied +
// a random AEAD key, and seeds users with ids 1 and 2 so FK constraints
// on settings.owner_id are satisfied.
func newTestStore(t *testing.T) *SettingsStore {
	t.Helper()
	ctx := context.Background()

	// modernc.org/sqlite supports `:memory:`. Each Open() yields a
	// fresh DB so tests don't interfere.
	db, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// Seed two users matching the IDs used by tests below. Settings
	// has a FK to users; without these, every INSERT would 787.
	for _, u := range []struct {
		id   int64
		name string
	}{
		{1, "alice"},
		{2, "bob"},
	} {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO users (id, username, password_hash, unix_username, unix_uid, home_path, staxv_dir)
			VALUES (?, ?, '', ?, ?, '/home/'||?, '/home/'||?||'/.staxv')
		`, u.id, u.name, u.name, u.id+10000, u.name, u.name); err != nil {
			t.Fatalf("seed user %s: %v", u.name, err)
		}
	}

	key := make([]byte, secrets.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand: %v", err)
	}
	aead, err := secrets.NewAEAD(key)
	if err != nil {
		t.Fatalf("aead: %v", err)
	}
	return NewSettingsStore(db, aead)
}

func ptr(i int64) *int64 { return &i }

func TestSettingsSetGetRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	if err := s.Set(ctx, ptr(1), "pull_secret", "{\"auths\":{}}"); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err := s.Get(ctx, ptr(1), "pull_secret")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Value != `{"auths":{}}` {
		t.Errorf("value mismatch: got %q", got.Value)
	}
	if got.Key != "pull_secret" {
		t.Errorf("key mismatch: got %q", got.Key)
	}
	if got.UpdatedAt.IsZero() {
		t.Errorf("UpdatedAt should be set")
	}
}

func TestSettingsOwnerIsolation(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Alice (id=1) and Bob (id=2) both store a key named "ssh_key"
	// with different values. Neither should see the other's value.
	if err := s.Set(ctx, ptr(1), "ssh_key", "alice-key"); err != nil {
		t.Fatalf("alice set: %v", err)
	}
	if err := s.Set(ctx, ptr(2), "ssh_key", "bob-key"); err != nil {
		t.Fatalf("bob set: %v", err)
	}

	aliceGet, _ := s.Get(ctx, ptr(1), "ssh_key")
	bobGet, _ := s.Get(ctx, ptr(2), "ssh_key")
	if aliceGet.Value != "alice-key" || bobGet.Value != "bob-key" {
		t.Errorf("owner isolation failed: alice=%q bob=%q", aliceGet.Value, bobGet.Value)
	}
}

func TestSettingsSystemVsUserScope(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	// Same key "smtp_host" at system (nil) and user (1) scope.
	if err := s.Set(ctx, nil, "smtp_host", "smtp.system.example"); err != nil {
		t.Fatalf("system set: %v", err)
	}
	if err := s.Set(ctx, ptr(1), "smtp_host", "smtp.user.example"); err != nil {
		t.Fatalf("user set: %v", err)
	}

	sys, _ := s.Get(ctx, nil, "smtp_host")
	user, _ := s.Get(ctx, ptr(1), "smtp_host")
	if sys.Value != "smtp.system.example" {
		t.Errorf("system value: %q", sys.Value)
	}
	if user.Value != "smtp.user.example" {
		t.Errorf("user value: %q", user.Value)
	}
}

func TestSettingsSetIsUpsert(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	if err := s.Set(ctx, ptr(1), "k", "v1"); err != nil {
		t.Fatalf("set1: %v", err)
	}
	if err := s.Set(ctx, ptr(1), "k", "v2"); err != nil {
		t.Fatalf("set2: %v", err)
	}
	got, _ := s.Get(ctx, ptr(1), "k")
	if got.Value != "v2" {
		t.Errorf("upsert failed: got %q want v2", got.Value)
	}

	keys, _ := s.List(ctx, ptr(1))
	if len(keys) != 1 {
		t.Errorf("expected 1 key after upsert, got %d: %v", len(keys), keys)
	}
}

func TestSettingsGetMissing(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	if _, err := s.Get(ctx, ptr(1), "nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

func TestSettingsDelete(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	_ = s.Set(ctx, ptr(1), "k", "v")
	if err := s.Delete(ctx, ptr(1), "k"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.Get(ctx, ptr(1), "k"); !errors.Is(err, ErrNotFound) {
		t.Errorf("get after delete: got %v, want ErrNotFound", err)
	}
	if err := s.Delete(ctx, ptr(1), "k"); !errors.Is(err, ErrNotFound) {
		t.Errorf("delete nonexistent: got %v, want ErrNotFound", err)
	}
}

func TestSettingsList(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	_ = s.Set(ctx, ptr(1), "a", "va")
	_ = s.Set(ctx, ptr(1), "b", "vb")
	_ = s.Set(ctx, ptr(2), "c", "vc") // Bob's — must NOT appear in Alice's list

	keys, err := s.List(ctx, ptr(1))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if strings.Join(keys, ",") != "a,b" {
		t.Errorf("alice keys: got %v want [a b]", keys)
	}
}

func TestSettingsInvalidKey(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	bad := []string{"", "Key", "1abc", "a b", strings.Repeat("x", 65), "../escape", "a-b"}
	for _, k := range bad {
		if err := s.Set(ctx, ptr(1), k, "v"); !errors.Is(err, ErrKeyInvalid) {
			t.Errorf("Set(%q): got %v, want ErrKeyInvalid", k, err)
		}
	}

	good := []string{"a", "pull_secret", "smtp.host", "k1_v2.final"}
	for _, k := range good {
		if err := s.Set(ctx, ptr(1), k, "v"); err != nil {
			t.Errorf("Set(%q): got %v, want nil", k, err)
		}
	}
}

func TestSettingsValueTooBig(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	huge := strings.Repeat("x", MaxSettingValueSize+1)
	if err := s.Set(ctx, ptr(1), "k", huge); !errors.Is(err, ErrValueTooBig) {
		t.Errorf("got %v, want ErrValueTooBig", err)
	}
}
