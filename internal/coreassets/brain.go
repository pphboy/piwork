package coreassets

import (
	"archive/zip"
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"strings"
)

const BrainPackageName = "piwork-brain"

//go:embed piwork-brain
var brainPackage embed.FS

// BrainPackageVersion uses the ordinary package manifest as the update marker.
func BrainPackageVersion() (string, error) {
	raw, err := brainPackage.ReadFile(BrainPackageName + "/package.json")
	if err != nil {
		return "", err
	}
	var manifest struct{ Name, Version string }
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return "", err
	}
	if manifest.Name != BrainPackageName || manifest.Version == "" {
		return "", errors.New("invalid built-in brain manifest")
	}
	return manifest.Version, nil
}

// BrainPackageArchive provides the embedded editable source to the same native
// preparation pipeline used by ordinary local Pi extension packages.
func BrainPackageArchive() ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	err := fs.WalkDir(brainPackage, BrainPackageName, func(name string, item fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if item.IsDir() {
			return nil
		}
		raw, err := brainPackage.ReadFile(name)
		if err != nil {
			return err
		}
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: strings.TrimPrefix(name, BrainPackageName+"/"), Method: zip.Deflate})
		if err != nil {
			return err
		}
		_, err = entry.Write(raw)
		return err
	})
	if err != nil {
		writer.Close()
		return nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
