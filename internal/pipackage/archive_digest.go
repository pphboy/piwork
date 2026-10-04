package pipackage

import (
	"io"
	"piwork/internal/contracts"
)

// Digest fingerprints validated, normalized archive contents without executing
// or extracting them. Readers verify ZIP checksums and the shared tree bounds.
func (archive *Archive) Digest() (string, error) {
	entries := make([]contracts.DigestEntry, 0, len(archive.Entries))
	for _, item := range archive.Entries {
		entry := contracts.DigestEntry{Path: item.Path, Type: item.Type, Mode: item.Mode, Size: item.Size}
		if item.Type == "file" {
			entry.Open = func() (io.ReadCloser, error) { return item.file.Open() }
		}
		if item.Type == "symlink" {
			input, err := item.file.Open()
			if err != nil {
				return "", err
			}
			raw, readErr := io.ReadAll(io.LimitReader(input, MaxPathBytes+1))
			closeErr := input.Close()
			if readErr != nil {
				return "", readErr
			}
			if closeErr != nil {
				return "", closeErr
			}
			if int64(len(raw)) != item.Size || safeLink(item.Path, string(raw)) != nil {
				return "", ErrUnsafe
			}
			entry.Target = string(raw)
		}
		entries = append(entries, entry)
	}
	return contracts.PiPackageDigest(entries)
}
