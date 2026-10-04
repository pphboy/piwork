package packagehelper

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"

	"piwork/internal/contracts"
	"piwork/internal/pipackage"
)

const BrainSourcePath = ".pi/packages/piwork-brain"

var ErrBrainSourceConflict = &pipackage.InputError{Code: "PI_PACKAGE_CANDIDATE_CONFLICT"}
var sourceDigestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type BrainSourceCapture struct {
	SourceDigest string `json:"sourceDigest"`
	ZipBytes     int64  `json:"zipBytes"`
	ZipSHA256    string `json:"zipSha256"`
}

// A helper has a read-only Work workspace mount, and receives only an expected
// digest. No caller-selected path or URL can extend this capture boundary.
func (h Helper) captureBrainSource(ctx context.Context) (BrainSourceCapture, error) {
	spool, err := os.OpenRoot(h.Paths.SpoolRoot)
	if err != nil {
		return BrainSourceCapture{}, err
	}
	defer spool.Close()
	raw, err := readBounded(spool, "capture-request.json", 4096)
	if err != nil {
		return BrainSourceCapture{}, err
	}
	if _, err = contracts.ParseJSON(bytes.NewReader(raw), 4096); err != nil {
		return BrainSourceCapture{}, pipackage.ErrSource
	}
	var request struct {
		ContractVersion      int    `json:"contractVersion"`
		ExpectedSourceDigest string `json:"expectedSourceDigest"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || request.ContractVersion != 1 || !sourceDigestPattern.MatchString(request.ExpectedSourceDigest) {
		return BrainSourceCapture{}, pipackage.ErrSource
	}
	workspace, err := os.OpenRoot(h.Paths.BrainSourceRoot)
	if err != nil {
		return BrainSourceCapture{}, pipackage.ErrUnsafe
	}
	defer workspace.Close()
	for _, name := range []string{".pi", ".pi/packages", BrainSourcePath} {
		info, err := workspace.Lstat(name)
		if err != nil || !info.IsDir() {
			return BrainSourceCapture{}, pipackage.ErrUnsafe
		}
	}
	tree, err := pipackage.OpenTreeAt(ctx, workspace, BrainSourcePath)
	if err != nil {
		return BrainSourceCapture{}, err
	}
	defer tree.Close()
	if tree.Manifest.Name != "piwork-brain" {
		return BrainSourceCapture{}, pipackage.ErrManifest
	}
	digest, err := tree.Digest()
	if err != nil {
		return BrainSourceCapture{}, err
	}
	if digest != request.ExpectedSourceDigest {
		return BrainSourceCapture{}, ErrBrainSourceConflict
	}
	for _, name := range []string{"input.zip", "source-capture.json"} {
		if _, err = spool.Lstat(name); !errors.Is(err, os.ErrNotExist) {
			return BrainSourceCapture{}, pipackage.ErrUnsafe
		}
	}
	packed, err := pipackage.PackArchiveToSpool(ctx, tree, filepath.Join(h.Paths.SpoolRoot, "input.zip"))
	if err != nil {
		return BrainSourceCapture{}, err
	}
	// Pack verifies the scanned file identities; compare the frozen archive's
	// tree to the expected source as well, before publishing the receipt.
	archive, err := pipackage.OpenArchive(ctx, filepath.Join(h.Paths.SpoolRoot, "input.zip"))
	if err != nil {
		return BrainSourceCapture{}, err
	}
	defer archive.Close()
	capturedDigest, err := archive.Digest()
	if err != nil {
		return BrainSourceCapture{}, err
	}
	if capturedDigest != digest {
		return BrainSourceCapture{}, ErrBrainSourceConflict
	}
	result := BrainSourceCapture{digest, packed.Bytes, packed.Digest}
	raw, _ = json.Marshal(result)
	if err = writePinned(spool, "source-capture.json", raw, 0644, true); err != nil {
		return BrainSourceCapture{}, err
	}
	return result, nil
}
