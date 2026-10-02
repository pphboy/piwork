package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"piwork/internal/cli"
	"piwork/internal/servicemcp"
	"syscall"
)

func main() { os.Exit(run()) }
func run() int {
	// SDK internal diagnostics are not a public error projection.
	log.SetOutput(io.Discard)
	if len(os.Args) > 1 {
		return cli.Entry("piwork-service-mcp", os.Args[1:], os.Stdout, os.Stderr)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	client, connection, err := servicemcp.NewClient()
	if err == nil {
		defer connection.Close()
		err = servicemcp.RunStdio(ctx, client)
	}
	if err == nil || ctx.Err() != nil {
		return 0
	}
	fmt.Fprintln(os.Stderr, `{"component":"service-mcp","stage":"mcp-initialize","outcome":"failed","code":"MCP_INITIALIZATION_FAILED","message":"The Work service MCP adapter could not initialize."}`)
	return 1
}
