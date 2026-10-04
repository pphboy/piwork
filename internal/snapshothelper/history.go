package snapshothelper

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/workhistory"
	"piwork/internal/workpackage"
)

var scopeID = regexp.MustCompile(`^[a-zA-Z0-9-]{16,128}$`)

type historyRequest struct {
	Models       []map[string]any  `json:"models,omitempty"`
	Operations   map[string]string `json:"operations,omitempty"`
	SourceWorkID string            `json:"sourceWorkId"`
	ContextIDs   []string          `json:"contextIds"`
	TargetWorkID string            `json:"targetWorkId,omitempty"`
	Contexts     []struct {
		SourceID string `json:"sourceId"`
		TargetID string `json:"targetId"`
	} `json:"contexts,omitempty"`
}

func readRequest(spool string) (historyRequest, error) {
	var request historyRequest
	fd, err := workpackage.OpenDirectoryFD(spool)
	if err != nil {
		return request, workhistory.ErrInvalid
	}
	defer unix.Close(fd)
	file, err := workhistory.Regular(fd, "history-request.json")
	if err != nil {
		return request, workhistory.ErrInvalid
	}
	defer file.Close()
	parsed, err := contracts.ParseJSON(file, workpackage.DefaultLimits.MetadataBytes)
	if err != nil {
		return request, workhistory.ErrInvalid
	}
	object, ok := parsed.(map[string]any)
	if !ok {
		return request, workhistory.ErrInvalid
	}
	for key := range object {
		switch key {
		case "sourceWorkId", "contextIds", "targetWorkId", "contexts", "models", "operations":
		default:
			return request, workhistory.ErrInvalid
		}
	}
	if _, ok := object["contextIds"].([]any); !ok {
		return request, workhistory.ErrInvalid
	}
	raw, err := json.Marshal(parsed)
	if err != nil || json.Unmarshal(raw, &request) != nil || !scopeID.MatchString(request.SourceWorkID) {
		return request, workhistory.ErrInvalid
	}
	seen := map[string]bool{}
	for _, id := range request.ContextIDs {
		if !scopeID.MatchString(id) || seen[id] {
			return request, workhistory.ErrInvalid
		}
		seen[id] = true
	}
	if value, exists := object["targetWorkId"]; exists {
		if _, ok := value.(string); !ok || !scopeID.MatchString(request.TargetWorkID) {
			return request, workhistory.ErrInvalid
		}
	}
	if value, exists := object["contexts"]; exists {
		items, ok := value.([]any)
		if !ok {
			return request, workhistory.ErrInvalid
		}
		for _, item := range items {
			row, ok := item.(map[string]any)
			if !ok || len(row) != 2 {
				return request, workhistory.ErrInvalid
			}
			a, okA := row["sourceId"].(string)
			b, okB := row["targetId"].(string)
			if !okA || !okB || !scopeID.MatchString(a) || !scopeID.MatchString(b) {
				return request, workhistory.ErrInvalid
			}
		}
	}
	if value, exists := object["models"]; exists {
		items, ok := value.([]any)
		if !ok || len(items) > 256 {
			return request, workhistory.ErrInvalid
		}
		refs := map[string]bool{}
		for _, item := range items {
			m, ok := item.(map[string]any)
			if !ok {
				return request, workhistory.ErrInvalid
			}
			public := map[string]any{}
			for k, v := range m {
				if k != "baseUrl" {
					public[k] = v
				}
			}
			ref, ok := m["modelRef"].(string)
			if !ok || refs[ref] || contracts.Validate("RunModelDescriptionSchema", public) != nil {
				return request, workhistory.ErrInvalid
			}
			refs[ref] = true
			if v, exists := m["baseUrl"]; exists {
				endpoint, ok := v.(string)
				if !ok {
					return request, workhistory.ErrInvalid
				}
				if _, err := contracts.NormalizeModelEndpoint(&endpoint); err != nil {
					return request, workhistory.ErrInvalid
				}
			}
		}
	}
	if value, exists := object["operations"]; exists {
		items, ok := value.(map[string]any)
		if !ok || len(items) > 100000 {
			return request, workhistory.ErrInvalid
		}
		seen := map[string]bool{}
		for source, v := range items {
			target, ok := v.(string)
			if !ok || !scopeID.MatchString(source) || !scopeID.MatchString(target) || seen[target] {
				return request, workhistory.ErrInvalid
			}
			seen[target] = true
		}
	}

	return request, nil
}
func verifyVolumeHistory(ctx context.Context, volume, spool string, restore bool) (any, error) {
	request, err := readRequest(spool)
	if err != nil {
		return nil, err
	}
	contexts := map[string]bool{}
	for _, id := range request.ContextIDs {
		contexts[id] = true
	}
	snapshot, err := workhistory.Open(ctx, volume, workhistory.Scope{SourceWorkID: request.SourceWorkID, ContextIDs: contexts, ScratchDirectory: spool})
	if err != nil {
		return nil, err
	}
	summary := workhistory.Summary{}
	if snapshot != nil {
		defer snapshot.Close()
		summary = snapshot.Summary
	}
	if restore {
		if request.TargetWorkID == "" || request.Contexts == nil {
			return nil, workhistory.ErrInvalid
		}
		mapping := map[string]string{}
		for _, item := range request.Contexts {
			if _, exists := mapping[item.SourceID]; exists {
				return nil, workhistory.ErrInvalid
			}
			mapping[item.SourceID] = item.TargetID
		}
		if snapshot != nil {
			if err := snapshot.Rebuild(ctx, volume, request.TargetWorkID, mapping, workhistory.RestoreBindings{Models: request.Models, Operations: request.Operations}); err != nil {
				return nil, err
			}
		}
	}
	return struct {
		HistoryPresent bool `json:"historyPresent"`
		workhistory.Summary
	}{snapshot != nil, summary}, nil
}
func verifyPackageHistory(ctx context.Context, verified workpackage.Verified, openBlob func(contracts.WorkBlob) (io.ReadCloser, error), spool string) error {
	spec := verified.Spec
	var identities contracts.WorkSourceIdentityMap
	if json.Unmarshal(verified.Metadata[string(spec.History.SourceIdentityMap)], &identities) != nil {
		return workhistory.ErrInvalid
	}
	descriptors := map[string]contracts.WorkBlob{}
	for _, blob := range spec.Blobs {
		descriptors[string(blob.Digest)] = blob
	}
	tree, err := workpackage.ValidateTree(verified.Metadata[string(workpackage.Volumes(spec)[0].Tree)], descriptors, workpackage.DefaultLimits)
	if err != nil {
		return err
	}
	regular := func(name string) (workpackage.TreeEntry, bool) {
		entry, ok := tree.Paths[name]
		if ok && entry.Type == "hardlink" {
			target, err := workpackage.DecodePath(entry.TargetSegmentsBase64, workpackage.DefaultLimits)
			if err != nil {
				return workpackage.TreeEntry{}, false
			}
			entry, ok = tree.Paths[string(target)]
		}
		return entry, ok && entry.Type == "file"
	}
	main, hasMain := tree.Paths["work.sqlite"]
	if hasMain {
		_, hasMain = regular("work.sqlite")
		if !hasMain || main.Type != "file" && main.Type != "hardlink" {
			return workhistory.ErrInvalid
		}
	}
	if !hasMain {
		_, wal := tree.Paths["work.sqlite-wal"]
		_, shm := tree.Paths["work.sqlite-shm"]
		if wal || shm || string(spec.ActiveContext) != "null" {
			return workhistory.ErrInvalid
		}
	}
	spoolFD, err := workpackage.OpenDirectoryFD(spool)
	if err != nil {
		return err
	}
	defer unix.Close(spoolFD)
	temporary, err := os.MkdirTemp(fmt.Sprintf("/proc/self/fd/%d", spoolFD), "verify-history-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	for _, name := range []string{"work.sqlite", "work.sqlite-wal", "work.sqlite-shm"} {
		_, exists := tree.Paths[name]
		if !exists {
			continue
		}
		entry, ok := regular(name)
		if !ok {
			return workhistory.ErrInvalid
		}
		source, err := openBlob(descriptors[string(entry.Blob)])
		if err != nil {
			return err
		}
		target, err := os.OpenFile(filepath.Join(temporary, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, 0600)
		if err != nil {
			source.Close()
			return err
		}
		hash := sha256.New()
		n, err := io.CopyBuffer(io.MultiWriter(target, hash), io.LimitReader(contextReader{ctx, source}, entry.Size+1), make([]byte, 1<<20))
		source.Close()
		if err == nil {
			err = target.Sync()
		}
		closeErr := target.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if n != entry.Size || hex.EncodeToString(hash.Sum(nil)) != string(entry.Blob) {
			return workhistory.ErrInvalid
		}
	}
	contexts := map[string]bool{}
	for _, c := range identities.Contexts {
		contexts[string(c.SourceId)] = true
	}
	snapshot, err := workhistory.Open(ctx, filepath.Join(spool, filepath.Base(temporary)), workhistory.Scope{SourceWorkID: string(identities.SourceWorkId), ContextIDs: contexts, ScratchDirectory: spool, SDKPathIsRegular: func(path string) bool {
		if !strings.HasPrefix(path, "/var/data/sessions/") {
			return false
		}
		relative := strings.TrimPrefix(path, "/var/data/")
		for _, part := range strings.Split(relative, "/") {
			if part == "" || part == "." || part == ".." || strings.ContainsRune(part, 0) {
				return false
			}
		}
		_, ok := regular(relative)
		return ok
	}})
	if snapshot != nil {
		defer snapshot.Close()
	}
	return err
}

type contextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r contextReader) Read(raw []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(raw)
}
func historyCode(err error) string {
	var history *workhistory.Error
	if errors.As(err, &history) {
		return history.Code
	}
	var pack *workpackage.ValidationError
	if errors.As(err, &pack) {
		return pack.Code
	}
	return "SNAPSHOT_HISTORY_INVALID"
}
func verifyUploadedPackage(ctx context.Context, spool string) (any, error) {
	root, err := workpackage.OpenDirectoryFD(spool)
	if err != nil {
		return nil, err
	}
	defer unix.Close(root)
	file, err := workhistory.Regular(root, "package.work")
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var before unix.Stat_t
	if unix.Fstat(int(file.Fd()), &before) != nil {
		return nil, workhistory.ErrInvalid
	}
	// Read validates every blob hash and records bounded archive offsets. Use
	// those sections directly: duplicating image blobs into a tmpfs spool can
	// exhaust the helper's memory limit even though validation itself streams.
	verified, err := workpackage.Read(ctx, file, workpackage.ReadOptions{})
	if err != nil {
		return nil, err
	}
	openBlob := verified.Open(file)
	if err := workpackage.ValidatePackageContent(ctx, verified, openBlob); err != nil {
		return nil, err
	}
	if err := workpackage.ValidateImages(ctx, verified, file); err != nil {
		return nil, err
	}
	if err := verifyPackageHistory(ctx, verified, openBlob, spool); err != nil {
		return nil, err
	}
	var after unix.Stat_t
	if unix.Fstat(int(file.Fd()), &after) != nil || before.Dev != after.Dev || before.Ino != after.Ino || before.Size != after.Size || before.Mode != after.Mode || before.Uid != after.Uid || before.Gid != after.Gid || before.Nlink != after.Nlink || before.Mtim != after.Mtim || before.Ctim != after.Ctim {
		return nil, workhistory.ErrInvalid
	}
	return struct {
		Digest              string                            `json:"digest"`
		Size                int64                             `json:"size"`
		BindingRequirements contracts.WorkBindingRequirements `json:"bindingRequirements"`
	}{verified.Digest, verified.Size, verified.Spec.Bindings}, nil
}
