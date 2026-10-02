package packagehelper

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
	"piwork/internal/contracts"
	"piwork/internal/pipackage"
	"regexp"
	"strings"
	"time"
)

type Paths struct{ WorkRoot, SpoolRoot, SourceRoot, HostModuleRoot string }

func DefaultPaths() Paths {
	return Paths{"/package/work", "/package/spool", "/package/source", "/workspace/node_modules"}
}

type Helper struct {
	Paths          Paths
	commandTimeout time.Duration
}
type Prepared struct {
	Name           string  `json:"name"`
	Version        *string `json:"version"`
	SourceKind     string  `json:"sourceKind"`
	ResolvedSource string  `json:"resolvedSource"`
}
type Captured struct {
	pipackage.Artifact
	ZipBytes  int64  `json:"zipBytes"`
	ZipSHA256 string `json:"zipSha256"`
}

func (h Helper) Run(ctx context.Context, action string) (any, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	switch action {
	case "init":
		if err := os.MkdirAll(h.Paths.WorkRoot, 0700); err != nil {
			return nil, err
		}
		root, err := os.OpenRoot(h.Paths.WorkRoot)
		if err != nil {
			return nil, err
		}
		defer root.Close()
		dir, err := root.Open(".")
		if err != nil {
			return nil, err
		}
		defer dir.Close()
		if os.Getuid() == 0 {
			if err := dir.Chown(10001, 10001); err != nil {
				return nil, err
			}
		}
		return struct {
			Initialized bool `json:"initialized"`
		}{true}, nil
	case "measure":
		size, err := pipackage.Measure(ctx, h.Paths.WorkRoot)
		return struct {
			Bytes int64 `json:"bytes"`
		}{size}, err
	case "capture":
		return h.capture(ctx)
	case "prepare":
		return h.prepare(ctx)
	default:
		return nil, errors.New("invalid package helper action")
	}
}

func readBounded(root *os.Root, name string, max int64) ([]byte, error) {
	file, err := root.OpenFile(name, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, pipackage.ErrUnsafe
	}
	if info.Size() > max {
		return nil, pipackage.ErrLimit
	}
	raw, err := io.ReadAll(io.LimitReader(file, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > max {
		return nil, pipackage.ErrLimit
	}
	return raw, nil
}
func writePinned(root *os.Root, name string, raw []byte, mode os.FileMode, exclusive bool) error {
	temp := "." + name + ".pending"
	file, err := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(temp)
	chmodErr := file.Chmod(mode)
	ownerErr := inheritOutputOwner(root, file)
	if ownerErr != nil {
		file.Close()
		return ownerErr
	}
	_, writeErr := file.Write(raw)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || ownerErr != nil || chmodErr != nil || syncErr != nil || closeErr != nil {
		return pipackage.ErrUnsafe
	}
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	if exclusive {
		err = unix.Renameat2(int(dir.Fd()), temp, int(dir.Fd()), name, unix.RENAME_NOREPLACE)
	} else {
		err = root.Rename(temp, name)
	}
	if err != nil {
		return err
	}
	return dir.Sync()
}

// A trusted capture helper runs as container root to read the private package
// volume. Its host spool outputs belong to the owner of the pinned spool,
// allowing the Core to read and collect them without accepting foreign files.
func inheritOutputOwner(root *os.Root, output *os.File) error {
	if os.Geteuid() != 0 {
		return nil
	}
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	var owner unix.Stat_t
	if err := unix.Fstat(int(dir.Fd()), &owner); err != nil {
		return err
	}
	return output.Chown(int(owner.Uid), int(owner.Gid))
}

func (h Helper) capture(ctx context.Context) (Captured, error) {
	spool, err := os.OpenRoot(h.Paths.SpoolRoot)
	if err != nil {
		return Captured{}, err
	}
	defer spool.Close()
	raw, err := readBounded(spool, "request.json", pipackage.ManifestBytes)
	if err != nil {
		return Captured{}, err
	}
	if _, err := contracts.ParseJSON(bytes.NewReader(raw), pipackage.ManifestBytes); err != nil {
		return Captured{}, pipackage.ErrManifest
	}
	var request struct {
		SourceKind          string          `json:"sourceKind"`
		ResolvedSource      string          `json:"resolvedSource"`
		PreparedEnvironment json.RawMessage `json:"preparedEnvironment"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return Captured{}, pipackage.ErrManifest
	}
	environment, err := pipackage.ValidateEnvironment(request.PreparedEnvironment)
	if err != nil {
		return Captured{}, err
	}
	work, err := os.OpenRoot(h.Paths.WorkRoot)
	if err != nil {
		return Captured{}, err
	}
	defer work.Close()
	tree, err := pipackage.OpenTreeAt(ctx, work, "result")
	if err != nil {
		return Captured{}, err
	}
	defer tree.Close()
	artifact, err := pipackage.ValidateArtifact(tree, request.SourceKind, request.ResolvedSource, environment, "")
	if err != nil {
		return Captured{}, err
	}
	for _, name := range []string{"result.json", "artifact.zip"} {
		if _, err := spool.Lstat(name); !errors.Is(err, os.ErrNotExist) {
			return Captured{}, pipackage.ErrUnsafe
		}
	}
	packed, err := pipackage.PackArchiveToSpool(ctx, tree, filepath.Join(h.Paths.SpoolRoot, "artifact.zip"))
	if err != nil {
		return Captured{}, err
	}
	result := Captured{Artifact: artifact, ZipBytes: packed.Bytes, ZipSHA256: packed.Digest}
	raw, err = json.Marshal(result)
	if err != nil {
		return Captured{}, err
	}
	if err = writePinned(spool, "result.json", raw, 0644, true); err != nil {
		return Captured{}, err
	}
	return result, nil
}

func (h Helper) prepare(ctx context.Context) (Prepared, error) {
	// This production entry point cannot run npm/Git on the Core host.
	if info, err := os.Lstat("/.dockerenv"); err != nil || !info.Mode().IsRegular() || os.Getuid() == 0 {
		return Prepared{}, pipackage.ErrSource
	}
	sourceRoot, err := os.OpenRoot(h.Paths.SourceRoot)
	if err != nil {
		return Prepared{}, err
	}
	defer sourceRoot.Close()
	raw, err := readBounded(sourceRoot, "request.json", pipackage.ManifestBytes)
	if err != nil {
		return Prepared{}, err
	}
	request, err := contracts.Decode[contracts.PackageHelperPrepareRequest](bytes.NewReader(raw), "PackageHelperPrepareRequestSchema", pipackage.ManifestBytes)
	if err != nil {
		return Prepared{}, pipackage.ErrSource
	}
	var source struct {
		Kind        string `json:"kind"`
		Spec        string `json:"spec"`
		DisplayName string `json:"displayName"`
	}
	if json.Unmarshal(request.Source, &source) != nil {
		return Prepared{}, pipackage.ErrSource
	}
	result := filepath.Join(h.Paths.WorkRoot, "result")
	var resolved string
	switch source.Kind {
	case "local", "zip":
		if source.DisplayName == "" || strings.Contains(source.DisplayName, "/") {
			return Prepared{}, pipackage.ErrSource
		}
		if _, err = pipackage.ExtractArchive(ctx, filepath.Join(h.Paths.SourceRoot, "input.zip"), result); err != nil {
			return Prepared{}, err
		}
		resolved = source.DisplayName
	case "npm":
		parsed, err := pipackage.ParseSource("npm:" + source.Spec)
		if err != nil {
			return Prepared{}, err
		}
		stage := filepath.Join(h.Paths.WorkRoot, "npm-stage")
		if err := os.Mkdir(stage, 0700); err != nil {
			return Prepared{}, err
		}
		name, err := runCommand(ctx, "npm", append(append([]string{"pack"}, npmFetchOptions...), "--silent", "--ignore-scripts", "--pack-destination", stage, parsed.Spec), stage, ErrFetch, true, h.commandTimeout)
		if err != nil {
			return Prepared{}, err
		}
		if !strings.HasSuffix(name, ".tgz") || filepath.Base(name) != name {
			return Prepared{}, pipackage.ErrSource
		}
		manifest, err := pipackage.ExtractNPMArchive(ctx, filepath.Join(stage, name), result)
		if err != nil {
			return Prepared{}, err
		}
		npmName := strings.Split(parsed.Spec, "@")[0]
		if strings.HasPrefix(parsed.Spec, "@") {
			npmName = "@" + strings.Split(parsed.Spec[1:], "@")[0]
		}
		if manifest.Name != npmName {
			return Prepared{}, pipackage.ErrManifest
		}
		if manifest.Version == nil {
			return Prepared{}, pipackage.ErrManifest
		}
		resolved = manifest.Name + "@" + *manifest.Version
		work, err := os.OpenRoot(h.Paths.WorkRoot)
		if err != nil {
			return Prepared{}, err
		}
		err = work.RemoveAll("npm-stage")
		work.Close()
		if err != nil {
			return Prepared{}, err
		}
	case "git":
		parsed, err := pipackage.ParseSource("git:" + source.Spec)
		if err != nil {
			return Prepared{}, err
		}
		checkout := filepath.Join(h.Paths.WorkRoot, "git-checkout")
		if _, err = runCommand(ctx, "git", []string{"clone", "--no-checkout", parsed.URL, checkout}, h.Paths.WorkRoot, ErrFetch, false, h.commandTimeout); err != nil {
			return Prepared{}, err
		}
		ref := "HEAD"
		if parsed.Ref != nil {
			ref = *parsed.Ref
		}
		if _, err = runCommand(ctx, "git", []string{"-C", checkout, "checkout", "--detach", ref}, h.Paths.WorkRoot, ErrFetch, false, h.commandTimeout); err != nil {
			return Prepared{}, err
		}
		commit, err := runCommand(ctx, "git", []string{"-C", checkout, "rev-parse", "HEAD"}, h.Paths.WorkRoot, ErrFetch, true, h.commandTimeout)
		if err != nil {
			return Prepared{}, err
		}
		if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(commit) {
			return Prepared{}, pipackage.ErrSource
		}
		root, err := os.OpenRoot(checkout)
		if err != nil {
			return Prepared{}, err
		}
		err = root.RemoveAll(".git")
		root.Close()
		if err != nil {
			return Prepared{}, err
		}
		tree, err := pipackage.OpenTree(ctx, checkout)
		if err != nil {
			return Prepared{}, err
		}
		tree.Close()
		parent, err := os.OpenRoot(h.Paths.WorkRoot)
		if err != nil {
			return Prepared{}, err
		}
		dir, err := parent.Open(".")
		if err != nil {
			parent.Close()
			return Prepared{}, err
		}
		err = unix.Renameat2(int(dir.Fd()), "git-checkout", int(dir.Fd()), "result", unix.RENAME_NOREPLACE)
		dir.Close()
		parent.Close()
		if err != nil {
			return Prepared{}, err
		}
		resolved = parsed.URL + "@" + commit
	default:
		return Prepared{}, pipackage.ErrSource
	}
	root, err := os.OpenRoot(result)
	if err != nil {
		return Prepared{}, err
	}
	err = root.RemoveAll("node_modules")
	root.Close()
	if err != nil {
		return Prepared{}, err
	}
	if err = h.install(ctx, result); err != nil {
		return Prepared{}, err
	}
	root, err = os.OpenRoot(result)
	if err != nil {
		return Prepared{}, err
	}
	defer root.Close()
	raw, err = readBounded(root, "package.json", pipackage.ManifestBytes)
	if err != nil {
		return Prepared{}, err
	}
	manifest, err := pipackage.ParseManifest(raw)
	if err != nil {
		return Prepared{}, err
	}
	return Prepared{manifest.Name, manifest.Version, source.Kind, resolved}, nil
}
