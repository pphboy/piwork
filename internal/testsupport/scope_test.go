package testsupport

import (
	"context"
	"errors"
	"testing"
)

func TestScopeRejectsBroadCleanupBeforeIO(t *testing.T) {
	for _, value := range []string{"", "piwork", "production", "piwork-test-*", "piwork-test-local"} {
		if _, err := ExistingScope(value); !errors.Is(err, ErrUnsafeTestScope) {
			t.Fatal("unsafe scope accepted")
		}
		if err := (&Scope{id: value}).Cleanup(context.Background(), nil); !errors.Is(err, ErrUnsafeTestScope) {
			t.Fatal("unsafe scope reached Engine")
		}
	}
	a, err := NewScope()
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewScope()
	if err != nil {
		t.Fatal(err)
	}
	if a.ID() == b.ID() {
		t.Fatal("scope identity reused")
	}
	labels, err := a.Labels()
	if err != nil || labels[InstallationLabel] != a.ID() {
		t.Fatal(err)
	}
	filters, err := a.Filters()
	if err != nil || !filters["label"][InstallationLabel+"="+a.ID()] {
		t.Fatal(err)
	}
}
func TestDriverNeverDefaultsToRealModels(t *testing.T) {
	if err := RequireDeterministicModel(DeterministicProvider, DeterministicModel, "acceptance"); err != nil {
		t.Fatal(err)
	}
	for _, request := range [][3]string{{"", "", ""}, {"anthropic", "claude", "production"}, {DeterministicProvider, DeterministicModel, "production"}} {
		if err := RequireDeterministicModel(request[0], request[1], request[2]); !errors.Is(err, ErrRealModel) {
			t.Fatal("non-fixture model accepted")
		}
	}
}
