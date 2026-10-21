package coreapp

import (
	"bytes"
	"io"
	"sort"
	"time"
	"unicode/utf8"
)

// secretRedactor replaces exact known secret values while preserving matches
// that span arbitrary write boundaries. It never buffers the whole stream: at
// most maxSecretLen bytes (or a UTF-8 boundary window) stay pending.
type secretRedactor struct {
	target  io.Writer
	secrets [][]byte
	max     int
	pending []byte
	failed  error
}

func newSecretRedactor(target io.Writer, secrets []string) *secretRedactor {
	unique := map[string]bool{}
	list := make([][]byte, 0, len(secrets))
	max := 0
	for _, secret := range secrets {
		if secret == "" || unique[secret] {
			continue
		}
		unique[secret] = true
		list = append(list, []byte(secret))
		if len(secret) > max {
			max = len(secret)
		}
	}
	sort.Slice(list, func(i, j int) bool { return len(list[i]) > len(list[j]) })
	return &secretRedactor{target: target, secrets: list, max: max}
}

var redactedValue = []byte("[redacted]")

func (r *secretRedactor) Write(data []byte) (int, error) {
	if r.failed != nil {
		return 0, r.failed
	}
	r.pending = append(r.pending, data...)
	if err := r.drain(false); err != nil {
		r.failed = err
		return 0, err
	}
	return len(data), nil
}

func (r *secretRedactor) Flush() error {
	if r.failed != nil {
		return r.failed
	}
	return r.drain(true)
}

func (r *secretRedactor) drain(final bool) error {
	carry := r.max - 1
	if carry < 3 {
		carry = 3
	}
	for len(r.pending) > 0 {
		safe := len(r.pending) - carry
		if final {
			safe = len(r.pending)
		}
		if safe <= 0 {
			return nil
		}
		// Do not turn a valid rune into replacement characters by emitting
		// only its prefix. Inspect at most UTFMax-1 preceding bytes; invalid
		// bytes still pass through emit's existing replacement policy.
		for back := 1; back < utf8.UTFMax && back <= safe; back++ {
			start := safe - back
			if utf8.RuneStart(r.pending[start]) {
				_, size := utf8.DecodeRune(r.pending[start:])
				if size > back {
					safe = start
				}
				break
			}
		}
		if safe == 0 {
			return nil
		}
		start, length := r.earliestMatch(safe)
		if start < 0 {
			if err := r.emit(r.pending[:safe]); err != nil {
				return err
			}
			r.pending = r.pending[safe:]
			if final && len(r.pending) > 0 {
				// The remaining bytes are shorter than the carry window; they
				// were emitted above only when safe covered them.
				continue
			}
			return nil
		}
		if err := r.emit(r.pending[:start]); err != nil {
			return err
		}
		if _, err := r.target.Write(redactedValue); err != nil {
			return err
		}
		r.pending = r.pending[start+length:]
		if final && len(r.pending) == 0 {
			return nil
		}
	}
	return nil
}

func (r *secretRedactor) earliestMatch(limit int) (int, int) {
	best, bestLength := -1, 0
	for _, secret := range r.secrets {
		offset := 0
		for offset < limit {
			index := bytes.Index(r.pending[offset:], secret)
			if index < 0 {
				break
			}
			position := offset + index
			if position >= limit {
				break
			}
			if best < 0 || position < best || position == best && len(secret) > bestLength {
				best, bestLength = position, len(secret)
			}
			break
		}
	}
	return best, bestLength
}

func (r *secretRedactor) emit(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	_, err := r.target.Write(bytes.ToValidUTF8(data, []byte("�")))
	return err
}

// dockerTimestampScanner extracts Docker-provided record times without keeping
// complete (possibly very long) lines. It tracks the minimum and maximum time.
type dockerTimestampScanner struct {
	wantTime bool
	token    []byte
	start    time.Time
	end      time.Time
	count    int64
}

func (s *dockerTimestampScanner) Write(data []byte) (int, error) {
	if !s.wantTime && s.start.IsZero() && s.count == 0 {
		s.wantTime = true
	}
	for _, value := range data {
		if s.wantTime {
			switch {
			case value == ' ':
				if parsed, err := time.Parse(time.RFC3339Nano, string(s.token)); err == nil {
					if s.start.IsZero() || parsed.Before(s.start) {
						s.start = parsed
					}
					if s.end.IsZero() || parsed.After(s.end) {
						s.end = parsed
					}
					s.count++
				}
				s.wantTime, s.token = false, nil
			case value == '\n':
				s.wantTime, s.token = true, nil
			case len(s.token) < 64:
				s.token = append(s.token, value)
			default:
				// A malformed timestamp longer than the bounded token window:
				// skip the rest of this record without retaining it.
				s.wantTime, s.token = false, nil
			}
			continue
		}
		if value == '\n' {
			s.wantTime = true
		}
	}
	return len(data), nil
}

func (s *dockerTimestampScanner) rangeStrings() (string, string) {
	if s.start.IsZero() {
		return "", ""
	}
	return s.start.UTC().Format(time.RFC3339Nano), s.end.UTC().Format(time.RFC3339Nano)
}
