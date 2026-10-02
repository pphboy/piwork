// Package contracts owns native wire validation. Decoding never supplies defaults
// or silently discards unknown fields. Domain operations apply explicit defaults.
package contracts

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"unicode/utf8"
)

const MaxSafeInteger int64 = 9007199254740991
const MaxJSONDepth = 128

var ErrInvalidJSON = errors.New("request body must be valid strict JSON")
var ErrJSONTooLarge = errors.New("request body is too large")

// Field preserves absent, explicit null and an explicitly supplied zero value.
// omitzero is deliberately used instead of omitempty (which loses false/[]).
type Field[T any] struct {
	Present bool
	Null    bool
	Value   T
}

func (f Field[T]) IsZero() bool { return !f.Present }
func (f *Field[T]) UnmarshalJSON(raw []byte) error {
	*f = Field[T]{Present: true, Null: bytes.Equal(bytes.TrimSpace(raw), []byte("null"))}
	if f.Null {
		return nil
	}
	return json.Unmarshal(raw, &f.Value)
}
func (f Field[T]) MarshalJSON() ([]byte, error) {
	if !f.Present || f.Null {
		return []byte("null"), nil
	}
	return json.Marshal(f.Value)
}
func Supplied[T any](value T) Field[T] { return Field[T]{Present: true, Value: value} }

// ParseJSON bounds input and nesting and rejects duplicate decoded property
// names, invalid UTF-8, trailing bytes and integers outside the JS wire range.
// Numbers are normalized before DTO decoding, so 1e3 and 1000 have equal meaning.
func ParseJSON(source io.Reader, maxBytes int64) (any, error) {
	if maxBytes < 1 {
		return nil, ErrJSONTooLarge
	}
	raw, err := io.ReadAll(io.LimitReader(source, maxBytes+1))
	if err != nil {
		return nil, ErrInvalidJSON
	}
	if int64(len(raw)) > maxBytes {
		return nil, ErrJSONTooLarge
	}
	if !utf8.Valid(raw) {
		return nil, ErrInvalidJSON
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := readValue(decoder, 0)
	if err != nil {
		return nil, ErrInvalidJSON
	}
	if _, err = decoder.Token(); err != io.EOF {
		return nil, ErrInvalidJSON
	}
	return value, nil
}

func readValue(d *json.Decoder, depth int) (any, error) {
	if depth > MaxJSONDepth {
		return nil, ErrInvalidJSON
	}
	token, err := d.Token()
	if err != nil {
		return nil, err
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			result := make(map[string]any)
			for d.More() {
				keyToken, err := d.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, ErrInvalidJSON
				}
				if _, exists := result[key]; exists {
					return nil, ErrInvalidJSON
				}
				result[key], err = readValue(d, depth+1)
				if err != nil {
					return nil, err
				}
			}
			end, err := d.Token()
			if err != nil || end != json.Delim('}') {
				return nil, ErrInvalidJSON
			}
			return result, nil
		case '[':
			result := make([]any, 0)
			for d.More() {
				item, err := readValue(d, depth+1)
				if err != nil {
					return nil, err
				}
				result = append(result, item)
			}
			end, err := d.Token()
			if err != nil || end != json.Delim(']') {
				return nil, ErrInvalidJSON
			}
			return result, nil
		}
	case json.Number:
		n, err := strconv.ParseFloat(string(value), 64)
		if err != nil || math.IsInf(n, 0) || math.IsNaN(n) {
			return nil, ErrInvalidJSON
		}
		if math.Trunc(n) == n {
			if math.Abs(n) > float64(MaxSafeInteger) {
				return nil, ErrInvalidJSON
			}
			return int64(n), nil
		}
		return n, nil
	default:
		return token, nil
	}
	return nil, ErrInvalidJSON
}

func Decode[T any](reader io.Reader, schema string, maxBytes int64) (T, error) {
	var result T
	value, err := ParseJSON(reader, maxBytes)
	if err != nil {
		return result, err
	}
	if err = Validate(schema, value); err != nil {
		return result, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return result, ErrInvalidJSON
	}
	if err = json.Unmarshal(raw, &result); err != nil {
		return result, ErrInvalidJSON
	}
	return result, nil
}
