package coreapp

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
)

func TestSecretRedactorShortKnownValuesAcrossChunks(t *testing.T) {
	for _, secret := range []string{"a", "ab", "abc"} {
		for split := 0; split <= len(secret); split++ {
			t.Run(fmt.Sprintf("%d-bytes/split-%d", len(secret), split), func(t *testing.T) {
				var output bytes.Buffer
				r := newSecretRedactor(&output, []string{"", secret, secret})
				for _, chunk := range []string{"API_KEY=" + secret[:split], secret[split:] + "\n"} {
					if _, err := r.Write([]byte(chunk)); err != nil {
						t.Fatal(err)
					}
				}
				if err := r.Flush(); err != nil {
					t.Fatal(err)
				}
				if output.String() != "API_KEY=[redacted]\n" {
					t.Fatalf("short known secret leaked or content changed: %q", output.String())
				}
			})
		}
	}
}

func TestSecretRedactorValidUTF8AcrossChunks(t *testing.T) {
	for _, input := range []string{"A中文Z", "A中文🙂Z"} {
		for _, secrets := range [][]string{nil, {"secret-value"}, {"abc"}} {
			// Include one-byte writes and every two-chunk split, including
			// splits inside a UTF-8 rune and the redactor's carry boundary.
			for split := -1; split <= len(input); split++ {
				var output bytes.Buffer
				r := newSecretRedactor(&output, secrets)
				chunks := []string{input}
				if split >= 0 {
					chunks = []string{input[:split], input[split:]}
				} else {
					chunks = nil
					for i := range len(input) {
						chunks = append(chunks, input[i:i+1])
					}
				}
				for _, chunk := range chunks {
					if _, err := r.Write([]byte(chunk)); err != nil {
						t.Fatal(err)
					}
				}
				if err := r.Flush(); err != nil {
					t.Fatal(err)
				}
				if output.String() != input {
					t.Fatalf("split=%d secrets=%q: got %q want %q", split, secrets, output.String(), input)
				}
			}
		}
	}
}

func TestSecretRedactorPreservesBoundariesAndUTF8(t *testing.T) {
	for secret := range map[string]bool{"super-secret-value": true, "another-token-123": true} {
		for split := 0; split <= len(secret); split++ {
			var output bytes.Buffer
			redactor := newSecretRedactor(&output, []string{secret})
			if _, err := redactor.Write([]byte("before " + secret[:split])); err != nil {
				t.Fatal(err)
			}
			if _, err := redactor.Write([]byte(secret[split:] + " after")); err != nil {
				t.Fatal(err)
			}
			if err := redactor.Flush(); err != nil {
				t.Fatal(err)
			}
			if output.String() != "before [redacted] after" {
				t.Fatalf("split %d leaked or changed text: %q", split, output.String())
			}
		}
	}
	var output bytes.Buffer
	redactor := newSecretRedactor(&output, []string{"super-secret-value", "super-secret-value-longer"})
	if _, err := redactor.Write([]byte("x super-secret-value-longer y super-secret-value z")); err != nil {
		t.Fatal(err)
	}
	if err := redactor.Flush(); err != nil {
		t.Fatal(err)
	}
	if output.String() != "x [redacted] y [redacted] z" {
		t.Fatalf("overlapping secrets not fully removed: %q", output.String())
	}

	output.Reset()
	redactor = newSecretRedactor(&output, nil)
	if _, err := redactor.Write([]byte{'a', 0xff, 'b'}); err != nil {
		t.Fatal(err)
	}
	if err := redactor.Flush(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "�") || !strings.HasPrefix(output.String(), "a") {
		t.Fatalf("invalid UTF-8 not replaced: %q", output.String())
	}
}

func TestDockerTimestampScannerHandlesLongAndSplitLines(t *testing.T) {
	scanner := &dockerTimestampScanner{}
	payload := "2026-10-21T00:00:03Z " + strings.Repeat("x", 200<<10) + "\n" +
		"2026-10-21T00:00:01Z short\n"
	if _, err := scanner.Write([]byte(payload[:100])); err != nil {
		t.Fatal(err)
	}
	if _, err := scanner.Write([]byte(payload[100:])); err != nil {
		t.Fatal(err)
	}
	start, end := scanner.rangeStrings()
	if start != "2026-10-21T00:00:01Z" || end != "2026-10-21T00:00:03Z" || scanner.count != 2 {
		t.Fatalf("unexpected range: %s/%s count=%d", start, end, scanner.count)
	}
}
