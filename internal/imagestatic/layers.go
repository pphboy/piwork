package imagestatic

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"io"
	"path"
	"piwork/internal/contracts"
	"strings"
)

const PackageHelperPath = "usr/local/bin/piwork-package-helper"
const ServiceMCPPath = "usr/local/bin/piwork-service-mcp"
const FileHelperPath = "usr/local/bin/piwork-file-helper"
const SnapshotHelperPath = "usr/local/bin/piwork-snapshot-helper"

var nativePaths = []string{PackageHelperPath, ServiceMCPPath, FileHelperPath, SnapshotHelperPath}
var environmentPaths = []string{nodeVersionPath, sdkManifestPath}
var legacyHelperPrefixes = []string{"opt/piwork/file-helper", "opt/piwork/snapshot-helper", "usr/local/bin/python3", "usr/local/bin/node", "usr/bin/python3", "usr/bin/node"}

var forbiddenPrefixes = []string{"workspace/apps/package-helper", "workspace/apps/service-mcp"}

type node struct {
	kind            byte
	executable, elf bool
	digest          string
	data            []byte
}
type update struct {
	name string
	node node
}
type whiteout struct {
	name   string
	opaque bool
}
type layerBudget struct {
	bytes   int64
	logical int64
	entries int
}

// Only relevant branches are retained. A child index makes whiteouts and
// replacements linear in the removed subtree, rather than rescanning up to a
// million unrelated files for every layer entry.
type layerState struct {
	nodes    map[string]node
	children map[string]map[string]bool
}

func newLayerState() *layerState { return &layerState{map[string]node{}, map[string]map[string]bool{}} }
func parentName(name string) string {
	p := path.Dir(name)
	if p == "." {
		return ""
	}
	return p
}
func (s *layerState) put(name string, n node) {
	s.nodes[name] = n
	parent := parentName(name)
	if s.children[parent] == nil {
		s.children[parent] = map[string]bool{}
	}
	s.children[parent][name] = true
}
func (s *layerState) remove(name string, descendantsOnly bool) {
	for child := range s.children[name] {
		s.remove(child, false)
	}
	delete(s.children, name)
	if !descendantsOnly && name != "" {
		delete(s.nodes, name)
		delete(s.children[parentName(name)], name)
	}
}

// rawTarGuard counts extended headers too, before archive/tar interprets them.
// It bounds every physical body and permits only zero bytes after the tar end.
// The standard parser supplies checksum/PAX/link validation, without extraction.
type rawTarGuard struct {
	ctx       context.Context
	source    io.Reader
	budget    *layerBudget
	header    [512]byte
	at        int
	remaining int64
	ended     bool
	sawEnd    bool
}

func (g *rawTarGuard) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if err := g.ctx.Err(); err != nil {
		return 0, err
	}
	if g.remaining > 0 {
		if int64(len(p)) > g.remaining {
			p = p[:g.remaining]
		}
		n, err := g.source.Read(p)
		g.remaining -= int64(n)
		g.budget.bytes += int64(n)
		if g.budget.bytes > MaxRestoredBytes {
			return 0, ErrLimit
		}
		if err == io.EOF && g.remaining > 0 {
			return n, ErrInvalid
		}
		return n, err
	}
	if len(p) > 512-g.at {
		p = p[:512-g.at]
	}
	n, err := g.source.Read(p)
	copy(g.header[g.at:], p[:n])
	g.at += n
	g.budget.bytes += int64(n)
	if g.budget.bytes > MaxRestoredBytes {
		return 0, ErrLimit
	}
	if g.at == 512 {
		g.at = 0
		if bytes.Equal(g.header[:], make([]byte, 512)) {
			g.ended = true
			g.sawEnd = true
		} else {
			if g.ended {
				return n, ErrInvalid
			}
			g.budget.entries++
			if g.budget.entries > MaxEntries {
				return n, ErrLimit
			}
			// Size is needed before exposing a header. archive/tar would hide
			// extended records, so parse its signed tar number here as well.
			size, ok := tarSize(g.header[124:136])
			if !ok {
				return n, ErrInvalid
			}
			if size > MaxRestoredBytes-g.budget.bytes {
				return n, ErrLimit
			}
			g.remaining = (size + 511) / 512 * 512
		}
	}
	if err == io.EOF && (g.at != 0 || !g.sawEnd) {
		return n, ErrInvalid
	}
	return n, err
}
func tarSize(p []byte) (int64, bool) {
	if p[0]&0x80 != 0 {
		if p[0]&0x40 != 0 {
			return 0, false
		}
		v := int64(p[0] & 0x3f)
		for _, b := range p[1:] {
			if v > (MaxRestoredBytes-int64(b))/256 {
				return 0, false
			}
			v = v*256 + int64(b)
		}
		return v, true
	}
	s := strings.TrimSpace(strings.TrimRight(string(p), "\x00"))
	if s == "" {
		return 0, false
	}
	var n int64
	for _, c := range s {
		if c < '0' || c > '7' || n > (MaxRestoredBytes-int64(c-'0'))/8 {
			return 0, false
		}
		n = n*8 + int64(c-'0')
	}
	return n, true
}
func layerPath(s string, directory bool) (string, bool) {
	for strings.HasPrefix(s, "./") {
		s = strings.TrimPrefix(s, "./")
	}
	if directory {
		s = strings.TrimRight(s, "/")
		if s == "." || s == "" {
			return "", true
		}
	}
	return s, validPath(s)
}
func relevant(name string) bool {
	for _, target := range append(append([]string{}, nativePaths...), environmentPaths...) {
		if name == target || strings.HasPrefix(target, name+"/") {
			return true
		}
	}
	for _, prefix := range append(append([]string{}, forbiddenPrefixes...), legacyHelperPrefixes...) {
		if name == prefix || strings.HasPrefix(name, prefix+"/") || strings.HasPrefix(prefix, name+"/") {
			return true
		}
	}
	return false
}
func (a *archive) applyLayer(l layer, diffID, architecture string, state *layerState, budget *layerBudget) error {
	reader := a.section(l.member)
	var gz *gzip.Reader
	if l.gzip {
		var err error
		gz, err = gzip.NewReader(reader)
		if err != nil {
			return ErrInvalid
		}
		defer gz.Close()
		reader = gz
	}
	guard := &rawTarGuard{ctx: a.ctx, source: reader, budget: budget}
	hash := sha256.New()
	stream := io.TeeReader(guard, hash)
	tr := tar.NewReader(stream)
	var updates []update
	var deletions []whiteout
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return layerError(a.ctx, err)
		}
		if h.Size < 0 || h.Size > MaxRestoredBytes {
			return ErrLimit
		}
		if h.Size > MaxRestoredBytes-budget.logical {
			return ErrLimit
		}
		budget.logical += h.Size
		name, ok := layerPath(h.Name, h.Typeflag == tar.TypeDir)
		if !ok {
			return ErrInvalid
		}
		if name == "" {
			continue
		}
		base := path.Base(name)
		if strings.HasPrefix(base, ".wh.") {
			if h.Typeflag != tar.TypeReg || h.Size != 0 {
				return ErrInvalid
			}
			parent := path.Dir(name)
			if parent == "." {
				parent = ""
			}
			if base == ".wh..wh..opq" {
				deletions = append(deletions, whiteout{parent, true})
			} else {
				leaf := strings.TrimPrefix(base, ".wh.")
				if leaf == "" || leaf == "." || leaf == ".." {
					return ErrInvalid
				}
				target := leaf
				if parent != "" {
					target = parent + "/" + leaf
				}
				deletions = append(deletions, whiteout{target, false})
			}
			continue
		}
		if !relevant(name) {
			continue
		}
		n := node{kind: h.Typeflag, executable: h.Mode&0111 != 0}
		for _, target := range environmentPaths {
			if name == target && h.Typeflag == tar.TypeReg {
				if h.Size > 1<<20 {
					return ErrLimit
				}
				n.data, err = io.ReadAll(tr)
				if err != nil || int64(len(n.data)) != h.Size {
					return layerError(a.ctx, err)
				}
			}
		}
		isNative := false
		for _, target := range nativePaths {
			isNative = isNative || name == target
		}
		if isNative && h.Typeflag == tar.TypeReg {
			digest := sha256.New()
			binary := io.TeeReader(tr, digest)
			if n.executable {
				n.elf = inspectELF(binary, h.Size, architecture)
			}
			if _, err := io.CopyBuffer(io.Discard, binary, make([]byte, 32<<10)); err != nil {
				return layerError(a.ctx, err)
			}
			n.digest = hashString(digest.Sum(nil))
		}
		updates = append(updates, update{name, n})
	}
	// archive/tar stops at the first two zero blocks. Drain through the guard
	// to check gzip CRC, remaining padding, digest and forbidden trailing data.
	if _, err := io.CopyBuffer(io.Discard, stream, make([]byte, 32<<10)); err != nil {
		return layerError(a.ctx, err)
	}
	if guard.at != 0 || guard.remaining != 0 || !guard.sawEnd || hashString(hash.Sum(nil)) != diffID {
		return ErrInvalid
	}
	// Whiteouts describe removals from LOWER layers, regardless of record order
	// relative to new files in this layer. Apply them before this layer's files.
	for _, d := range deletions {
		state.remove(d.name, d.opaque)
	}
	for _, u := range updates {
		if u.node.kind != tar.TypeDir {
			state.remove(u.name, false)
		}
		for parent := path.Dir(u.name); parent != "."; parent = path.Dir(parent) {
			if _, ok := state.nodes[parent]; !ok {
				state.put(parent, node{kind: tar.TypeDir})
			}
		}
		state.put(u.name, u.node)
	}
	return nil
}
func layerError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err == ErrLimit {
		return ErrLimit
	}
	return ErrInvalid
}

type Capabilities struct {
	WorkHistorySchema                      int64
	Environment                            *contracts.PiPackagePreparedEnvironment
	Identity                               Identity
	PackageHelper, ServiceMCP              bool
	PackageHelperSHA256, ServiceMCPSHA256  string
	FileHelper, SnapshotHelper             bool
	FileHelperSHA256, SnapshotHelperSHA256 string
}

func (state *layerState) nativeFile(target string) bool {
	n, ok := state.nodes[target]
	if !ok || n.kind != tar.TypeReg || !n.executable || !n.elf {
		return false
	}
	for parent := path.Dir(target); parent != "."; parent = path.Dir(parent) {
		if p, ok := state.nodes[parent]; !ok || p.kind != tar.TypeDir {
			return false
		}
	}
	return true
}

// Standalone helpers have fixed native entries; no interpreter, legacy source,
// symlink, dynamic ELF or whiteout-deleted executable can satisfy this check.
func InspectNativeHelper(ctx context.Context, reader io.ReaderAt, size int64, expected Identity, kind string) (Capabilities, error) {
	label, target := "piwork.file_protocol", FileHelperPath
	if kind == "snapshot" {
		label, target = "piwork.snapshot_protocol", SnapshotHelperPath
	} else if kind != "file" {
		return Capabilities{}, ErrInvalid
	}
	if !validDigest(expected.ID) || expected.OS != "linux" || expected.Architecture == "" {
		return Capabilities{}, ErrInvalid
	}
	a, err := indexArchive(ctx, reader, size)
	if err != nil {
		return Capabilities{}, err
	}
	config, layers, err := a.selectImage(expected)
	if err != nil {
		return Capabilities{}, err
	}
	if config.Config.Labels[label] != "1" {
		return Capabilities{}, ErrIncompatible
	}
	state, budget := newLayerState(), &layerBudget{}
	for i, layer := range layers {
		if err := a.applyLayer(layer, config.RootFS.DiffIDs[i], expected.Architecture, state, budget); err != nil {
			return Capabilities{}, err
		}
	}
	for name := range state.nodes {
		for _, prefix := range legacyHelperPrefixes {
			if name == prefix || strings.HasPrefix(name, prefix+"/") {
				return Capabilities{}, ErrIncompatible
			}
		}
	}
	if !state.nativeFile(target) {
		return Capabilities{}, ErrIncompatible
	}
	result := Capabilities{Identity: expected}
	if kind == "file" {
		result.FileHelper = true
		result.FileHelperSHA256 = state.nodes[target].digest
	} else {
		result.SnapshotHelper = true
		result.SnapshotHelperSHA256 = state.nodes[target].digest
	}
	return result, nil
}

// InspectNativeAgent validates the selected immutable config/layer identity,
// native capability labels and the final ordinary, executable, static ELF
// files. No ENTRYPOINT, Node, helper, user package or Docker container is run.
func InspectNativeAgent(ctx context.Context, reader io.ReaderAt, size int64, expected Identity) (Capabilities, error) {
	if !validDigest(expected.ID) || expected.OS != "linux" || expected.Architecture == "" {
		return Capabilities{}, ErrInvalid
	}
	a, err := indexArchive(ctx, reader, size)
	if err != nil {
		return Capabilities{}, err
	}
	config, layers, err := a.selectImage(expected)
	if err != nil {
		return Capabilities{}, err
	}
	history := config.Config.Labels["io.piwork.work-history.schema"]
	if config.Config.Labels["io.piwork.agent.protocol"] != "v2" || config.Config.Labels["io.piwork.package-helper.contract"] != "2" || config.Config.Labels["io.piwork.service-mcp.contract"] != "1" || history != "4" && history != "5" || config.Config.Labels["io.piwork.run-model.contract"] != "1" || config.Config.Labels["io.piwork.work-feedback.contract"] != "1" {
		return Capabilities{}, ErrIncompatible
	}
	state := newLayerState()
	budget := &layerBudget{}
	for i, l := range layers {
		if err := a.applyLayer(l, config.RootFS.DiffIDs[i], expected.Architecture, state, budget); err != nil {
			return Capabilities{}, err
		}
	}
	for key := range state.nodes {
		for _, prefix := range forbiddenPrefixes {
			if key == prefix || strings.HasPrefix(key, prefix+"/") {
				return Capabilities{}, ErrIncompatible
			}
		}
	}
	if !state.nativeFile(PackageHelperPath) || !state.nativeFile(ServiceMCPPath) {
		return Capabilities{}, ErrIncompatible
	}
	version := int64(4)
	if history == "5" {
		version = 5
	}
	return Capabilities{Identity: expected, WorkHistorySchema: version, PackageHelper: true, ServiceMCP: true, PackageHelperSHA256: state.nodes[PackageHelperPath].digest, ServiceMCPSHA256: state.nodes[ServiceMCPPath].digest, Environment: state.packageEnvironment(expected)}, nil
}
