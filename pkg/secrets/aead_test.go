package secrets

import (
	"bytes"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"
)

func newTestAEAD(t *testing.T) *AEAD {
	t.Helper()
	key := make([]byte, KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand: %v", err)
	}
	a, err := NewAEAD(key)
	if err != nil {
		t.Fatalf("NewAEAD: %v", err)
	}
	return a
}

func TestRoundTrip(t *testing.T) {
	a := newTestAEAD(t)
	plain := []byte("hello — here's a pull secret: {\"auths\":{}}")
	ct, err := a.Encrypt(plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	out, err := a.Decrypt(ct)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(out, plain) {
		t.Errorf("got %q want %q", out, plain)
	}
}

// Two encrypts of the same plaintext must produce different ciphertexts,
// otherwise an attacker can tell when a setting hasn't changed.
func TestNonceIsRandomPerCall(t *testing.T) {
	a := newTestAEAD(t)
	plain := []byte("same plaintext")
	ct1, _ := a.Encrypt(plain)
	ct2, _ := a.Encrypt(plain)
	if bytes.Equal(ct1, ct2) {
		t.Errorf("two encrypts produced identical ciphertext — nonce is not random")
	}
}

func TestDecryptWithWrongKey(t *testing.T) {
	a := newTestAEAD(t)
	b := newTestAEAD(t)
	ct, _ := a.Encrypt([]byte("secret"))
	if _, err := b.Decrypt(ct); err == nil {
		t.Errorf("decrypt with wrong key should fail")
	}
}

func TestDecryptTamperedCiphertext(t *testing.T) {
	a := newTestAEAD(t)
	ct, _ := a.Encrypt([]byte("secret"))
	// Flip a byte in the ciphertext section (past the nonce).
	ct[len(ct)-1] ^= 1
	if _, err := a.Decrypt(ct); err == nil {
		t.Errorf("decrypt of tampered ciphertext should fail — GCM tag should catch it")
	}
}

func TestDecryptTooShort(t *testing.T) {
	a := newTestAEAD(t)
	if _, err := a.Decrypt([]byte{1, 2, 3}); err == nil {
		t.Errorf("decrypt of short blob should fail")
	}
}

func TestNewAEADWrongKeySize(t *testing.T) {
	for _, n := range []int{0, 16, 24, 31, 33, 64} {
		if _, err := NewAEAD(make([]byte, n)); err == nil {
			t.Errorf("NewAEAD with %d-byte key should fail", n)
		}
	}
}

func TestLoadOrCreateKeyPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "settings.key")
	k1, err := LoadOrCreateKey(path)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if len(k1) != KeySize {
		t.Errorf("size: got %d want %d", len(k1), KeySize)
	}
	k2, err := LoadOrCreateKey(path)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if !bytes.Equal(k1, k2) {
		t.Errorf("key should persist across calls")
	}
}

func TestLoadOrCreateKeyRejectsWrongSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.key")
	if err := os.WriteFile(path, make([]byte, 16), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateKey(path); err == nil {
		t.Errorf("LoadOrCreateKey should reject a 16-byte file")
	}
}
