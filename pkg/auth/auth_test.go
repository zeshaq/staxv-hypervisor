package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if err := VerifyPassword(hash, "correct horse battery staple"); err != nil {
		t.Errorf("verify should succeed: %v", err)
	}
	if err := VerifyPassword(hash, "wrong"); err == nil {
		t.Errorf("verify should fail on wrong password")
	}
}

func TestJWTRoundTrip(t *testing.T) {
	s := NewSigner([]byte("test-secret-32-bytes-long-xxxxxx"), time.Hour)
	u := &User{ID: 42, Username: "alice", IsAdmin: true}

	tok, err := s.Issue(u)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	claims, err := s.Verify(tok)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.UserID != 42 {
		t.Errorf("UserID: got %d want 42", claims.UserID)
	}
	if claims.Username != "alice" {
		t.Errorf("Username: got %q want alice", claims.Username)
	}
	if !claims.IsAdmin {
		t.Errorf("IsAdmin should be true")
	}
}

func TestJWTExpired(t *testing.T) {
	s := NewSigner([]byte("test-secret-32-bytes-long-xxxxxx"), -time.Minute)
	tok, err := s.Issue(&User{ID: 1, Username: "x"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := s.Verify(tok); err == nil {
		t.Errorf("expected expired-token error")
	}
}

func TestJWTWrongSecret(t *testing.T) {
	a := NewSigner([]byte("secret-A-32-bytes-long-xxxxxxxxx"), time.Hour)
	b := NewSigner([]byte("secret-B-32-bytes-long-xxxxxxxxx"), time.Hour)
	tok, _ := a.Issue(&User{ID: 1, Username: "x"})
	if _, err := b.Verify(tok); err == nil {
		t.Errorf("verify with wrong secret should fail")
	}
}

func TestLoadOrCreateSecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "subdir", "jwt.key")
	s1, err := LoadOrCreateSecret(path)
	if err != nil {
		t.Fatalf("first load: %v", err)
	}
	if len(s1) != 32 {
		t.Errorf("want 32 bytes, got %d", len(s1))
	}
	s2, err := LoadOrCreateSecret(path)
	if err != nil {
		t.Fatalf("second load: %v", err)
	}
	if string(s1) != string(s2) {
		t.Errorf("secret should be stable across loads")
	}
}

func TestContextRoundTrip(t *testing.T) {
	u := &User{ID: 7, Username: "bob"}
	ctx := WithUser(context.Background(), u)
	got := UserFromCtx(ctx)
	if got != u {
		t.Errorf("round-trip: got %+v want %+v", got, u)
	}
	if UserFromCtx(context.Background()) != nil {
		t.Errorf("empty context should return nil")
	}
}

// fakeStore satisfies UserStore in tests.
type fakeStore struct{ users map[int64]*User }

func (f *fakeStore) GetUserByID(_ context.Context, id int64) (*User, error) {
	return f.users[id], nil
}

func TestMiddlewareHappyPath(t *testing.T) {
	s := NewSigner([]byte("test-secret-32-bytes-long-xxxxxx"), time.Hour)
	alice := &User{ID: 1, Username: "alice"}
	store := &fakeStore{users: map[int64]*User{1: alice}}

	var gotUser *User
	inner := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotUser = UserFromCtx(r.Context())
	})
	mw := Middleware(s, store)(inner)

	tok, _ := s.Issue(alice)
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: tok})
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status: got %d want 200", rec.Code)
	}
	if gotUser == nil || gotUser.ID != 1 {
		t.Errorf("user not in ctx: got %+v", gotUser)
	}
}

func TestMiddlewareNoCookie(t *testing.T) {
	s := NewSigner([]byte("test-secret-32-bytes-long-xxxxxx"), time.Hour)
	mw := Middleware(s, &fakeStore{})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d", rec.Code)
	}
}

func TestMiddlewareDisabledUser(t *testing.T) {
	s := NewSigner([]byte("test-secret-32-bytes-long-xxxxxx"), time.Hour)
	now := time.Now()
	alice := &User{ID: 1, Username: "alice", DisabledAt: &now}
	store := &fakeStore{users: map[int64]*User{1: alice}}

	mw := Middleware(s, store)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	tok, _ := s.Issue(alice)
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: tok})
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("disabled user should get 401, got %d", rec.Code)
	}
}

func TestRequireAdmin(t *testing.T) {
	admin := &User{ID: 1, Username: "root", IsAdmin: true}
	regular := &User{ID: 2, Username: "alice", IsAdmin: false}

	cases := []struct {
		name   string
		user   *User
		want   int
	}{
		{"admin passes", admin, http.StatusOK},
		{"non-admin forbidden", regular, http.StatusForbidden},
		{"no user forbidden", nil, http.StatusForbidden},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest("GET", "/", nil)
			if c.user != nil {
				req = req.WithContext(WithUser(req.Context(), c.user))
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != c.want {
				t.Errorf("%s: got %d want %d", c.name, rec.Code, c.want)
			}
		})
	}
}
