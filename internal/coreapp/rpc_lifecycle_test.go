package coreapp

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestRPCBindsBeforeRuntimeAndReportsListenerFailure(t *testing.T) {
	directory := t.TempDir()
	a, err := New(t.Context(), Options{DataDirectory: directory, AgentGRPCListen: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close(context.Background())
	if err = a.BindRPC(t.Context()); err != nil {
		t.Fatal(err)
	}
	endpoint := a.serviceListener.Addr().String()
	if a.workRuntime != nil {
		t.Fatal("RPC binding started workload recovery")
	}
	if err = a.serviceListener.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-a.ServeDone():
		if err == nil {
			t.Fatal("RPC exit not reported")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("RPC listener failure was not supervised")
	}
	if err = a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp", endpoint)
	if err != nil {
		t.Fatal(err)
	}
	l.Close()
	reopened, err := New(t.Context(), Options{DataDirectory: directory})
	if err != nil {
		t.Fatal(err)
	}
	reopened.Close(context.Background())
}
