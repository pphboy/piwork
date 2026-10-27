// Package bootcsp permits only the generated, embedded startup watchdog.
package bootcsp

import (
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"strings"
)

// Policy adds the build-generated SHA-256 to an existing policy. Invalid or
// missing metadata leaves the policy unchanged, so the static links still work.
func Policy(policy string, assets fs.FS) string {
	data, err := fs.ReadFile(assets, "static/public/boot-csp.txt")
	if err != nil {
		return policy
	}
	hash := strings.TrimSpace(string(data))
	decoded, err := base64.StdEncoding.DecodeString(hash)
	if err != nil || len(decoded) != sha256.Size {
		return policy
	}
	return strings.Replace(policy, "script-src 'self'", "script-src 'self' 'sha256-"+hash+"'", 1)
}
