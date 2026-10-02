package packagehelper

import (
	"context"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"piwork/internal/contracts"
	"piwork/internal/pipackage"
	"reflect"
)

func (h Helper) hostVersions() (map[string]string, error) {
	// npm hoists these differently across compatible Agent images; prefer the
	// SDK's own node_modules before the image-level installation.
	versions := map[string]string{}
	for _, name := range pipackage.HostModules {
		for _, parent := range []string{filepath.Join(h.Paths.HostModuleRoot, "@earendil-works/pi-coding-agent/node_modules"), h.Paths.HostModuleRoot} {
			root, err := os.OpenRoot(parent)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				break
			}
			raw, err := readBounded(root, path.Join(name, "package.json"), pipackage.ManifestBytes)
			root.Close()
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				break
			}
			var object struct {
				Version string `json:"version"`
			}
			if json.Unmarshal(raw, &object) == nil {
				versions[name] = object.Version
			}
			break
		}
	}
	return versions, nil
}
func (h Helper) install(ctx context.Context, directory string) (resultErr error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := root.Lstat("package.json")
	if err != nil || !info.Mode().IsRegular() {
		return pipackage.ErrManifest
	}
	manifestMode := os.FileMode(0644)
	if info.Mode()&0111 != 0 {
		manifestMode = 0755
	}
	raw, err := readBounded(root, "package.json", pipackage.ManifestBytes)
	if err != nil {
		return err
	}
	manifest, err := pipackage.ParseManifest(raw)
	if err != nil {
		return err
	}
	for name := range manifest.Dependencies {
		if pipackage.IsHostModule(name) {
			return pipackage.ErrManifest
		}
	}
	versions, err := h.hostVersions()
	if err != nil {
		return err
	}
	if err = pipackage.CheckHostPeers(manifest, versions); err != nil {
		return err
	}
	var original map[string]json.RawMessage
	if json.Unmarshal(raw, &original) != nil {
		return pipackage.ErrManifest
	}
	validLock := false
	if lockRaw, err := readBounded(root, "package-lock.json", pipackage.FileBytes); err == nil {
		var lock struct {
			Name            string                     `json:"name"`
			Version         contracts.Field[string]    `json:"version"`
			LockfileVersion float64                    `json:"lockfileVersion"`
			Packages        map[string]json.RawMessage `json:"packages"`
		}
		versionMatches := false
		decodeErr := json.Unmarshal(lockRaw, &lock)
		if lock.Version.Present {
			if manifest.Version == nil {
				versionMatches = lock.Version.Null
			} else {
				versionMatches = !lock.Version.Null && lock.Version.Value == *manifest.Version
			}
		}
		if decodeErr == nil && lock.LockfileVersion >= 2 && lock.LockfileVersion <= 9007199254740991 && lock.LockfileVersion == float64(int64(lock.LockfileVersion)) && lock.Name == manifest.Name && versionMatches {
			var lockRoot struct {
				Dependencies map[string]string `json:"dependencies"`
			}
			if len(lock.Packages[""]) == 0 || json.Unmarshal(lock.Packages[""], &lockRoot) == nil {
				if lockRoot.Dependencies == nil {
					lockRoot.Dependencies = map[string]string{}
				}
				validLock = reflect.DeepEqual(lockRoot.Dependencies, manifest.Dependencies)
			}
		}
	}
	var dev map[string]json.RawMessage
	trim := !validLock && json.Unmarshal(original["devDependencies"], &dev) == nil && len(dev) > 0
	if trim {
		delete(original, "devDependencies")
		runtimeRaw, err := json.Marshal(original)
		if err != nil {
			return err
		}
		if err = writePinned(root, "package.json", runtimeRaw, manifestMode, false); err != nil {
			return err
		}
		defer func() {
			if err := writePinned(root, "package.json", raw, manifestMode, false); err != nil {
				resultErr = pipackage.ErrUnsafe
			}
		}()
	}
	action := "install"
	if validLock {
		action = "ci"
	}
	args := append(append([]string{action}, npmFetchOptions...), "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--ignore-scripts=false", "--prefix", directory)
	_, err = runCommand(ctx, "npm", args, directory, ErrInstall, false, h.commandTimeout)
	return err
}
