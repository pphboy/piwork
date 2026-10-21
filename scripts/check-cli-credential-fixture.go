//go:build ignore

package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"piwork/internal/client"
)

// Test-only bootstrap for browser fake-Core fixtures. Use the native credential
// store so fixtures follow the same private storage contract as the client.
func main() {
	path := flag.String("config", "", "new native credential fixture path")
	flag.Parse()
	if *path == "" || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "--config is required; read fixture JSON from stdin")
		os.Exit(2)
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 {
		fmt.Fprintln(os.Stderr, "invalid credential fixture size")
		os.Exit(1)
	}
	var credential client.Credential
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&credential) != nil || decoder.Decode(new(any)) != io.EOF {
		fmt.Fprintln(os.Stderr, "invalid credential fixture format")
		os.Exit(1)
	}
	if err := (client.CredentialStore{Path: *path}).Save(credential); err != nil {
		fmt.Fprintln(os.Stderr, "native private credential fixture creation failed")
		os.Exit(1)
	}
}
