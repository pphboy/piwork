package coreapp

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func packageZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var body bytes.Buffer
	writer := zip.NewWriter(&body)
	for name, value := range entries {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(file, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes()
}

func TestWorkPackageUploadKeepsOwnerAndScope(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "package-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	other, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "package-other", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: "work-package-upload", OwnerUserID: string(owner.Id), Name: "Package upload", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	ownerLogin, err := a.Identity.Login(ctx, "package-owner", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	otherLogin, err := a.Identity.Login(ctx, "package-other", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	data := packageZip(t, map[string]string{"package.json": `{"name":"work-tools","version":"1.0.0"}`})
	sum := sha256.Sum256(data)
	request := func(auth string) (int, map[string]any) {
		t.Helper()
		wire, err := http.NewRequest(http.MethodPost, base+"/api/v1/works/work-package-upload/package-uploads", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		wire.Header.Set("Authorization", auth)
		wire.Header.Set("Content-Type", "application/zip")
		wire.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
		wire.Header.Set("X-Piwork-Package-Source", "local")
		wire.Header.Set("X-Piwork-Package-Name", "local-tools")
		response, err := http.DefaultClient.Do(wire)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result map[string]any
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, result
	}
	if status, result := request("Bearer " + otherLogin.Token); status != 404 || result["code"] != "NOT_FOUND" {
		t.Fatal("foreign Work upload was visible", status, result)
	}
	status, result := request("Bearer " + ownerLogin.Token)
	if status != 201 {
		t.Fatal("Work upload failed", status, result)
	}
	id := result["uploadId"].(string)
	var stored corestore.PackageUpload
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		stored, err = corestore.ReadPackageUpload(tx, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if stored.ActorID != string(owner.Id) || stored.WorkID == nil || *stored.WorkID != "work-package-upload" || stored.ScopeKind != "work" || stored.SourceKind != "local" || stored.State != "ready" || stored.ActorID == string(other.Id) {
		t.Fatal("Work upload scope was not captured", stored)
	}
}

func TestPackageUploadAuthenticatesBeforeBody(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	for _, path := range []string{"/api/v1/admin/package-uploads", "/control/package-uploads", "/api/v1/works/work-a/package-uploads"} {
		body := &countedUploadBody{}
		request := httptest.NewRequest(http.MethodPost, path, body)
		response := httptest.NewRecorder()
		a.route(response, request)
		if response.Code != http.StatusUnauthorized || body.reads != 0 {
			t.Fatal("unauthorized package upload read request bytes", path, response.Code, body.reads)
		}
	}
}

func TestCorePackageUploadValidatesAndStoresImmutableZip(t *testing.T) {
	a, base, operator := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	valid := packageZip(t, map[string]string{"package.json": `{"name":"@example/tools","version":"1.0.0"}`, "extensions/tool.js": "throw new Error('must not run')"})
	unsafe := packageZip(t, map[string]string{"package.json": `{"name":"@example/tools","version":"1.0.0"}`, "../outside": "unsafe"})
	upload := func(path, authorization string, data []byte, digest string) (int, map[string]any) {
		t.Helper()
		request, err := http.NewRequest(http.MethodPost, base+path, bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", authorization)
		request.Header.Set("Content-Type", "application/zip")
		request.Header.Set("X-Piwork-Sha256", digest)
		request.Header.Set("X-Piwork-Package-Source", "zip")
		request.Header.Set("X-Piwork-Package-Name", "tools.zip")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result map[string]any
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, result
	}
	sum := sha256.Sum256(valid)
	validDigest := hex.EncodeToString(sum[:])
	if status, result := upload("/api/v1/admin/package-uploads", "Bearer "+login.Token, valid, validDigest); status != 201 {
		t.Fatal("valid package upload failed", status, result)
	} else {
		id, ok := result["uploadId"].(string)
		if !ok || id == "" {
			t.Fatal("missing upload ID", result)
		}
		var stored corestore.PackageUpload
		if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
			var err error
			stored, err = corestore.ReadPackageUpload(tx, id)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if stored.ActorID != login.User.ID || stored.ScopeKind != "core" || stored.State != "ready" || stored.Digest == nil || *stored.Digest != "sha256:"+validDigest {
			t.Fatal("uploaded package was not scoped or persisted", stored)
		}
	}
	if status, result := upload("/control/package-uploads", "Operator "+operator, valid, validDigest); status != 201 {
		t.Fatal("operator package upload failed", status, result)
	}
	if status, result := upload("/api/v1/admin/package-uploads", "Bearer "+login.Token, valid, hex.EncodeToString(make([]byte, 32))); status != 400 || result["code"] != "PI_PACKAGE_INVALID_SOURCE" {
		t.Fatal("bad digest was accepted", status, result)
	}
	unsafeSum := sha256.Sum256(unsafe)
	if status, result := upload("/api/v1/admin/package-uploads", "Bearer "+login.Token, unsafe, hex.EncodeToString(unsafeSum[:])); status != 400 || result["code"] != "PI_PACKAGE_UNSAFE_ARCHIVE" {
		t.Fatal("unsafe archive was accepted", status, result)
	}
}

func TestPackageUploadRevokedDuringStreamCannotPublish(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	data := packageZip(t, map[string]string{"package.json": `{"name":"revocation-tools","version":"1.0.0"}`})
	sum := sha256.Sum256(data)
	read, write := io.Pipe()
	request, err := http.NewRequest(http.MethodPost, base+"/api/v1/admin/package-uploads", read)
	if err != nil {
		t.Fatal(err)
	}
	request.ContentLength = int64(len(data))
	request.Header.Set("Authorization", "Bearer "+login.Token)
	request.Header.Set("Content-Type", "application/zip")
	request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
	request.Header.Set("X-Piwork-Package-Source", "zip")
	request.Header.Set("X-Piwork-Package-Name", "revocation.zip")
	responseCh := make(chan *http.Response, 1)
	errorCh := make(chan error, 1)
	go func() {
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			errorCh <- err
			return
		}
		responseCh <- response
	}()
	if _, err := write.Write(data[:len(data)/2]); err != nil {
		t.Fatal(err)
	}
	if err := a.Identity.Logout(ctx, login.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := write.Write(data[len(data)/2:]); err != nil {
		t.Fatal(err)
	}
	if err := write.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errorCh:
		t.Fatal(err)
	case response := <-responseCh:
		defer response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatal("revoked upload was published", response.StatusCode)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not finish after its session was revoked")
	}
	var count int
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT count(*) FROM pi_package_uploads WHERE actor_id=?`, login.User.ID).Scan(&count)
	}); err != nil || count != 0 {
		t.Fatal("revoked upload became reusable", err, count)
	}
}

func TestPackageUploadsRunTwoIndependentStreamsAndRejectThird(t *testing.T) {
	a, base, operator := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	data := packageZip(t, map[string]string{"package.json": `{"name":"parallel-tools","version":"1.0.0"}`})
	sum := sha256.Sum256(data)
	makeRequest := func(reader io.Reader) *http.Request {
		t.Helper()
		request, err := http.NewRequest("POST", base+"/control/package-uploads", reader)
		if err != nil {
			t.Fatal(err)
		}
		request.ContentLength = int64(len(data))
		request.Header.Set("Authorization", "Operator "+operator)
		request.Header.Set("Content-Type", "application/zip")
		request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
		request.Header.Set("X-Piwork-Package-Source", "zip")
		request.Header.Set("X-Piwork-Package-Name", "tools.zip")
		return request
	}
	results := make(chan *http.Response, 2)
	failures := make(chan error, 2)
	writers := []*io.PipeWriter{}
	for i := 0; i < 2; i++ {
		reader, writer := io.Pipe()
		writers = append(writers, writer)
		defer writer.Close()
		request := makeRequest(reader)
		go func() {
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				failures <- err
			} else {
				results <- response
			}
		}()
		if _, err := writer.Write(data[:len(data)/2]); err != nil {
			t.Fatal(err)
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for a.packageUploads.Load() != 2 {
		if time.Now().After(deadline) {
			t.Fatal("two uploads did not enter transfer concurrently", a.packageUploads.Load())
		}
		time.Sleep(time.Millisecond)
	}
	response, err := http.DefaultClient.Do(makeRequest(bytes.NewReader(data)))
	if err != nil {
		t.Fatal(err)
	}
	var rejection map[string]any
	json.NewDecoder(response.Body).Decode(&rejection)
	response.Body.Close()
	if response.StatusCode != 429 || rejection["code"] != "RATE_LIMITED" {
		t.Fatal("third upload bypassed limit", response.StatusCode, rejection)
	}
	for _, writer := range writers {
		if _, err := writer.Write(data[len(data)/2:]); err != nil {
			t.Fatal(err)
		}
		writer.Close()
	}
	ids := map[string]bool{}
	for i := 0; i < 2; i++ {
		select {
		case err := <-failures:
			t.Fatal(err)
		case response := <-results:
			var body map[string]any
			json.NewDecoder(response.Body).Decode(&body)
			response.Body.Close()
			if response.StatusCode != 201 || body["uploadId"] == nil {
				t.Fatal("parallel upload collided", response.StatusCode, body)
			}
			id := body["uploadId"].(string)
			if ids[id] {
				t.Fatal("uploads shared identity")
			}
			ids[id] = true
		case <-time.After(5 * time.Second):
			t.Fatal("parallel upload did not finish")
		}
	}
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM pi_package_uploads WHERE state='ready'`).Scan(&count); err != nil {
			return err
		}
		if count != 2 {
			t.Fatal("partial upload publication", count)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPackageUploadRecoveryRemovesOnlyUnacceptedFiles(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	root, err := a.Store.OpenPackageUploadsRoot()
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string) {
		t.Helper()
		file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte("abandoned")); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	write("upload-00000000-0000-0000-0000-000000000001.staging")
	write("upload-00000000-0000-0000-0000-000000000002.zip")
	write("upload-00000000-0000-0000-0000-000000000004.zip")
	write("upload-00000000-0000-0000-0000-000000000005.zip")
	if err := root.EnsureDirectory("upload-00000000-0000-0000-0000-000000000003.inspection"); err != nil {
		t.Fatal(err)
	}
	expired := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)
	digest := "sha256:" + strings.Repeat("a", 64)
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		for _, id := range []string{"upload-00000000-0000-0000-0000-000000000004", "upload-00000000-0000-0000-0000-000000000005"} {
			if err := corestore.InsertPackageUpload(tx, corestore.PackageUpload{ID: id, ActorID: "operator", ScopeKind: "core", SourceKind: "zip", DisplayName: "fixture.zip", Digest: &digest, Size: 9, State: "ready", ExpiresAt: &expired, CreatedAt: expired}); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`UPDATE pi_package_uploads SET lease_count=1 WHERE id='upload-00000000-0000-0000-0000-000000000005'`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}
	if err := a.recoverPackageUploadFiles(context.Background()); err != nil {
		t.Fatal(err)
	}
	root, err = a.Store.OpenPackageUploadsRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	entries, err := root.Entries()
	if err != nil || len(entries) != 1 || entries[0] != "upload-00000000-0000-0000-0000-000000000005.zip" {
		t.Fatal("crash remnants survived recovery", entries, err)
	}
	var expiredState, leasedState string
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT state FROM pi_package_uploads WHERE id='upload-00000000-0000-0000-0000-000000000004'`).Scan(&expiredState); err != nil {
			return err
		}
		return tx.QueryRow(`SELECT state FROM pi_package_uploads WHERE id='upload-00000000-0000-0000-0000-000000000005'`).Scan(&leasedState)
	}); err != nil || expiredState != "expired" || leasedState != "ready" {
		t.Fatal("expiration did not preserve the accepted lease", expiredState, leasedState, err)
	}
}

func TestPackageUploadRecoveryRejectsMissingReadyBytes(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	expires := time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)
	digest := "sha256:" + strings.Repeat("b", 64)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertPackageUpload(tx, corestore.PackageUpload{ID: "upload-00000000-0000-0000-0000-000000000006", ActorID: "operator", ScopeKind: "core", SourceKind: "zip", DisplayName: "missing.zip", Digest: &digest, Size: 100, State: "ready", ExpiresAt: &expires, CreatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.recoverPackageUploadFiles(ctx); err == nil {
		t.Fatal("ready upload with missing immutable bytes passed recovery")
	}
}
