package imagestatic

import (
	"bytes"
	"context"
	"io"
	"testing"
)

func TestCaptureNormalizesDockerAndCompressedOCIWithoutExecuting(t *testing.T) {
	for _, oci := range []bool{false, true} {
		data, id := makeImage(t, oci, oci, [][]byte{nativeLayer(t)}, nil)
		blobs := map[string][]byte{}
		result, err := CapturePortableImage(context.Background(), bytes.NewReader(data), int64(len(data)), id, func(reader io.Reader, maximum int64) (CapturedBlob, error) {
			raw, err := io.ReadAll(io.LimitReader(reader, maximum+1))
			if err != nil {
				return CapturedBlob{}, err
			}
			digest := digestBytes(raw)[7:]
			blobs[digest] = raw
			return CapturedBlob{digest, int64(len(raw))}, nil
		})
		if err != nil {
			t.Fatal(oci, err)
		}
		if len(result.Layers) != 1 || !bytes.Equal(blobs[result.Layers[0].Digest], nativeLayer(t)) {
			t.Fatal("original layer changed")
		}
		_, err = InspectPortableImage(context.Background(), blobs[result.Config.Digest], []PortableLayer{{Reader: bytes.NewReader(blobs[result.Layers[0].Digest]), Size: result.Layers[0].Size}}, id, true)
		if err != nil {
			t.Fatal("normalized image differs", err)
		}
	}
}
