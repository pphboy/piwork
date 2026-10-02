package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"piwork/internal/cli"
	"piwork/internal/packagehelper"
	"piwork/internal/pipackage"
	"syscall"
)

func main() { os.Exit(run()) }
func run() int {
	args := os.Args[1:]
	if len(args) == 1 && (args[0] == "--version" || args[0] == "version") {
		return cli.Entry("piwork-package-helper", args, os.Stdout, os.Stderr)
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		fmt.Fprintln(os.Stdout, "Usage: piwork-package-helper <prepare|init|capture|measure>")
		return 0
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	var result any
	var err error
	if len(args) != 1 {
		result = map[string]any{"errorCode": nil}
		err = fmt.Errorf("invalid action")
	} else {
		result, err = (packagehelper.Helper{Paths: packagehelper.DefaultPaths()}).Run(ctx, args[0])
		if err != nil {
			result = map[string]any{"errorCode": pipackage.ErrorCode(err)}
		}
	}
	if json.NewEncoder(os.Stdout).Encode(result) != nil {
		return 1
	}
	if err != nil {
		return 1
	}
	return 0
}
