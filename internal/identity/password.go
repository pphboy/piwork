package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"unicode/utf16"

	"golang.org/x/crypto/argon2"
	"piwork/internal/contracts"
)

const argonParameters = "m=65536,t=3,p=1"

var passwordGate = make(chan struct{}, 4)

func ValidatePassword(password string) error {
	if len(utf16.Encode([]rune(password))) < 12 {
		return contracts.NewError("INVALID_REQUEST", "password")
	}
	return nil
}
func derive(ctx context.Context, password string, salt []byte) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case passwordGate <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-passwordGate }()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	key := argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32)
	if err := ctx.Err(); err != nil {
		clear(key)
		return nil, err
	}
	return key, nil
}
func HashPassword(ctx context.Context, password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := derive(ctx, password, salt)
	if err != nil {
		return "", err
	}
	defer clear(key)
	return "$argon2id$v=19$" + argonParameters + "$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key), nil
}
func VerifyPassword(ctx context.Context, digest, password string) (bool, error) {
	// Only the fixed fresh-Go parameters are valid. Corrupt stored PHC values
	// cannot request attacker-selected memory, parallelism or work factors.
	parts := strings.Split(digest, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != argonParameters {
		return false, nil
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) != 16 {
		return false, nil
	}
	want, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(want) != 32 {
		return false, nil
	}
	got, err := derive(ctx, password, salt)
	if err != nil {
		return false, err
	}
	defer clear(got)
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
func TokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func randomToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}
