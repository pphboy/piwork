package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

func TestPackageCatalogHidesDisabledAndProjectsScopedName(t *testing.T) {
	a, base, operator := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for i, item := range []struct {
			name    string
			enabled int
		}{{"@team/tools", 1}, {"hidden-tools", 0}} {
			id := fmt.Sprintf("artifact-%d", i)
			metadata := fmt.Sprintf(`{"name":%q,"version":"1.0.0","sourceKind":"zip","resolvedSource":"upload:tools.zip","preparedEnvironment":{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1"},"resourceCounts":{"extensions":1,"skills":0,"prompts":0,"themes":0},"contentDigest":"sha256:%s"}`, item.name, strings.Repeat("a", 64))
			if _, err := tx.Exec(`INSERT INTO pi_package_artifacts(id,scope_kind,name,content_digest,metadata_json,storage_path,created_at) VALUES(?,'core',?,?,?,?,?)`, id, item.name, "sha256:"+strings.Repeat("a", 64), metadata, "private-artifact", now); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES(?,?,?,1,?,?)`, item.name, item.enabled, id, now, now); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	userAuth := "Bearer " + login.Token
	if status, result := httpCall(t, base, "/api/v1/packages", "GET", userAuth, nil); status != 200 || len(result["packages"].([]any)) != 1 {
		t.Fatal("public catalog leaked disabled package", status, result)
	}
	if status, result := httpCall(t, base, "/api/v1/packages/%40team%2Ftools", "GET", userAuth, nil); status != 200 || result["name"] != "@team/tools" || result["resolvedSource"] != "upload:tools.zip" {
		t.Fatal("scoped package detail was not decoded", status, result)
	}
	if status, _ := httpCall(t, base, "/api/v1/packages/hidden-tools", "GET", userAuth, nil); status != 404 {
		t.Fatal("disabled package was visible to public catalog", status)
	}
	for _, pathAuth := range []struct{ path, auth string }{{"/api/v1/admin/packages", userAuth}, {"/control/packages", "Operator " + operator}} {
		if status, result := httpCall(t, base, pathAuth.path, "GET", pathAuth.auth, nil); status != 200 || len(result["packages"].([]any)) != 2 {
			t.Fatal("privileged catalog omitted disabled package", pathAuth.path, status, result)
		}
	}
	if status, result := httpCall(t, base, "/api/v1/admin/packages/hidden-tools/enable", "POST", userAuth, nil); status != 200 || result["enabled"] != true {
		t.Fatal("admin could not enable package", status, result)
	}
	if status, result := httpCall(t, base, "/api/v1/packages", "GET", userAuth, nil); status != 200 || len(result["packages"].([]any)) != 2 {
		t.Fatal("enabled package did not enter public catalog", status, result)
	}
	if status, result := httpCall(t, base, "/control/packages/hidden-tools/disable", "POST", "Operator "+operator, nil); status != 200 || result["enabled"] != false {
		t.Fatal("operator could not disable package", status, result)
	}
	if status, _ := httpCall(t, base, "/api/v1/admin/packages/hidden-tools", "DELETE", userAuth, nil); status != 204 {
		t.Fatal("admin could not remove unselected package", status)
	}
	if status, result := httpCall(t, base, "/control/packages/hidden-tools", "GET", "Operator "+operator, nil); status != 404 || result["code"] != "PI_PACKAGE_NOT_FOUND" {
		t.Fatal("removed package remained visible", status, result)
	}
	config := defaultWorkConfiguration(RuntimeProfile{Revision: 1})
	config.Packages = contracts.PiPackageSelection{{Name: "@team/tools", Enabled: true}}
	raw, err := json.Marshal(corestore.DefaultWorkConfiguration{Version: 1, Revision: 1, Configuration: &config})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key='default_work_configuration'`, string(raw), now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if status, result := httpCall(t, base, "/api/v1/packages/%40team%2Ftools", "GET", userAuth, nil); status != 200 || result["isDefault"] != true {
		t.Fatal("default package selection was not projected", status, result)
	}
	for _, action := range []struct{ method, path string }{{"POST", "/api/v1/admin/packages/%40team%2Ftools/disable"}, {"DELETE", "/api/v1/admin/packages/%40team%2Ftools"}} {
		if status, result := httpCall(t, base, action.path, action.method, userAuth, nil); status != 409 || result["code"] != "PI_PACKAGE_IN_DEFAULTS" {
			t.Fatal("default package mutation was accepted", action, status, result)
		}
	}
}
