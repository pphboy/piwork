package coreapp

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func dockerInitializationEnvironment() map[string]string {
	return map[string]string{
		"PIWORK_ADMIN_ACCOUNT":  "admin",
		"PIWORK_ADMIN_PASSWORD": "private-initial-password",
		"PIWORK_AGENT_IMAGE":    "fixture/native",
		"PIWORK_MODEL_PROVIDER": "fixture",
		"PIWORK_MODEL":          "model-one",
		"PIWORK_API_KEY":        "private-initial-key",
	}
}

func TestDockerInitializationAcceptsMissingGroupsAndRejectsIncompleteInput(t *testing.T) {
	for _, values := range []map[string]string{
		{},
		{"PIWORK_ADMIN_ACCOUNT": "admin", "PIWORK_ADMIN_PASSWORD": "private-initial-password"},
		{"PIWORK_AGENT_IMAGE": "fixture/native", "PIWORK_MODEL_PROVIDER": "fixture", "PIWORK_MODEL": "model", "PIWORK_API_KEY": "private-initial-key"},
	} {
		initialization, err := InitializationFromEnvironment(values)
		if err != nil {
			t.Fatal(err)
		}
		a, err := New(context.Background(), Options{DataDirectory: t.TempDir(), Initialization: initialization})
		if err != nil {
			t.Fatal(err)
		}
		closeSettingsApp(t, a)
	}
	for _, values := range []map[string]string{
		{"PIWORK_ADMIN_ACCOUNT": "admin"},
		{"PIWORK_ADMIN_PASSWORD": "private-initial-password"},
		{"PIWORK_AGENT_IMAGE": "fixture/native"},
		{"PIWORK_API_KEY": "private-initial-key"},
		{"PIWORK_MODEL_BASE_URL": "http://host.docker.internal:8000/private-initial-key"},
	} {
		if _, err := InitializationFromEnvironment(values); err == nil || strings.Contains(err.Error(), "private-initial") {
			t.Fatal("incomplete initialization was accepted or exposed a secret", err)
		}
	}
}

func TestDockerInitializationValidatesProvidedValuesBeforeOpeningStore(t *testing.T) {
	for _, item := range []struct{ key, value string }{
		{"PIWORK_ADMIN_ACCOUNT", "invalid account"},
		{"PIWORK_ADMIN_PASSWORD", "short"},
		{"PIWORK_AGENT_IMAGE", " "},
		{"PIWORK_MODEL_PROVIDER", "invalid provider"},
		{"PIWORK_MODEL", " "},
		{"PIWORK_API_KEY", ""},
		{"PIWORK_MODEL_BASE_URL", "http://host.docker.internal:8000/private-initial-key"},
		{"PIWORK_MODEL_BASE_URL", ""},
	} {
		t.Run(item.key+"/"+item.value, func(t *testing.T) {
			values := dockerInitializationEnvironment()
			values[item.key] = item.value
			initialization, err := InitializationFromEnvironment(values)
			if err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(t.TempDir(), "uncreated")
			if a, err := New(context.Background(), Options{DataDirectory: directory, Initialization: initialization}); err == nil {
				closeSettingsApp(t, a)
				t.Fatal("invalid input was accepted")
			} else if strings.Contains(err.Error(), "private-initial") {
				t.Fatal("validation error exposed a secret")
			}
			if _, err := os.Stat(directory); !os.IsNotExist(err) {
				t.Fatal("invalid initialization opened the store", err)
			}
		})
	}
	for _, base := range []string{"https://models.example.invalid/v1", "http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000"} {
		values := dockerInitializationEnvironment()
		values["PIWORK_MODEL_BASE_URL"] = base
		initialization, err := InitializationFromEnvironment(values)
		if err != nil || ValidateRuntime(*initialization.Runtime) != nil {
			t.Fatal("existing model URL policy changed", err)
		}
	}
}

func TestDockerInitializationPersistsDefaultsWithoutCreatingWorkOrReplacingIdentity(t *testing.T) {
	initialization, err := InitializationFromEnvironment(dockerInitializationEnvironment())
	if err != nil {
		t.Fatal(err)
	}
	options := Options{DataDirectory: t.TempDir(), Initialization: initialization}
	a, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	first, _, _ := a.Settings.LoadRuntime()
	installation := a.Store.InstallationID()
	operator, _ := os.ReadFile(filepath.Join(options.DataDirectory, "operator.credential"))
	login, err := a.Identity.Login(context.Background(), "admin", "private-initial-password", "docker-initialization")
	if err != nil {
		t.Fatal(err)
	}
	closeSettingsApp(t, a)
	values := dockerInitializationEnvironment()
	values["PIWORK_ADMIN_ACCOUNT"], values["PIWORK_ADMIN_PASSWORD"] = "replacement", "private-replacement-password"
	values["PIWORK_MODEL"], values["PIWORK_API_KEY"] = "model-two", "private-replacement-key"
	options.Initialization, _ = InitializationFromEnvironment(values)
	b, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	defer closeSettingsApp(t, b)
	second, _, _ := b.Settings.LoadRuntime()
	afterOperator, _ := os.ReadFile(filepath.Join(options.DataDirectory, "operator.credential"))
	if first.Model.ID != second.Model.ID || first.Model.CredentialRef != second.Model.CredentialRef || first.Revision != second.Revision || installation != b.Store.InstallationID() || string(operator) != string(afterOperator) {
		t.Fatal("initialization replaced persisted defaults or installation identity")
	}
	if _, err := b.Identity.Authenticate(context.Background(), login.Token); err != nil {
		t.Fatal("recreation invalidated the existing Core session", err)
	}
	if err := b.Store.Read(context.Background(), func(tx *sql.Tx) error {
		var users, works int
		if err := tx.QueryRow("SELECT count(*) FROM users").Scan(&users); err != nil {
			return err
		}
		if err := tx.QueryRow("SELECT count(*) FROM works").Scan(&works); err != nil {
			return err
		}
		if users != 1 || works != 0 {
			t.Fatal("unexpected default identities", users, works)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	values["PIWORK_MODEL_BASE_URL"] = "http://host.docker.internal:8000/private-replacement-key"
	options.Initialization, _ = InitializationFromEnvironment(values)
	if _, err := New(context.Background(), options); err == nil || strings.Contains(err.Error(), "private-replacement") {
		t.Fatal("persisted configuration bypassed validation of provided env", err)
	}
	view, err := b.Settings.RuntimeView()
	if err != nil || strings.Contains(fmtJSON(view), "private-") || strings.Contains(fmtJSON(b.Status()), "private-") {
		t.Fatal("public initialization output contains a secret", err)
	}
}
