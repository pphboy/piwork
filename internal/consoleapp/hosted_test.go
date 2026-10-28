package consoleapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"piwork/internal/client"
	"piwork/internal/contracts"
)

func TestConsoleAvailabilitySessionErrorsKeepTheirClassification(t *testing.T) {
	for _, test := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"network", &client.APIError{Code: "NETWORK_ERROR", Text: "private synthetic detail"}, 502, "CORE_UNAVAILABLE"},
		{"timeout", context.DeadlineExceeded, 502, "CORE_UNAVAILABLE"},
		{"unexpected", errors.New("private synthetic detail"), 502, "CORE_UNAVAILABLE"},
		{"Core-unauthorized", &client.APIError{Status: 401, Code: "AUTHENTICATION_REQUIRED"}, 401, "AUTHENTICATION_REQUIRED"},
		{"local-unauthorized", contracts.NewError("AUTHENTICATION_REQUIRED", ""), 401, "AUTHENTICATION_REQUIRED"},
		{"Core-forbidden", &client.APIError{Status: 403, Code: "PERMISSION_DENIED"}, 403, "PERMISSION_DENIED"},
		{"local-forbidden", contracts.NewError("PERMISSION_DENIED", ""), 403, "PERMISSION_DENIED"},
	} {
		for _, layer := range []int{1, 2} {
			t.Run(test.name+"/layer-"+strconv.Itoa(layer), func(t *testing.T) {
				resolves := 0
				handler := NewHostedHandler(HostedOptions{CoreURL: "http://core.example.invalid", Origin: func(*http.Request) string { return "http://localhost:17891" }, Resolve: func(*http.Request) (HostedSession, error) {
					resolves++
					if resolves == layer {
						return HostedSession{}, test.err
					}
					return HostedSession{ID: "admin", User: client.Identity{ID: "admin", Role: "admin"}}, nil
				}})
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://localhost:17891/console/api/availability", nil))
				var value map[string]any
				if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
					t.Fatal(err)
				}
				if response.Code != test.status || value["code"] != test.code || value["message"] != test.code || len(value) != 2 {
					t.Fatal("session failure classification or redaction changed", response.Code, value)
				}
				if resolves != layer {
					t.Fatal("session validation continued after failure", resolves)
				}
			})
		}
	}
}
