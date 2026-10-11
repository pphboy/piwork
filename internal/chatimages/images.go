// Package chatimages validates bounded private Chat image inputs without decoding pixels.
package chatimages

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash/crc32"
	"strings"
)

const Profile = "chat-images-v1"
const MaxImageBytes = 5 << 20
const MaxTotalBytes = 10 << 20
const MaxRequestBytes = 16 << 20

var ErrInvalid = errors.New("IMAGE_INVALID")
var ErrLimit = errors.New("IMAGE_LIMIT_EXCEEDED")

type Input struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}
type Descriptor struct {
	MimeType string `json:"mimeType"`
	ByteSize int    `json:"byteSize"`
	SHA256   string `json:"sha256"`
}
type Envelope struct {
	Profile string  `json:"profile"`
	Prompt  string  `json:"prompt"`
	Images  []Input `json:"images"`
}

func dimensions(w, h uint32) error {
	if w == 0 || h == 0 {
		return ErrInvalid
	}
	if w > 8192 || h > 8192 || uint64(w)*uint64(h) > 40000000 {
		return ErrLimit
	}
	return nil
}
func ValidateBytes(mime string, b []byte) error {
	if len(b) == 0 {
		return ErrInvalid
	}
	if len(b) > MaxImageBytes {
		return ErrLimit
	}
	switch mime {
	case "image/png":
		if len(b) < 45 || string(b[:8]) != "\x89PNG\r\n\x1a\n" {
			return ErrInvalid
		}
		header, data := false, false
		for p := 8; p+12 <= len(b); {
			n := uint64(binary.BigEndian.Uint32(b[p:]))
			end64 := uint64(p) + 12 + n
			if end64 > uint64(len(b)) {
				return ErrInvalid
			}
			end := int(end64)
			kind := string(b[p+4 : p+8])
			if crc32.ChecksumIEEE(b[p+4:end-4]) != binary.BigEndian.Uint32(b[end-4:]) {
				return ErrInvalid
			}
			if !header && kind != "IHDR" {
				return ErrInvalid
			}
			if kind == "IHDR" {
				if header || n != 13 {
					return ErrInvalid
				}
				if err := dimensions(binary.BigEndian.Uint32(b[p+8:]), binary.BigEndian.Uint32(b[p+12:])); err != nil {
					return err
				}
				header = true
			}
			if kind == "IDAT" {
				data = true
			}
			if kind == "IEND" {
				if n != 0 || !data || end != len(b) {
					return ErrInvalid
				}
				return nil
			}
			p = end
		}
		return ErrInvalid
	case "image/jpeg":
		if len(b) < 4 || b[0] != 255 || b[1] != 216 {
			return ErrInvalid
		}
		p, header, scan := 2, false, false
		for p < len(b) {
			if b[p] != 255 {
				return ErrInvalid
			}
			p++
			for p < len(b) && b[p] == 255 {
				p++
			}
			if p >= len(b) {
				return ErrInvalid
			}
			marker := b[p]
			p++
			if marker == 217 {
				if !header || !scan || p != len(b) {
					return ErrInvalid
				}
				return nil
			}
			if marker == 0 || marker == 216 {
				return ErrInvalid
			}
			if marker >= 208 && marker <= 215 || marker == 1 {
				continue
			}
			if p+2 > len(b) {
				return ErrInvalid
			}
			n := int(binary.BigEndian.Uint16(b[p:]))
			if n < 2 || p+n > len(b) {
				return ErrInvalid
			}
			if marker >= 192 && marker <= 207 && marker != 196 && marker != 200 && marker != 204 {
				if n < 8 {
					return ErrInvalid
				}
				if err := dimensions(uint32(binary.BigEndian.Uint16(b[p+5:])), uint32(binary.BigEndian.Uint16(b[p+3:]))); err != nil {
					return err
				}
				header = true
			}
			p += n
			if marker == 218 {
				scan = true
				for p < len(b) {
					if b[p] != 255 {
						p++
						continue
					}
					if p+1 < len(b) && (b[p+1] == 0 || b[p+1] >= 208 && b[p+1] <= 215) {
						p += 2
						continue
					}
					break
				}
			}
		}
		return ErrInvalid
	case "image/webp":
		if len(b) < 20 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WEBP" || uint64(binary.LittleEndian.Uint32(b[4:]))+8 != uint64(len(b)) {
			return ErrInvalid
		}
		p, image := 12, false
		for p+8 <= len(b) {
			kind := string(b[p : p+4])
			n := uint64(binary.LittleEndian.Uint32(b[p+4:]))
			d := p + 8
			end64 := uint64(d) + n
			if end64+(n&1) > uint64(len(b)) {
				return ErrInvalid
			}
			end := int(end64)
			switch kind {
			case "VP8 ":
				if n < 10 || string(b[d+3:d+6]) != "\x9d\x01\x2a" {
					return ErrInvalid
				}
				if err := dimensions(uint32(binary.LittleEndian.Uint16(b[d+6:])&16383), uint32(binary.LittleEndian.Uint16(b[d+8:])&16383)); err != nil {
					return err
				}
				image = true
			case "VP8L":
				if n < 5 || b[d] != 47 {
					return ErrInvalid
				}
				v := binary.LittleEndian.Uint32(b[d+1:])
				if err := dimensions((v&16383)+1, ((v>>14)&16383)+1); err != nil {
					return err
				}
				image = true
			case "VP8X":
				if n != 10 || b[d]&2 != 0 {
					return ErrInvalid
				}
				u24 := func(v []byte) uint32 { return uint32(v[0]) | uint32(v[1])<<8 | uint32(v[2])<<16 }
				if err := dimensions(u24(b[d+4:])+1, u24(b[d+7:])+1); err != nil {
					return err
				}
			}
			p = end + int(n&1)
		}
		if p != len(b) || !image {
			return ErrInvalid
		}
		return nil
	}
	return ErrInvalid
}
func Validate(images []Input) ([]Descriptor, error) {
	if len(images) > 4 {
		return nil, ErrLimit
	}
	out := make([]Descriptor, 0, len(images))
	total := 0
	for _, image := range images {
		if len(image.Data) > 6990508 || len(image.Data)%4 != 0 {
			return nil, ErrInvalid
		}
		b, err := base64.StdEncoding.Strict().DecodeString(image.Data)
		if err != nil || base64.StdEncoding.EncodeToString(b) != image.Data {
			return nil, ErrInvalid
		}
		total += len(b)
		if total > MaxTotalBytes {
			return nil, ErrLimit
		}
		if err := ValidateBytes(image.MimeType, b); err != nil {
			return nil, err
		}
		sum := sha256.Sum256(b)
		out = append(out, Descriptor{image.MimeType, len(b), hex.EncodeToString(sum[:])})
	}
	return out, nil
}
func InputDigest(prompt string, images []Input) (string, error) {
	payload := []byte(prompt)
	if len(images) > 0 {
		descriptors, err := Validate(images)
		if err != nil {
			return "", err
		}
		items := make([]map[string]any, 0, len(descriptors))
		for _, d := range descriptors {
			items = append(items, map[string]any{"mimeType": d.MimeType, "byteSize": d.ByteSize, "sha256": d.SHA256})
		}
		var buffer bytes.Buffer
		encoder := json.NewEncoder(&buffer)
		encoder.SetEscapeHTML(false)
		err = encoder.Encode(map[string]any{"profile": Profile, "prompt": prompt, "images": items})
		payload = bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
		if err != nil {
			return "", err
		}
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}
func ParseEnvelope(raw string) (Envelope, error) {
	var input Envelope
	if len(raw) > MaxRequestBytes {
		return input, ErrInvalid
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &fields) != nil || len(fields) != 3 || fields["profile"] == nil || fields["images"] == nil || fields["prompt"] == nil || string(fields["prompt"]) == "null" {
		return input, ErrInvalid
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if len(raw) > MaxRequestBytes || dec.Decode(&input) != nil || input.Profile != Profile || len(input.Prompt) > 65536 || len(input.Images) == 0 {
		return input, ErrInvalid
	}
	if _, err := Validate(input.Images); err != nil {
		return input, err
	}
	return input, nil
}
