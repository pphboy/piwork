package dockerengine

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
)

func TestVerificationScopeBindsDaemonAndStorage(t *testing.T) {
	first, err := verificationScope("daemon-a", "overlay2", "/var/lib/docker/")
	if err != nil || len(first) != 64 || strings.Contains(first, "daemon") {
		t.Fatal("invalid private scope", err)
	}
	again, err := verificationScope("daemon-a", "overlay2", "/var/lib/docker")
	if err != nil || first != again {
		t.Fatal("equivalent storage root changed scope", err)
	}
	for _, input := range [][3]string{{"daemon-b", "overlay2", "/var/lib/docker"}, {"daemon-a", "other", "/var/lib/docker"}, {"daemon-a", "overlay2", "/other"}} {
		got, err := verificationScope(input[0], input[1], input[2])
		if err != nil || got == first {
			t.Fatal("different daemon or storage shared scope", err)
		}
	}
	for _, input := range [][3]string{{"", "overlay2", "/var/lib/docker"}, {"id", "", "/var/lib/docker"}, {"id", "overlay2", "relative"}, {"id", "overlay2", "/"}, {"secret\n", "overlay2", "/var/lib/docker"}} {
		_, err := verificationScope(input[0], input[1], input[2])
		if !errors.Is(err, ErrEngineIdentity) || strings.Contains(err.Error(), "secret") {
			t.Fatal("invalid identity accepted or disclosed", err)
		}
	}
}

func TestVerificationIdentityFencesDisconnectAndReplacement(t *testing.T) {
	path := shortEngineSocket(t, "identity.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	var state atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if state.Load() == 1 {
			http.Error(w, "secret /private/path", http.StatusInternalServerError)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/info") {
			id := "daemon-a"
			if state.Load() == 2 {
				id = "daemon-b"
			}
			if state.Load() == 3 {
				id = ""
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"ID": id, "Driver": "overlay2", "DockerRootDir": "/var/lib/docker"})
			return
		}
		w.WriteHeader(http.StatusOK)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+path), client.WithVersion("1.51"))
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	e := &Engine{api: api}
	first, generation, err := e.VerificationIdentity(context.Background())
	if err != nil || generation == 0 {
		t.Fatal("initial identity", err)
	}
	_, same, err := e.VerificationIdentity(context.Background())
	if err != nil || same != generation {
		t.Fatal("stable identity changed generation", err)
	}
	state.Store(1)
	if err := e.Ping(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatal("disconnect was not detected", err)
	}
	state.Store(0)
	again, reconnected, err := e.VerificationIdentity(context.Background())
	if err != nil || again != first || reconnected <= generation {
		t.Fatal("reconnection did not fence old work", err)
	}
	state.Store(2)
	replacement, replaced, err := e.VerificationIdentity(context.Background())
	if err != nil || replacement == first || replaced <= reconnected {
		t.Fatal("replacement was not fenced", err)
	}
	state.Store(3)
	_, _, err = e.VerificationIdentity(context.Background())
	if !errors.Is(err, ErrEngineIdentity) {
		t.Fatal("missing daemon identity was accepted", err)
	}
}

func TestSlowIdentityObservationDoesNotBlockFailureOrRestoreStaleScope(t *testing.T) {
	path := shortEngineSocket(t, "slow-identity.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	var mode atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/_ping") {
			if mode.Load() == 1 {
				http.Error(w, "unavailable", 503)
			}
			return
		}
		if strings.HasSuffix(r.URL.Path, "/info") {
			id := "daemon-a"
			switch mode.Load() {
			case 1:
				close(entered)
				<-release
			case 2:
				id = "daemon-b"
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"ID": id, "Driver": "overlay2", "DockerRootDir": "/var/lib/docker"})
			return
		}
		http.NotFound(w, r)
	})}
	go server.Serve(listener)
	defer server.Close()
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+path), client.WithVersion("1.51"))
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	engine := &Engine{api: api}
	original, _, err := engine.VerificationIdentity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	mode.Store(1)
	done := make(chan string, 1)
	go func() { scope, _, _ := engine.VerificationIdentity(context.Background()); done <- scope }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("info did not begin")
	}
	pingDone := make(chan error, 1)
	go func() { pingDone <- engine.Ping(context.Background()) }()
	select {
	case err := <-pingDone:
		if !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("slow info blocked failure detection")
	}
	mode.Store(2)
	close(release)
	select {
	case scope := <-done:
		if scope == "" || scope == original {
			t.Fatal("stale identity restored")
		}
	case <-time.After(time.Second):
		t.Fatal("identity not rechecked")
	}
}
