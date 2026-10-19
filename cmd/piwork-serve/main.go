package main

import (
	"context"
	"os"
	"os/signal"
	"piwork/internal/app"
	"syscall"
)

func main() {
	args := os.Args[1:]
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := app.Run(ctx, args, os.Stdin, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
