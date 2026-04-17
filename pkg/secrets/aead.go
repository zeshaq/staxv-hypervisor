// Package secrets provides AES-256-GCM encryption for data at rest —
// currently used by the settings store to keep pull secrets, SSH keys,
// and tokens opaque on disk.
//
// Wire format: nonce (12 bytes) || ciphertext || tag. Standard AES-GCM
// packing, no framing, no version byte. If the format ever changes we
// can prepend a version byte then; for now the simplicity wins.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
)

// KeySize is the required length in bytes of the AES-256 key.
const KeySize = 32

// AEAD wraps a cipher.AEAD. One instance per key, safe for concurrent use.
type AEAD struct {
	gcm cipher.AEAD
}

// NewAEAD returns an AEAD using key as the AES-256 key. Returns an
// error if key is not exactly 32 bytes.
func NewAEAD(key []byte) (*AEAD, error) {
	if len(key) != KeySize {
		return nil, errors.New("secrets: key must be 32 bytes (AES-256)")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &AEAD{gcm: gcm}, nil
}

// Encrypt returns nonce || ciphertext || tag. Each call uses a fresh
// random nonce, so encrypting the same plaintext twice yields different
// ciphertexts (important for hiding whether the same secret is stored
// twice).
func (a *AEAD) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, a.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	// Seal appends ciphertext+tag to its first argument (nonce).
	return a.gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt reverses Encrypt. Returns an error if the ciphertext is
// truncated or tampered with (GCM's integrity tag catches both).
func (a *AEAD) Decrypt(blob []byte) ([]byte, error) {
	ns := a.gcm.NonceSize()
	if len(blob) < ns+a.gcm.Overhead() {
		return nil, errors.New("secrets: ciphertext too short")
	}
	nonce, ct := blob[:ns], blob[ns:]
	return a.gcm.Open(nil, nonce, ct, nil)
}
