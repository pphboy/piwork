package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHistoryTransportFailureCategoriesAndCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/large":
			io.WriteString(w, `"`+strings.Repeat("a", 1<<20)+`"`)
		case "/broken":
			w.Header().Set("Content-Length", "500")
			io.WriteString(w, `{"incomplete":`)
		case "/json":
			io.WriteString(w, `{"invalid":`)
		case "/cancel":
			<-r.Context().Done()
		}
	}))
	defer server.Close()
	api, _ := New(server.URL, "")
	for path, code := range map[string]string{"/large": "RESPONSE_TOO_LARGE", "/broken": "RESPONSE_INCOMPLETE", "/json": "MALFORMED_RESPONSE"} {
		var raw json.RawMessage
		err := api.Request(context.Background(), "GET", path, nil, &raw)
		var failure *APIError
		if !errors.As(err, &failure) || failure.Code != code {
			t.Fatal(path, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := api.Request(ctx, "GET", "/cancel", nil, nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestHistoryStreamNeverPublishesIncompleteOriginalEvent(t *testing.T) {
	for _, complete := range []bool{false, true} {
		t.Run(map[bool]string{false: "interrupted", true: "complete"}[complete], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("responseProfile") != "history-v1" {
					t.Error("missing explicit profile")
				}
				w.Header().Set("Content-Type", "application/x-ndjson")
				io.WriteString(w, "{\"sequence\":4,\"kind\":{\"$case\":\"text\",\"text\":{\"delta\":\"前\",\"byteOffset\":0,\"totalBytes\":6,\"complete\":false}}}\n")
				if complete {
					io.WriteString(w, "{\"sequence\":4,\"kind\":{\"$case\":\"text\",\"text\":{\"delta\":\"后\",\"byteOffset\":3,\"totalBytes\":6,\"complete\":true}}}\n")
				}
			}))
			defer server.Close()
			api, _ := New(server.URL, "")
			var got []json.RawMessage
			err := api.StreamHistory(context.Background(), "/events?after=3", func(raw json.RawMessage) error { got = append(got, raw); return nil })
			if complete {
				if err != nil || len(got) != 1 || !strings.Contains(string(got[0]), "前后") {
					t.Fatal(err, got)
				}
			} else if err == nil || len(got) != 0 {
				t.Fatal("partial event was published", err, got)
			}
		})
	}
}
