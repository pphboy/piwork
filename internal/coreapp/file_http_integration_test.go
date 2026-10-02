//go:build integration

package coreapp

import (
	"bytes"
	"database/sql"
	"io"
	"net/http"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"strings"
	"testing"
	"time"
)

func TestNativeCoreWebDAVHTTPProfile(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	if _, err := a.requireFileImage(); err != nil {
		t.Fatal(err)
	}
	root := "/api/v1/works/" + id + "/files/"
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	call := func(method, path string, body []byte, headers map[string]string) (int, http.Header, []byte) {
		t.Helper()
		request, err := http.NewRequestWithContext(ctx, method, base+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", auth)
		for key, value := range headers {
			request.Header.Set(key, value)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(method, path, err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(method, path, err)
		}
		return response.StatusCode, response.Header, data
	}
	check := func(method, path string, body []byte, headers map[string]string, want int) []byte {
		t.Helper()
		status, h, data := call(method, path, body, headers)
		if status != want {
			t.Fatalf("%s %s: %d %v %s", method, path, status, h, data)
		}
		return data
	}
	status, h, _ := call("GET", strings.TrimSuffix(root, "/"), nil, nil)
	if status != 308 || h.Get("Location") != root {
		t.Fatal(status, h)
	}
	check("OPTIONS", root, nil, nil, 200)
	check("MKCOL", root+"empty-folder", nil, nil, 201)
	emptyListing := check("PROPFIND", root+"empty-folder/", nil, map[string]string{"Depth": "1"}, 207)
	if bytes.Count(emptyListing, []byte("<d:response>")) != 1 {
		t.Fatal("empty directory did not expose just itself", string(emptyListing))
	}
	check("PUT", root+".env", []byte("user data"), nil, 201)
	hiddenListing := check("PROPFIND", root, nil, map[string]string{"Depth": "1"}, 207)
	if !bytes.Contains(hiddenListing, []byte(".env")) {
		t.Fatal("hidden file omitted", string(hiddenListing))
	}
	check("MKCOL", root+"%E4%B8%AD%E6%96%87", nil, nil, 201)
	path := root + "%E4%B8%AD%E6%96%87/binary"
	payload := bytes.Repeat([]byte{0, 255, 13, 10, 7}, 3355444)
	check("PUT", path, payload, nil, 201)
	if data := check("GET", path, nil, nil, 200); !bytes.Equal(data, payload) {
		t.Fatal("binary stream changed", len(data))
	}
	status, h, data := call("HEAD", path, nil, nil)
	if status != 200 || len(data) != 0 || h.Get("Content-Length") != "16777220" {
		t.Fatal(status, h, len(data))
	}
	status, h, data = call("GET", path, nil, map[string]string{"Range": "bytes=7-31"})
	if status != 206 || h.Get("Content-Range") != "bytes 7-31/16777220" || !bytes.Equal(data, payload[7:32]) {
		t.Fatal(status, h, data)
	}
	status, h, data = call("GET", path, nil, map[string]string{"Range": "bytes=-8"})
	if status != 206 || !bytes.Equal(data, payload[len(payload)-8:]) {
		t.Fatal(status, h, data)
	}
	status, h, _ = call("GET", path, nil, map[string]string{"Range": "bytes=0-1,3-4"})
	if status != 416 || h.Get("Content-Range") != "bytes */16777220" {
		t.Fatal(status, h)
	}
	check("GET", path, nil, map[string]string{"If-None-Match": "*"}, 304)
	status, _, data = call("HEAD", path, nil, map[string]string{"If-Match": "\"unknown\""})
	if status != 412 || len(data) != 0 {
		t.Fatal(status, len(data))
	}
	check("PUT", path, []byte("bad"), map[string]string{"If-None-Match": "*"}, 412)
	check("PUT", root+"empty", nil, nil, 201)
	if data := check("GET", root+"empty", nil, nil, 200); len(data) != 0 {
		t.Fatal(data)
	}
	check("PROPFIND", root, nil, map[string]string{"Depth": "infinity"}, 403)
	check("PROPFIND", root, []byte(`<!DOCTYPE x><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>`), map[string]string{"Depth": "1", "Content-Type": "application/xml"}, 400)
	listing := check("PROPFIND", root, []byte(`<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getetag/></d:prop></d:propfind>`), map[string]string{"Depth": "1", "Content-Type": "application/xml"}, 207)
	if !bytes.Contains(listing, []byte("404 Not Found")) || !bytes.Contains(listing, []byte("%E4%B8%AD%E6%96%87/")) {
		t.Fatal(string(listing))
	}
	patch := check("PROPPATCH", path, []byte(`<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>Changed</d:displayname></d:prop></d:set></d:propertyupdate>`), map[string]string{"Content-Type": "application/xml"}, 207)
	if !bytes.Contains(patch, []byte("403 Forbidden")) {
		t.Fatal(string(patch))
	}
	check("COPY", path, nil, map[string]string{"Destination": base + root + "copied", "Overwrite": "F"}, 201)
	check("COPY", path, nil, map[string]string{"Destination": root + "copied", "Overwrite": "F"}, 412)
	check("COPY", path, nil, map[string]string{"Destination": "http://example.invalid/file"}, 403)
	check("MOVE", root+"copied", nil, map[string]string{"Destination": root + "moved"}, 201)
	check("DELETE", root+"moved", nil, nil, 204)
	check("GET", root+"moved", nil, nil, 404)
	check("DELETE", root, nil, nil, 403)
	check("LOCK", path, nil, nil, 405)
	check("GET", root+"%2E%2E/secret", nil, nil, 400)
	check("COPY", path, nil, map[string]string{"Destination": "/api/v1/works/work-00000000-0000-0000-0000-000000000000/files/value"}, 403)
	actor, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(ctx, actor.Principal(), "other-admin", "development-fixture-pass", "admin"); err != nil {
		t.Fatal(err)
	}
	other, err := a.Identity.Login(ctx, "other-admin", "development-fixture-pass", "foreign-files")
	if err != nil {
		t.Fatal(err)
	}
	check("GET", path, nil, map[string]string{"Authorization": "Bearer " + other.Token}, 404)
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "other-user", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	otherUser, err := a.Identity.Login(ctx, "other-user", "development-fixture-pass", "foreign-files")
	if err != nil {
		t.Fatal(err)
	}
	check("GET", path, nil, map[string]string{"Authorization": "Bearer " + otherUser.Token}, 404)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET observed_state='degraded' WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check("OPTIONS", root, nil, nil, 200)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET observed_state='ready' WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	a.fileMu.Lock()
	image := a.fileImageID
	a.fileImageID = ""
	a.fileMu.Unlock()
	t.Cleanup(func() { a.fileMu.Lock(); a.fileImageID = image; a.fileMu.Unlock() })
	check("OPTIONS", root, nil, nil, 503)
	if !a.Status().Ready {
		t.Fatal("missing helper disabled Core", a.Status())
	}
	a.fileMu.Lock()
	a.fileImageID = image
	a.fileMu.Unlock()
	check("GET", path, nil, map[string]string{"Authorization": "Bearer invalid"}, 401)
	if data := check("GET", path, nil, nil, 200); !bytes.Equal(data, payload) {
		t.Fatal("rejected mutation altered target")
	}
	// GET's final DATA may reach a client before the exit/removal proof. Wait
	// for the durable journal to settle rather than treating Content-Length as
	// a helper termination signal.
	deadline := time.Now().Add(10 * time.Second)
	for {
		var pending []corestore.FileJob
		err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; pending, err = corestore.PendingFileJobs(tx, &id); return err })
		if err != nil {
			t.Fatal(err)
		}
		if len(pending) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("file journal did not settle", pending)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if remaining, err := a.dockerRuntime.ListContainers(ctx, "file-helper"); err != nil || len(remaining) != 0 {
		t.Fatal("helper leak", len(remaining), err)
	}
}
