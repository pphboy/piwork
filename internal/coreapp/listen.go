package coreapp

import (
	"errors"
	"net"
	"strconv"
	"strings"
)

var ErrListen = errors.New("listen must be HOST:PORT or [IPv6]:PORT")
var ErrRemotePlaintext = errors.New("non-loopback plaintext HTTP requires --allow-insecure-remote")

type ListenAddress struct {
	Host string
	Port int
}

func ParseListen(value string, allowInsecureRemote bool) (ListenAddress, error) {
	if value == "" {
		value = "127.0.0.1:7171"
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" || port == "" {
		return ListenAddress{}, ErrListen
	}
	for _, c := range port {
		if c < '0' || c > '9' {
			return ListenAddress{}, ErrListen
		}
	}
	n, err := strconv.Atoi(port)
	if err != nil || n > 65535 {
		return ListenAddress{}, ErrListen
	}
	if !IsLoopback(host) && !allowInsecureRemote {
		return ListenAddress{}, ErrRemotePlaintext
	}
	return ListenAddress{host, n}, nil
}
func IsLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
func (a ListenAddress) Address() string { return net.JoinHostPort(a.Host, strconv.Itoa(a.Port)) }
func (a ListenAddress) URL() string     { return "http://" + a.Address() }
