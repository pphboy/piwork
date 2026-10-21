// Browser contract fixture only. This is never built into dist/go or a release.
package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/signal"
	"piwork/internal/webapp"
	"syscall"
)

func main() {
	var config struct{ Core, Directory, Listen string }
	if len(os.Args) != 2 || json.Unmarshal([]byte(os.Args[1]), &config) != nil {
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	listener, err := net.Listen("tcp4", config.Listen)
	if err != nil {
		panic(err)
	}
	web, err := webapp.New(ctx, webapp.Options{Origin: "http://" + config.Listen, CoreURL: config.Core, DataDirectory: config.Directory})
	if err != nil {
		panic(err)
	}
	defer web.Close()
	server := &http.Server{Handler: web}
	go server.Serve(listener)
	os.Stdout.WriteString("hosted fixture listening\n")
	<-ctx.Done()
	server.Close()
}
