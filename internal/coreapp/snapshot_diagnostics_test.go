package coreapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/workpackage"
)

func TestSnapshotAgentsReadsFileBlobWithoutMetadataReinterpretation(t *testing.T) {
	blobs, err := workpackage.OpenBlobDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer blobs.Close()
	for _, item := range []struct {
		raw     []byte
		invalid bool
	}{
		{[]byte("# 中文说明\nkeep original.service.work URL\n"), false},
		{nil, false},
		{[]byte{0xff}, true},
		{bytes.Repeat([]byte("x"), (256<<10)+1), true},
	} {
		stored, err := blobs.Put(context.Background(), bytes.NewReader(item.raw), 1<<20)
		if err != nil {
			t.Fatal(err)
		}
		read, err := readSnapshotAgents(context.Background(), blobs, stored.Digest)
		if item.invalid {
			if err == nil {
				t.Fatal("invalid AGENTS accepted")
			}
			continue
		}
		if err != nil || !bytes.Equal(read, item.raw) {
			t.Fatal("AGENTS bytes lost", err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := readSnapshotAgents(ctx, blobs, stored.Digest); !errors.Is(err, context.Canceled) {
			t.Fatal("cancellation ignored", err)
		}
	}
}

func TestSnapshotOperationKeepsKnownFailureAndRedactsUntrustedMessages(t *testing.T) {
	work := "work-diagnostic-owned"
	for _, code := range []string{"SNAPSHOT_EXPORT_FAILED", "PACKAGE_INVALID", "PACKAGE_INCOMPATIBLE", "TARGET_MODEL_UNAVAILABLE", "QUOTA_EXCEEDED", "SNAPSHOT_CLEANUP_REQUIRED"} {
		errorJSON := string(snapshotRaw(map[string]any{"code": code, "stage": "runtime-prepare", "message": "hostile-password /private/source/context", "remediation": "forged instructions"}))
		view := operationEnvelopeView(corestore.OperationRecord{ID: "operation-diagnostic", WorkID: &work, Kind: "export-work", State: "failed", CreatedAt: packageNow(), UpdatedAt: packageNow(), ErrorJSON: &errorJSON})
		encoded, err := json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := contracts.Decode[contracts.PublicOperation](bytes.NewReader(encoded), "PublicOperationSchema", 64<<10)
		var diagnostic contracts.SafeDiagnostic
		want := code
		if contracts.Validate("DiagnosticCodeSchema", code) != nil {
			want = "WORK_OPERATION_FAILED"
		}
		if err != nil || json.Unmarshal(decoded.Error, &diagnostic) != nil || string(diagnostic.Code) != want {
			var validation *contracts.ValidationError
			if errors.As(err, &validation) {
				t.Log("invalid field:", validation.Field)
			}
			t.Fatal("snapshot root cause disappeared", code, string(encoded), err)
		}
		if strings.Contains(string(encoded), "hostile-password") || strings.Contains(string(encoded), "/private") || strings.Contains(string(encoded), "forged instructions") {
			t.Fatal("untrusted diagnostic escaped", string(encoded))
		}
	}
}
