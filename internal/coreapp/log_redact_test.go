package coreapp

import (
	"bytes"
	"strings"
	"testing"
)

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
