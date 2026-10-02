package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"piwork/internal/filehelper"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	os.Exit(filehelper.Entry(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
