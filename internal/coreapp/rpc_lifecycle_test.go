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

func TestRPCListenerFactoryFailuresAndOwnership(t *testing.T) {
	for _, mode := range []string{"nil", "error", "valid"} {
		t.Run(mode, func(t *testing.T) {
			var address string
			acquire := func() (net.Listener, error) {
				if mode == "nil" {
					return nil, nil
				}
				listener, err := net.Listen("tcp4", "127.0.0.1:0")
				if err != nil {
					return nil, err
				}
				address = listener.Addr().String()
				if mode == "error" {
					return listener, context.Canceled
				}
				return listener, nil
			}
			if err := validateServiceRPCOptions(Options{AgentRPCListener: acquire, AgentGRPCListen: "127.0.0.1:0"}); err == nil {
				t.Fatal("competing listener sources accepted")
			}
			a, err := New(t.Context(), Options{DataDirectory: t.TempDir(), AgentRPCListener: acquire})
			if err != nil {
				t.Fatal(err)
			}
			err = a.BindRPC(t.Context())
			if (mode == "valid") != (err == nil) {
				t.Fatal("listener factory outcome changed", mode, err)
			}
			if err := a.Close(context.Background()); err != nil {
				t.Fatal(err)
			}
			if address != "" {
				released, err := net.Listen("tcp4", address)
				if err != nil {
					t.Fatal("factory listener leaked", err)
				}
				released.Close()
			}
		})
	}
}
