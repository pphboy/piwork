package consoleapp

import "testing"

func TestModelManagementProxyAndShellRoutesRemainBounded(t *testing.T) {
	for _, test := range []struct {
		method, path string
		allowed      bool
	}{
		{"GET", "/model-providers", true}, {"POST", "/model-providers", true}, {"PATCH", "/model-providers/provider-fixture-00001", true},
		{"POST", "/model-providers/provider-fixture-00001/models", true}, {"POST", "/models/model-fixture-00001/disable", true}, {"DELETE", "/models/model-fixture-00001", true},
		{"POST", "/model-tests", true}, {"GET", "/model-tests", false}, {"PUT", "/model-providers", false}, {"GET", "/model-providers/%2Fprivate", false}, {"POST", "/models/model-fixture-00001/arbitrary", false},
	} {
		if got := consoleAllowedAdmin(test.method, test.path); got != test.allowed {
			t.Fatalf("%s %s allowed=%v", test.method, test.path, got)
		}
	}
	for _, path := range []string{"/models/model-fixture-00001", "/models/providers/provider-fixture-00001"} {
		if !consoleShellRoute(path) {
			t.Fatal("missing model shell route", path)
		}
	}
	for _, path := range []string{"/models/providers/%2Fprivate", "/models/providers/provider-fixture-00001/arbitrary"} {
		if consoleShellRoute(path) {
			t.Fatal("unbounded model shell route", path)
		}
	}
}
