package auth

import (
	"context"
	"errors"
)

// CredentialVerifier is the plug point for auth backends (DB, PAM,
// LDAP/OIDC later). Handlers depend on this interface — they don't
// know which backend is in use.
//
// Implementations MUST NOT distinguish between "user unknown" and
// "wrong password" in the returned error — both collapse to
// ErrInvalidCredentials. This prevents user enumeration over HTTP
// response codes or timing (modulo implementation care on timing).
type CredentialVerifier interface {
	Verify(ctx context.Context, username, password string) (*User, error)
}

// ErrInvalidCredentials is the single error returned on any auth
// failure — missing user, bad password, disabled account, PAM failure,
// etc. The HTTP layer maps it to 401 with a generic message.
var ErrInvalidCredentials = errors.New("invalid credentials")
