package main

import (
	"context"
	"os"
	"os/signal"
	"piwork/internal/snapshothelper"
	"syscall"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	os.Exit(snapshothelper.Entry(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
