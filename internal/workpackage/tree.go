package workpackage

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strings"

	"piwork/internal/contracts"
)

type TreeEntry struct {
	SegmentsBase64       []string                 `json:"segmentsBase64"`
	UID                  int64                    `json:"uid"`
	GID                  int64                    `json:"gid"`
	Mode                 int64                    `json:"mode"`
	MtimeNS              string                   `json:"mtimeNs"`
	Type                 string                   `json:"type"`
	Blob                 contracts.WorkBlobDigest `json:"blob,omitempty"`
	Size                 int64                    `json:"size,omitempty"`
	TargetBase64         string                   `json:"targetBase64,omitempty"`
	TargetSegmentsBase64 []string                 `json:"targetSegmentsBase64,omitempty"`
}
type Tree struct {
	Version int64       `json:"version"`
	Entries []TreeEntry `json:"entries"`
}
type ValidTree struct {
	Tree      Tree
	FileBytes int64
	Paths     map[string]TreeEntry
}

var treeTime = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)$`)

func DecodeBase64(encoded string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || base64.StdEncoding.EncodeToString(raw) != encoded {
		return nil, invalid("tree.base64")
	}
	return raw, nil
}
func DecodePath(segments []string, limits Limits) ([]byte, error) {
	if len(segments) > limits.Depth {
		return nil, limit("tree.depth")
	}
	var decoded [][]byte
	size := 0
	for _, segment := range segments {
		raw, err := DecodeBase64(segment)
		if err != nil {
			return nil, err
		}
		if len(raw) == 0 || bytes.ContainsAny(raw, "\x00/") || bytes.Equal(raw, []byte(".")) || bytes.Equal(raw, []byte("..")) {
			return nil, invalid("tree.path")
		}
		decoded = append(decoded, raw)
		size += len(raw)
	}
	if len(decoded) > 0 {
		size += len(decoded) - 1
	}
	if int64(size) > limits.PathBytes {
		return nil, limit("tree.pathBytes")
	}
	return bytes.Join(decoded, []byte("/")), nil
}
func ValidateTree(raw []byte, blobs map[string]contracts.WorkBlob, limits Limits) (result ValidTree, returned error) {
	value, err := parseJSON(raw, limits.MetadataBytes)
	if err != nil {
		return result, err
	}
	object, ok := value.(map[string]any)
	if !ok || len(object) != 2 || object["version"] != int64(1) {
		return result, invalid("tree")
	}
	entries, ok := object["entries"].([]any)
	if !ok || len(entries) == 0 {
		return result, invalid("tree")
	}
	if int64(len(entries)) > limits.Entries {
		return result, limit("tree.entries")
	}
	result.Tree = Tree{Version: 1, Entries: make([]TreeEntry, 0, len(entries))}
	result.Paths = map[string]TreeEntry{}
	var previous []byte
	for index, value := range entries {
		fields, ok := value.(map[string]any)
		if !ok {
			return result, invalid("tree.entry")
		}
		kind, ok := fields["type"].(string)
		if !ok {
			return result, invalid("tree.type")
		}
		keys := []string{"segmentsBase64", "uid", "gid", "mode", "mtimeNs", "type"}
		switch kind {
		case "directory":
		case "file":
			keys = append(keys, "blob", "size")
		case "symlink":
			keys = append(keys, "targetBase64")
		case "hardlink":
			keys = append(keys, "targetSegmentsBase64")
		default:
			return result, invalid("tree.type")
		}
		if len(fields) != len(keys) {
			return result, invalid("tree.entry")
		}
		for _, key := range keys {
			if _, ok := fields[key]; !ok {
				return result, invalid("tree.entry")
			}
		}
		segments, ok := fields["segmentsBase64"].([]any)
		if !ok {
			return result, invalid("tree.path")
		}
		entry := TreeEntry{Type: kind, SegmentsBase64: []string{}}
		for _, segment := range segments {
			encoded, ok := segment.(string)
			if !ok {
				return result, invalid("tree.path")
			}
			entry.SegmentsBase64 = append(entry.SegmentsBase64, encoded)
		}
		for _, property := range []struct {
			key    string
			target *int64
			max    int64
		}{{"uid", &entry.UID, 4294967295}, {"gid", &entry.GID, 4294967295}, {"mode", &entry.Mode, 4095}} {
			n, ok := fields[property.key].(int64)
			if !ok || n < 0 || n > property.max {
				return result, invalid("tree.metadata")
			}
			*property.target = n
		}
		entry.MtimeNS, ok = fields["mtimeNs"].(string)
		if !ok || len(entry.MtimeNS) > 32 || !treeTime.MatchString(entry.MtimeNS) {
			return result, invalid("tree.mtimeNs")
		}
		path, err := DecodePath(entry.SegmentsBase64, limits)
		if err != nil {
			return result, err
		}
		if index == 0 {
			if len(path) != 0 || kind != "directory" {
				return result, invalid("tree.root")
			}
		} else if bytes.Compare(previous, path) >= 0 {
			return result, invalid("tree.order")
		}
		previous = path
		if len(entry.SegmentsBase64) > 0 {
			parent, err := DecodePath(entry.SegmentsBase64[:len(entry.SegmentsBase64)-1], limits)
			if err != nil {
				return result, err
			}
			if result.Paths[string(parent)].Type != "directory" {
				return result, invalid("tree.parent")
			}
		}
		switch kind {
		case "file":
			digest, ok := fields["blob"].(string)
			if !ok {
				return result, invalid("tree.file")
			}
			n, ok := fields["size"].(int64)
			if !ok || n < 0 || n > contracts.MaxSafeInteger {
				return result, invalid("tree.file")
			}
			entry.Blob = contracts.WorkBlobDigest(digest)
			entry.Size = n
			blob, ok := blobs[digest]
			if !ok || int64(blob.Size) != n || !contains(blob.Kinds, "file") {
				return result, invalid("tree.file")
			}
			if n > limits.RestoredBytes-result.FileBytes {
				return result, limit("tree.restoredBytes")
			}
			result.FileBytes += n
		case "symlink":
			encoded, ok := fields["targetBase64"].(string)
			if !ok {
				return result, invalid("tree.symlink")
			}
			entry.TargetBase64 = encoded
			target, err := DecodeBase64(encoded)
			if err != nil {
				return result, err
			}
			if len(target) == 0 || bytes.IndexByte(target, 0) >= 0 {
				return result, invalid("tree.symlink")
			}
			if int64(len(target)) > limits.PathBytes {
				return result, limit("tree.symlink")
			}
		case "hardlink":
			segments, ok := fields["targetSegmentsBase64"].([]any)
			if !ok {
				return result, invalid("tree.hardlink")
			}
			entry.TargetSegmentsBase64 = []string{}
			for _, segment := range segments {
				encoded, ok := segment.(string)
				if !ok {
					return result, invalid("tree.hardlink")
				}
				entry.TargetSegmentsBase64 = append(entry.TargetSegmentsBase64, encoded)
			}
			if _, err := DecodePath(entry.TargetSegmentsBase64, limits); err != nil {
				return result, err
			}
		}
		result.Paths[string(path)] = entry
		result.Tree.Entries = append(result.Tree.Entries, entry)
	}
	for _, entry := range result.Tree.Entries {
		if entry.Type != "hardlink" {
			continue
		}
		path, err := DecodePath(entry.TargetSegmentsBase64, limits)
		if err != nil {
			return result, err
		}
		target, ok := result.Paths[string(path)]
		if !ok || target.Type != "file" {
			return result, invalid("tree.hardlink")
		}
		if entry.UID != target.UID || entry.GID != target.GID || entry.Mode != target.Mode || entry.MtimeNS != target.MtimeNS {
			return result, invalid("tree.hardlinkMetadata")
		}
	}
	return result, nil
}
func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// MarshalJSON emits the exact discriminated union, including a zero file size
// and an empty root path; omitempty cannot express those wire requirements.
func (entry TreeEntry) MarshalJSON() ([]byte, error) {
	fields := map[string]any{"segmentsBase64": entry.SegmentsBase64, "uid": entry.UID, "gid": entry.GID, "mode": entry.Mode, "mtimeNs": entry.MtimeNS, "type": entry.Type}
	switch entry.Type {
	case "file":
		fields["blob"] = entry.Blob
		fields["size"] = entry.Size
	case "symlink":
		fields["targetBase64"] = entry.TargetBase64
	case "hardlink":
		fields["targetSegmentsBase64"] = entry.TargetSegmentsBase64
	}
	return json.Marshal(fields)
}

func safeInventoryPath(value string) bool {
	return value != "" && !strings.HasPrefix(value, "/") && !strings.Contains(value, "\\") && !strings.ContainsRune(value, 0) && !strings.Contains(value, "//") && !strings.HasSuffix(value, "/")
}
