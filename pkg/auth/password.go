package auth

import "golang.org/x/crypto/bcrypt"

// BcryptCost controls password hashing strength. Cost 12 is ~250ms on
// modern x86 servers — adequate for a hypervisor control plane where
// logins are rare. Higher costs punish brute-force more but slow login.
const BcryptCost = 12

// HashPassword returns a bcrypt hash of plain. The result is safe to
// store verbatim in the DB (includes salt and cost metadata).
func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// VerifyPassword returns nil if plain matches hash, or an error otherwise.
// Caller should NOT distinguish between "user not found" and "wrong
// password" in responses — both should surface as generic 401 to avoid
// user-enumeration.
func VerifyPassword(hash, plain string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain))
}
