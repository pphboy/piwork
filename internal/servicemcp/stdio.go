package servicemcp

import (
	"context"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"piwork/internal/rpc/servicesv1"
)

// Closing stdin or receiving a signal cancels every in-flight Core request.
// Waiting for a tool's normal 10-second deadline would exceed Agent cleanup.
func RunStdio(ctx context.Context, client servicesv1.WorkServicesClient) error {
	lifetime, cancel := context.WithCancel(ctx)
	defer cancel()
	server, err := newServer(lifetime, client)
	if err != nil {
		return err
	}
	err = server.Run(lifetime, closingTransport{Transport: &mcp.StdioTransport{}, cancel: cancel})
	if lifetime.Err() != nil {
		return nil
	}
	return err
}

type closingTransport struct {
	mcp.Transport
	cancel context.CancelFunc
}

func (t closingTransport) Connect(ctx context.Context) (mcp.Connection, error) {
	connection, err := t.Transport.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return closingConnection{Connection: connection, cancel: t.cancel}, nil
}

type closingConnection struct {
	mcp.Connection
	cancel context.CancelFunc
}

func (c closingConnection) Read(ctx context.Context) (jsonrpc.Message, error) {
	message, err := c.Connection.Read(ctx)
	if err != nil {
		c.cancel()
	}
	return message, err
}
func (c closingConnection) Close() error { c.cancel(); return c.Connection.Close() }
