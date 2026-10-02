package coreapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"golang.org/x/sys/unix"
)

func TestEnvironmentMatchesFrozenTSParser(t *testing.T) {
	data, err := os.ReadFile("../identity/testdata/ts-environment.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Input   string
		Result  map[string]string
		Invalid bool
	}
	if json.Unmarshal(data, &fixtures) != nil {
		t.Fatal("invalid fixture")
	}
	for _, f := range fixtures {
		got, err := ParseEnvironment(f.Input)
		if f.Invalid {
			if err == nil {
				t.Fatal("invalid expression accepted", f.Input)
			}
			continue
		}
		if err != nil || !reflect.DeepEqual(got, f.Result) {
			t.Fatalf("%q: %+v expected %+v: %v", f.Input, got, f.Result, err)
		}
	}
	got := MergeEnvironment(map[string]string{"A": "file", "B": "file"}, []string{"A=process"}, map[string]string{"A": "explicit"})
	if !reflect.DeepEqual(got, map[string]string{"A": "explicit", "B": "file"}) {
		t.Fatal(got)
	}
}
func TestEnvironmentInputDoesNotFollowLinksOrBlockOnFIFO(t *testing.T) {
	directory := t.TempDir()
	input := filepath.Join(directory, "input")
	os.WriteFile(input, []byte("A='literal $HOME'\n"), 0600)
	if values, err := ReadEnvironmentFile(input); err != nil || values["A"] != "literal $HOME" {
		t.Fatal(values, err)
	}
	link := filepath.Join(directory, "link")
	os.Symlink(input, link)
	if _, err := ReadEnvironmentFile(link); err == nil {
		t.Fatal("followed env symlink")
	}
	fifo := filepath.Join(directory, "fifo")
	if err := unix.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadEnvironmentFile(fifo); err == nil {
		t.Fatal("accepted FIFO")
	}
}
func TestListenValidationBeforeAnyFileOrNetworkEffects(t *testing.T) {
	for _, address := range []string{"127.0.0.1:0", "127.8.9.10:7171", "[::1]:7171", "localhost:7171"} {
		a, err := ParseListen(address, false)
		if err != nil || a.URL() == "" {
			t.Fatal(a, err)
		}
	}
	for _, address := range []string{"0.0.0.0:7171", "192.0.2.1:7171", "example.org:7171", "[::]:7171"} {
		if _, err := ParseListen(address, false); !errors.Is(err, ErrRemotePlaintext) {
			t.Fatal(address, err)
		}
		if _, err := ParseListen(address, true); err != nil {
			t.Fatal(err)
		}
	}
	for _, address := range []string{"127.0.0.1:-1", "127.0.0.1:65536", "127.0.0.1:+1", "localhost", "localhost:", "::1:7171", ":7171"} {
		if _, err := ParseListen(address, true); !errors.Is(err, ErrListen) {
			t.Fatal(address, err)
		}
	}
}
func TestServeRejectsInvalidOrRemoteParametersWithoutCreatingInstallation(t *testing.T) {
	for _, args := range [][]string{{"--listen", "0.0.0.0:7171"}, {"--listen", "127.0.0.1:65536"}, {"--unknown"}, {"--listen", "127.0.0.1:0", "--listen", "127.0.0.1:0"}} {
		directory := filepath.Join(t.TempDir(), "uncreated-core")
		args = append([]string{"--data-dir", directory}, args...)
		var stdout, stderr bytes.Buffer
		if code := RunServe(context.Background(), args, &stdout, &stderr); code != 2 || stdout.Len() != 0 || stderr.Len() == 0 {
			t.Fatal(code, stdout.String(), stderr.String())
		}
		if _, err := os.Stat(directory); !os.IsNotExist(err) {
			t.Fatal("invalid parameters created data directory")
		}
	}
}
