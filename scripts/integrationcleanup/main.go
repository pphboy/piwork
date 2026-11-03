// Development-only cleanup for exact scopes recorded by the integration runner.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/testsupport"
)

func main() {
	if len(os.Args) != 2 {
		os.Exit(2)
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "scope ledger unavailable")
		os.Exit(1)
	}
	ids, err := parseScopes(raw)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	options := []client.Opt{client.FromEnv, client.WithAPIVersionNegotiation()}
	if host := os.Getenv("PIWORK_TEST_DOCKER_HOST"); host != "" {
		options = append(options, client.WithHost(host))
	}
	engine, err := client.NewClientWithOpts(options...)
	if err != nil {
		os.Exit(1)
	}
	defer engine.Close()
	if err := cleanupScopes(ids, engine, os.Stdout, os.Stderr); err != nil {
		os.Exit(1)
	}
}

func parseScopes(raw []byte) (map[string]*testsupport.Scope, error) {
	ids := map[string]*testsupport.Scope{}
	for _, id := range strings.Fields(string(raw)) {
		scope, err := testsupport.ExistingScope(id)
		if err != nil {
			return nil, testsupport.ErrUnsafeTestScope
		}
		ids[id] = scope
	}
	return ids, nil
}

func cleanupScopes(ids map[string]*testsupport.Scope, engine *client.Client, stdout, stderr io.Writer) error {
	var failures []error
	for id, scope := range ids {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := scope.Cleanup(ctx, engine)
		cancel()
		if err != nil {
			failures = append(failures, err)
			fmt.Fprintln(stderr, id, "cleanup unconfirmed:", err)
		} else {
			fmt.Fprintln(stdout, id, "clean")
		}
	}
	return errors.Join(failures...)
}
