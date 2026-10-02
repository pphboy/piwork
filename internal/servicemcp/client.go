package servicemcp

import (
	"bytes"
	"encoding/json"
	"errors"
	"golang.org/x/sys/unix"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"io"
	"net"
	"os"
	"piwork/internal/contracts"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
	"strconv"
)

var ErrInitialization = errors.New("Work service MCP adapter could not initialize")

func readFile(root *os.Root, name string) ([]byte, error) {
	file, err := root.OpenFile(name, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, ErrInitialization
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 1<<20 {
		return nil, ErrInitialization
	}
	raw, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return nil, ErrInitialization
	}
	return raw, nil
}
func NewClient() (servicesv1.WorkServicesClient, *grpc.ClientConn, error) {
	return loadClient("/etc/piwork")
}
func loadClient(directory string) (servicesv1.WorkServicesClient, *grpc.ClientConn, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, nil, ErrInitialization
	}
	defer root.Close()
	raw, err := readFile(root, "service-control.json")
	if err != nil {
		return nil, nil, err
	}
	if _, err := contracts.ParseJSON(bytes.NewReader(raw), 1<<20); err != nil {
		return nil, nil, ErrInitialization
	}
	var config internaltls.ControlConfig
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&config) != nil {
		return nil, nil, ErrInitialization
	}
	control := config.ServiceControl
	if control.ServerName != "piwork-core" || control.CACertificatePath != "/etc/piwork/control/installation-ca.crt" || control.ClientCertificatePath != "/etc/piwork/control/agent-service-client.crt" || control.ClientPrivateKeyPath != "/etc/piwork/control/agent-service-client.key" || len(control.Endpoint) > 2048 {
		return nil, nil, ErrInitialization
	}
	host, port, err := net.SplitHostPort(control.Endpoint)
	number, parseErr := strconv.ParseUint(port, 10, 16)
	if err != nil || parseErr != nil || number == 0 || host == "" {
		return nil, nil, ErrInitialization
	}
	ca, err := readFile(root, "control/installation-ca.crt")
	if err != nil {
		return nil, nil, err
	}
	certificate, err := readFile(root, "control/agent-service-client.crt")
	if err != nil {
		return nil, nil, err
	}
	key, err := readFile(root, "control/agent-service-client.key")
	if err != nil {
		return nil, nil, err
	}
	tlsConfig, err := internaltls.ServiceClientFromPEM(ca, certificate, key)
	if err != nil {
		return nil, nil, ErrInitialization
	}
	connection, err := grpc.NewClient("passthrough:///"+control.Endpoint, grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)), grpc.WithDisableRetry(), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(1<<20), grpc.MaxCallSendMsgSize(1<<20)))
	if err != nil {
		return nil, nil, ErrInitialization
	}
	return servicesv1.NewWorkServicesClient(connection), connection, nil
}
