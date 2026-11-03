//go:build linux

// A development-only entry sharing the complete product startup and shutdown.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"piwork/internal/app"
	"piwork/internal/distribution"
	"piwork/internal/testsupport"
)

func main() { os.Exit(run()) }
func run() int {
	args := os.Args[1:]
	if raw, err := os.ReadFile(os.Args[0] + ".fixture.json"); err == nil {
		var config struct {
			Images map[string]string `json:"images"`
		}
		if json.Unmarshal(raw, &config) != nil || len(config.Images) != 4 {
			fmt.Fprintln(os.Stderr, "invalid Core fixture configuration")
			return 2
		}
		encoded, _ := json.Marshal(config.Images)
		distribution.EncodedImages = base64.RawStdEncoding.EncodeToString(encoded)
	} else if !os.IsNotExist(err) {
		return 2
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "--version") {
		return app.Run(context.Background(), args, os.Stdout, os.Stderr)
	}
	directory := ""
	var excluded []int
	for i, arg := range args {
		if arg == "--data-dir" && i+1 < len(args) {
			directory = args[i+1]
		}
		if strings.HasPrefix(arg, "--data-dir=") {
			directory = strings.TrimPrefix(arg, "--data-dir=")
		}
		name, value, inline := strings.Cut(arg, "=")
		if name == "--ui-port" || name == "--core-port" {
			if !inline && i+1 < len(args) {
				value = args[i+1]
			}
			if port, err := strconv.Atoi(value); err == nil {
				excluded = append(excluded, port)
			}
		}
	}
	if directory == "" {
		fmt.Fprintln(os.Stderr, "Core fixture requires an explicit data directory")
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	return app.RunWithRPCListener(ctx, args, os.Stdout, os.Stderr, func() (net.Listener, error) {
		return testsupport.LeaseRPCListener(directory, os.Getenv("PIWORK_TEST_RPC_REGISTRY"), excluded...)
	})
}
