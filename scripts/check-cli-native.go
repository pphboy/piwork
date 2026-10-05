//go:build ignore

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"piwork/scripts/clinative"
	"time"
)

func main() {
	build := flag.String("build", "", "candidate build directory")
	root := flag.String("root", ".", "repository for expected UI assets")
	httpCore := flag.String("http-core", "", "optional deployed HTTP Core for native connection and preferences acceptance")
	flag.Parse()
	if *build == "" || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "--build is required")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := clinative.Smoke(ctx, *build, *root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *httpCore != "" {
		connected, err := clinative.HTTPConnection(ctx, *build, *httpCore)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		result.Scenarios = append(result.Scenarios, connected.Scenarios...)
	}
	json.NewEncoder(os.Stdout).Encode(result)
}
