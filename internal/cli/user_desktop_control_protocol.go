package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
)

const desktopControlLimit = 16 << 10

var errDesktopControlSecurity = errors.New("Desktop control channel security check failed; use the same system user")
var errDesktopControlMissing = errors.New("Desktop instance is not running; start piwork-cli desktop on this port")
var errDesktopControlProtocol = errors.New("Desktop control channel is unavailable or incompatible; check the running instance")

type desktopControlRequest struct {
	Version    int    `json:"version"`
	InstanceID string `json:"instanceId"`
	Port       int    `json:"port"`
	Action     string `json:"action"`
}
type desktopControlReply struct {
	Version                   int    `json:"version"`
	InstanceID                string `json:"instanceId"`
	Port                      int    `json:"port"`
	LaunchURL                 string `json:"launchUrl,omitempty"`
	LocalCleared              bool   `json:"localCleared,omitempty"`
	RemoteRevocationConfirmed bool   `json:"remoteRevocationConfirmed,omitempty"`
	CredentialCleared         bool   `json:"credentialCleared,omitempty"`
	Error                     string `json:"error,omitempty"`
}

func parseDesktopControlOptions(args []string) (desktopOptions, error) {
	if len(args) == 0 || args[0] != "open" && args[0] != "logout" {
		return desktopOptions{}, errors.New("invalid desktop control command")
	}
	options, err := parseUserDesktopOptions(args[1:])
	if err == nil && args[0] == "logout" && !options.open {
		err = errors.New("desktop logout does not accept --no-open")
	}
	return options, err
}

// Detect duplicate keys before decoding into the strict protocol structure.
func desktopStrictJSON(raw []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return errDesktopControlProtocol
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err = decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return errDesktopControlProtocol
		}
		seen[key] = true
		var field json.RawMessage
		if decoder.Decode(&field) != nil {
			return errDesktopControlProtocol
		}
	}
	if _, err = decoder.Token(); err != nil {
		return errDesktopControlProtocol
	}
	if _, err = decoder.Token(); err != io.EOF {
		return errDesktopControlProtocol
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil {
		return errDesktopControlProtocol
	}
	return nil
}

func validDesktopLaunchURL(address string, port int) bool {
	prefix := fmt.Sprintf("http://desktop.localhost:%d/#ticket=", port)
	if len(address) != len(prefix)+43 || !bytes.HasPrefix([]byte(address), []byte(prefix)) {
		return false
	}
	for _, ch := range address[len(prefix):] {
		if !(ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}
func runDesktopControl(args []string, stdout, stderr io.Writer) int {
	container, err := cliContainerMode()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	options, err := parseDesktopControlOptions(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	reply, err := requestDesktopControl(ctx, options.port, args[0])
	if ctx.Err() != nil {
		return 130
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		if errors.Is(err, errDesktopControlMissing) {
			return 4
		}
		if errors.Is(err, errDesktopControlSecurity) {
			return 3
		}
		return 5
	}
	if args[0] == "open" {
		if reply.Error != "" || reply.LaunchURL == "" {
			fmt.Fprintln(stderr, "Desktop could not issue browser access; check the running instance")
			return 5
		}
		fmt.Fprintf(stdout, "Piwork Desktop: %s\n", reply.LaunchURL)
		if options.open && !container {
			openDesktopBrowserContext(ctx, reply.LaunchURL, stderr)
		}
		if ctx.Err() != nil {
			return 130
		}
		return 0
	}
	if reply.Error != "" || !reply.CredentialCleared || !reply.RemoteRevocationConfirmed {
		fmt.Fprintf(stderr, "Desktop local identity cleared: %t; saved credential cleared: %t; remote revocation confirmed: %t. Retry piwork-cli desktop logout --port %d.\n", reply.LocalCleared, reply.CredentialCleared, reply.RemoteRevocationConfirmed, options.port)
		return 5
	}
	fmt.Fprintln(stdout, "Desktop platform login cleared; browser access and Work execution retained.")
	return 0
}

func executeDesktopControl(d *nativeDesktop, instance string, port int, action string) desktopControlReply {
	reply := desktopControlReply{Version: 1, InstanceID: instance, Port: port}
	if action == "open" {
		reply.LaunchURL, _ = d.issueTicket()
		if reply.LaunchURL == "" {
			reply.Error = "LOCAL_SESSION_UNAVAILABLE"
		}
	} else {
		result := d.logoutIdentity()
		reply.LocalCleared = result.LocalCleared
		reply.RemoteRevocationConfirmed = result.RemoteRevocationConfirmed
		reply.CredentialCleared = result.CredentialCleared
		reply.Error = result.Error
	}
	return reply
}
