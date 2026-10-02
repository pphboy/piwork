package contracts

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"hash"
	"io"
	"path"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

type DigestEntry struct {
	Path   string
	Type   string
	Mode   uint32
	Size   int64
	Target string
	// Open must return an already verified no-follow regular file source.
	// Hashing streams its exact declared size and always closes the source.
	Open func() (io.ReadCloser, error)
}

func validTreePath(name string) bool {
	if !utf8.ValidString(name) || name == "" || strings.ContainsAny(name, "\\\x00") || strings.HasPrefix(name, "/") || path.Clean(name) != name {
		return false
	}
	for _, segment := range strings.Split(name, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}
func digestField(hash hash.Hash, value string) {
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(value)))
	hash.Write(size[:])
	hash.Write([]byte(value))
}
func digestFile(hash hash.Hash, entry DigestEntry) error {
	if entry.Size < 0 || entry.Open == nil {
		return ErrEncoding
	}
	source, err := entry.Open()
	if err != nil {
		return ErrEncoding
	}
	count, copyErr := io.CopyN(hash, source, entry.Size)
	var extra [1]byte
	extraCount, extraErr := source.Read(extra[:])
	closeErr := source.Close()
	if copyErr != nil || count != entry.Size || extraCount != 0 || extraErr != io.EOF || closeErr != nil {
		return ErrEncoding
	}
	return nil
}

// Skill order uses JS UTF-16 comparison, not the UTF-8 order of Pi package trees.
func jsLess(left, right string) bool {
	a, b := utf16.Encode([]rune(left)), utf16.Encode([]rune(right))
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return len(a) < len(b)
}
func SkillDigest(entries []DigestEntry) (string, error) {
	files := make([]DigestEntry, 0, len(entries))
	seen := make(map[string]bool)
	manifest := false
	var total int64
	for _, entry := range entries {
		if !validTreePath(entry.Path) || seen[entry.Path] {
			return "", ErrEncoding
		}
		seen[entry.Path] = true
		if entry.Type == "directory" {
			continue
		}
		if entry.Type != "file" || entry.Size < 0 || entry.Size > 8<<20 {
			return "", ErrEncoding
		}
		total += entry.Size
		if total > 32<<20 {
			return "", ErrEncoding
		}
		if entry.Path == "SKILL.md" {
			manifest = true
		}
		files = append(files, entry)
	}
	if !manifest || len(files) > 2048 {
		return "", ErrEncoding
	}
	sort.Slice(files, func(i, j int) bool { return jsLess(files[i].Path, files[j].Path) })
	digest := sha256.New()
	for _, file := range files {
		digestField(digest, file.Path)
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(file.Size))
		digest.Write(size[:])
		if err := digestFile(digest, file); err != nil {
			return "", err
		}
	}
	return "sha256:" + hex.EncodeToString(digest.Sum(nil)), nil
}

func PiPackageDigest(entries []DigestEntry) (string, error) {
	tree := append([]DigestEntry(nil), entries...)
	known := make(map[string]DigestEntry)
	for _, entry := range tree {
		if !validTreePath(entry.Path) {
			return "", ErrEncoding
		}
		if _, exists := known[entry.Path]; exists {
			return "", ErrEncoding
		}
		known[entry.Path] = entry
		if entry.Type != "file" && entry.Type != "directory" && entry.Type != "symlink" {
			return "", ErrEncoding
		}
		if entry.Type == "symlink" {
			if !utf8.ValidString(entry.Target) || entry.Target == "" || strings.ContainsAny(entry.Target, "\\\x00") || strings.HasPrefix(entry.Target, "/") {
				return "", ErrEncoding
			}
		}
	}
	for _, entry := range tree {
		if entry.Type == "symlink" {
			if !validLink(known, entry.Path, entry.Target) {
				return "", ErrEncoding
			}
		}
	}
	sort.Slice(tree, func(i, j int) bool { return tree[i].Path < tree[j].Path })
	digest := sha256.New()
	digest.Write([]byte("piwork-pi-package-tree-v1\x00"))
	for _, entry := range tree {
		mode := uint32(0755)
		if entry.Type == "file" && entry.Mode&0111 == 0 {
			mode = 0644
		}
		if entry.Type == "symlink" {
			mode = 0777
		}
		digestField(digest, entry.Path)
		digestField(digest, entry.Type)
		digestField(digest, strconv.FormatUint(uint64(mode), 8))
		switch entry.Type {
		case "file":
			digestField(digest, strconv.FormatInt(entry.Size, 10))
			if err := digestFile(digest, entry); err != nil {
				return "", err
			}
		case "symlink":
			digestField(digest, entry.Target)
		}
	}
	return "sha256:" + hex.EncodeToString(digest.Sum(nil)), nil
}
func validLink(known map[string]DigestEntry, name, target string) bool {
	current := path.Join(path.Dir(name), target)
	for attempts := 0; attempts < 128; attempts++ {
		if current == "." {
			return true
		}
		if !validTreePath(current) {
			return false
		}
		parts := strings.Split(current, "/")
		rewritten := false
		for i := range parts {
			prefix := strings.Join(parts[:i+1], "/")
			entry, exists := known[prefix]
			if !exists {
				return false
			}
			if entry.Type == "symlink" {
				current = path.Join(path.Dir(prefix), entry.Target, strings.Join(parts[i+1:], "/"))
				rewritten = true
				break
			}
			if i < len(parts)-1 && entry.Type != "directory" {
				return false
			}
		}
		if !rewritten {
			return true
		}
	}
	return false
}
