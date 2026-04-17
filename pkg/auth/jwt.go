package auth

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims is the payload embedded in every issued JWT. Keep it small —
// every request over the cookie carries it.
//
// Per design (multi_tenancy.md §User Model): user_id, username, is_admin
// are enough for the middleware to look up the full User row. Quotas,
// home path, UID, etc. come from the DB load, not the token.
type Claims struct {
	UserID   int64  `json:"uid"`
	Username string `json:"u"`
	IsAdmin  bool   `json:"admin,omitempty"`
	jwt.RegisteredClaims
}

// Signer issues and verifies tokens using a symmetric secret (HS256).
// Rationale for HS256 over RS256: single-process trust boundary (this
// binary both issues and verifies), no external validators. If a second
// validator ever needs to verify tokens without the secret — e.g. an
// auth proxy — migrate to RS256 then.
type Signer struct {
	secret []byte
	ttl    time.Duration
}

// NewSigner constructs a Signer. TTL is how long a freshly-issued token
// stays valid; 24h is a reasonable default for dev and most production.
func NewSigner(secret []byte, ttl time.Duration) *Signer {
	return &Signer{secret: secret, ttl: ttl}
}

// TTL exposes the configured token lifetime (for setting cookie Expires).
func (s *Signer) TTL() time.Duration {
	return s.ttl
}

// Issue mints a signed JWT for u.
func (s *Signer) Issue(u *User) (string, error) {
	if u == nil {
		return "", errors.New("nil user")
	}
	now := time.Now()
	claims := Claims{
		UserID:   u.ID,
		Username: u.Username,
		IsAdmin:  u.IsAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
			Subject:   u.Username,
			Issuer:    "staxv-hypervisor",
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(s.secret)
}

// Verify parses token and returns its claims. Returns an error if the
// token is expired, malformed, or signed with anything other than HS256.
func (s *Signer) Verify(token string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		// Prevent algorithm-confusion attacks: only accept HS256.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}
	return claims, nil
}

// LoadOrCreateSecret reads a 32-byte secret from path, or generates one
// (0600-permissioned) if missing. Returns the secret bytes.
//
// The secret should live outside the repo (/etc/staxv-hypervisor/jwt.key
// in prod; ./tmp/jwt.key in dev). Losing it invalidates all outstanding
// tokens — a mild inconvenience, not a security incident.
func LoadOrCreateSecret(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) != 32 {
			return nil, fmt.Errorf("jwt secret at %s has wrong length (%d, want 32) — delete it to regenerate", path, len(b))
		}
		return b, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, secret, 0600); err != nil {
		return nil, err
	}
	return secret, nil
}
