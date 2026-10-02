package contracts

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

var ErrEncoding = errors.New("value cannot be encoded safely")

// EncodeCanonicalJSON implements the existing encodeWorkJson contract:
// UTF-8 byte key order, JSON.stringify string/number encoding, no indentation.
func EncodeCanonicalJSON(value any) ([]byte, error) {
	if !wireValue(value) {
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, ErrEncoding
		}
		value, err = ParseJSON(bytes.NewReader(raw), int64(len(raw)+1))
		if err != nil {
			return nil, ErrEncoding
		}
	}
	var output bytes.Buffer
	if err := encodeValue(&output, value, 0); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
func encodeValue(out *bytes.Buffer, value any, depth int) error {
	if depth > MaxJSONDepth {
		return ErrEncoding
	}
	switch v := value.(type) {
	case nil:
		out.WriteString("null")
	case bool:
		out.WriteString(strconv.FormatBool(v))
	case string:
		if !utf8.ValidString(v) {
			return ErrEncoding
		}
		out.WriteByte('"')
		for _, r := range v {
			switch r {
			case '"', '\\':
				out.WriteByte('\\')
				out.WriteRune(r)
			case '\b':
				out.WriteString(`\b`)
			case '\f':
				out.WriteString(`\f`)
			case '\n':
				out.WriteString(`\n`)
			case '\r':
				out.WriteString(`\r`)
			case '\t':
				out.WriteString(`\t`)
			default:
				if r < 0x20 {
					out.WriteString(`\u00`)
					out.WriteString(hex.EncodeToString([]byte{byte(r)}))
				} else {
					out.WriteRune(r)
				}
			}
		}
		out.WriteByte('"')
	case int64:
		if v > MaxSafeInteger || v < -MaxSafeInteger {
			return ErrEncoding
		}
		out.WriteString(strconv.FormatInt(v, 10))
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || (math.Trunc(v) == v && math.Abs(v) > float64(MaxSafeInteger)) {
			return ErrEncoding
		}
		if v == 0 {
			out.WriteByte('0')
			break
		}
		format := byte('f')
		if a := math.Abs(v); a < 1e-6 || a >= 1e21 {
			format = 'e'
		}
		text := strconv.FormatFloat(v, format, -1, 64)
		if i := strings.IndexByte(text, 'e'); i >= 0 {
			power, err := strconv.Atoi(text[i+1:])
			if err != nil {
				return ErrEncoding
			}
			sign := ""
			if power >= 0 {
				sign = "+"
			}
			text = text[:i+1] + sign + strconv.Itoa(power)
		}
		out.WriteString(text)
	case []any:
		out.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := encodeValue(out, item, depth+1); err != nil {
				return err
			}
		}
		out.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := encodeValue(out, key, depth+1); err != nil {
				return err
			}
			out.WriteByte(':')
			if err := encodeValue(out, v[key], depth+1); err != nil {
				return err
			}
		}
		out.WriteByte('}')
	default:
		return ErrEncoding
	}
	return nil
}

// Core private hashes belong to the new Go installation. Separate domains avoid
// accidental reuse of a request digest as a Docker spec/context fence.
func PrivateDigest(domain string, value any) (string, error) {
	if domain == "" || strings.ContainsRune(domain, 0) {
		return "", ErrEncoding
	}
	encoded, err := EncodeCanonicalJSON(value)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	hash.Write([]byte("piwork-go-private-v1\x00" + domain + "\x00"))
	hash.Write(encoded)
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// Context package directory identities use the unprefixed SHA-256 of name bytes.
func PackageNameKey(name string) string {
	digest := sha256.Sum256([]byte(name))
	return hex.EncodeToString(digest[:])
}
