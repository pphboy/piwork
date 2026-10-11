package chatimages

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"os"
	"testing"
)

func TestSharedImageContainers(t *testing.T) {
	raw, err := os.ReadFile("../../fixtures/chat-images/validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Input
		Name         string
		Valid        bool
		PromptDigest string
		Width        *uint32
		Height       uint32
		PaddingBytes int
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			b, _ := base64.StdEncoding.DecodeString(f.Data)
			if f.Width != nil {
				binary.BigEndian.PutUint32(b[16:], *f.Width)
				binary.BigEndian.PutUint32(b[20:], f.Height)
				binary.BigEndian.PutUint32(b[29:], crc32.ChecksumIEEE(b[12:29]))
			}
			if f.PaddingBytes != 0 {
				c := make([]byte, f.PaddingBytes-len(b))
				for i := range c {
					c[i] = 120
				}
				binary.BigEndian.PutUint32(c, uint32(len(c)-12))
				copy(c[4:], "tEXt")
				c[8] = 107
				c[9] = 0
				binary.BigEndian.PutUint32(c[len(c)-4:], crc32.ChecksumIEEE(c[4:len(c)-4]))
				b = append(append(append([]byte{}, b[:len(b)-12]...), c...), b[len(b)-12:]...)
			}
			f.Data = base64.StdEncoding.EncodeToString(b)
			_, err := Validate([]Input{f.Input})
			if (err == nil) != f.Valid {
				t.Fatalf("valid=%v: %v", f.Valid, err)
			}
			if f.Valid {
				got, err := InputDigest("look", []Input{f.Input})
				if err != nil || got != f.PromptDigest {
					t.Fatalf("digest %s: %v", got, err)
				}
			}
		})
	}
}
func TestImageCountAndBase64(t *testing.T) {
	if _, err := Validate(make([]Input, 5)); err != ErrLimit {
		t.Fatal(err)
	}
	if _, err := Validate([]Input{{"image/png", "AAAA\n"}}); err != ErrInvalid {
		t.Fatal(err)
	}
}
