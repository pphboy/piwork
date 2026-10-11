package coreapp

import (
	"context"
	"piwork/internal/identity"
	"piwork/internal/releaseinfo"
	"testing"
)

func TestAboutUsesCoreIdentityWithoutRuntimeAndRequiresCurrentUser(t *testing.T) {
	a, base, _ := appFixture(t, Options{})
	if _, err := a.Identity.Bootstrap(context.Background(), "about-admin", "development-fixture-pass"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "about-user", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	if status, _ := httpCall(t, base, "/api/v1/about", "GET", "", nil); status != 401 {
		t.Fatal(status)
	}
	for _, account := range []string{"about-admin", "about-user"} {
		login, err := a.Identity.Login(context.Background(), account, "development-fixture-pass", "about-test")
		if err != nil {
			t.Fatal(err)
		}
		auth := "Bearer " + login.Token
		status, value := httpCall(t, base, "/api/v1/about", "GET", auth, nil)
		if status != 200 || value["releasesUrl"] != releaseinfo.ReleasesURL || value["build"].(map[string]any)["program"] != "piwork-serve" {
			t.Fatal(status, value)
		}
		if a.Status().Ready {
			t.Fatal("fixture unexpectedly has configured runtime")
		}
		if err := a.Identity.Logout(context.Background(), login.Token); err != nil {
			t.Fatal(err)
		}
		if status, _ := httpCall(t, base, "/api/v1/about", "GET", auth, nil); status != 401 {
			t.Fatal("revoked identity", status)
		}
	}
}
