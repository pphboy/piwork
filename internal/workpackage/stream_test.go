package workpackage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"runtime"
	"testing"

	"piwork/internal/contracts"
)

type repeatedReader struct {
	size    int64
	largest *int
}

func (r *repeatedReader) Read(raw []byte) (int, error) {
	if r.size == 0 {
		return 0, io.EOF
	}
	if len(raw) > *r.largest {
		*r.largest = len(raw)
	}
	if int64(len(raw)) > r.size {
		raw = raw[:r.size]
	}
	clear(raw)
	r.size -= int64(len(raw))
	return len(raw), nil
}
func TestLargeV1BodyUsesBoundedStreamingMemory(t *testing.T) {
	const size int64 = 128 << 20
	raw, verified := golden(t, "golden")
	spec := verified.Spec
	data := fixtureBlobs(raw, verified)
	largest := 0
	hash := sha256.New()
	if _, err := io.CopyBuffer(hash, &repeatedReader{size, &largest}, make([]byte, 1<<20)); err != nil {
		t.Fatal(err)
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	volume := Volumes(spec)[1]
	var tree Tree
	if err := json.Unmarshal(data[string(volume.Tree)], &tree); err != nil {
		t.Fatal(err)
	}
	var old string
	for i := range tree.Entries {
		if tree.Entries[i].Type == "file" && tree.Entries[i].Size > 0 {
			old = string(tree.Entries[i].Blob)
			tree.Entries[i].Blob = contracts.WorkBlobDigest(digest)
			tree.Entries[i].Size = size
			break
		}
	}
	if old == "" {
		t.Fatal("workspace fixture file missing")
	}
	var kept []contracts.WorkBlob
	for _, blob := range spec.Blobs {
		if string(blob.Digest) != old && blob.Digest != volume.Tree {
			kept = append(kept, blob)
		}
	}
	spec.Blobs = kept
	spec.Blobs = append(spec.Blobs, contracts.WorkBlob{Digest: contracts.WorkBlobDigest(digest), Size: contracts.WorkByteSize(size), Kinds: []string{"file"}})
	treeBytes, err := contracts.EncodeCanonicalJSON(tree)
	if err != nil {
		t.Fatal(err)
	}
	treeDigest := appendFixtureBlob(&spec, data, treeBytes, "tree")
	volume.Tree = contracts.WorkBlobDigest(treeDigest)
	for i, original := range Volumes(spec) {
		if original.Tree != Volumes(verified.Spec)[1].Tree {
			continue
		}
		original.Tree = volume.Tree
		spec.Volumes[i], err = json.Marshal(original)
		if err != nil {
			t.Fatal(err)
		}
	}
	manifest, err := contracts.EncodeCanonicalJSON(spec)
	if err != nil {
		t.Fatal(err)
	}
	var header [16]byte
	copy(header[:8], Magic)
	binary.BigEndian.PutUint64(header[8:], uint64(len(manifest)))
	readers := []io.Reader{bytes.NewReader(header[:]), bytes.NewReader(manifest)}
	largest = 0
	for _, blob := range spec.Blobs {
		if string(blob.Digest) == digest {
			readers = append(readers, &repeatedReader{size, &largest})
		} else {
			readers = append(readers, bytes.NewReader(data[string(blob.Digest)]))
		}
	}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	result, err := Read(context.Background(), io.MultiReader(readers...), ReadOptions{})
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(Code(err), err)
	}
	if result.Size < size || largest > 1<<20 {
		t.Fatal("body not streamed in bounded chunks", result.Size, largest)
	}
	if allocated := after.TotalAlloc - before.TotalAlloc; allocated > 16<<20 {
		t.Fatal("memory grew with 128 MiB file body", allocated)
	}
}
