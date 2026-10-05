package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/Microsoft/go-winio"
	"io"
	"os"
	"strconv"
	"testing"
	"time"

	"piwork/internal/clientfs"
)

func desktopControlFixturePortAvailable(port int) bool {
	d, err := openDesktopControlDirectory(false)
	if errors.Is(err, errDesktopControlMissing) {
		return true
	}
	if err != nil {
		return false
	}
	defer d.Close()
	sid, err := desktopCurrentSID()
	if err != nil {
		return false
	}
	_, _, err = desktopReadMeta(d, port, sid)
	return errors.Is(err, errDesktopControlMissing)
}

func TestWindowsDesktopControlRejectsForgedMetadataAndPreservesReplacements(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	name := desktopControlName(d.port, ".json")
	for _, kind := range []string{"pipe", "creation", "instance", "port"} {
		meta := c.meta
		switch kind {
		case "pipe":
			meta.PipeName = `\\.\pipe\untrusted`
		case "creation":
			meta.ServerCreation++
		case "instance":
			meta.InstanceID = "invalid"
		case "port":
			meta.Port++
		}
		raw, _ := json.Marshal(meta)
		if err := c.dir.AtomicWrite(t.Context(), name, raw); err != nil {
			t.Fatal(err)
		}
		if _, err := requestDesktopControl(t.Context(), d.port, "open"); err == nil {
			t.Fatal("forged recovery accepted", kind)
		}
		if d.ticket != "" {
			t.Fatal("forged metadata issued browser access")
		}
	}
	raw, _ := json.Marshal(c.meta)
	if err := c.dir.AtomicWrite(t.Context(), name, raw); err != nil {
		t.Fatal(err)
	}
	dir, err := openDesktopControlDirectory(false)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	c.close()
	if _, err := dir.ReadFile(name, desktopControlLimit); err != nil {
		t.Fatal("old instance removed replacement metadata", err)
	}
	if err := dir.Remove(name); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsDesktopControlBoundsActualPipeRequestsAndCancellation(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	conn, err := winio.DialPipeContext(t.Context(), c.meta.PipeName)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	request := desktopControlRequest{Version: 1, InstanceID: "forged", Port: d.port, Action: "open"}
	if err := desktopControlFrameWrite(conn, request); err != nil {
		t.Fatal(err)
	}
	var raw [1]byte
	if _, err := conn.Read(raw[:]); err == nil {
		t.Fatal("forged request replied")
	}
	conn.Close()
	if d.ticket != "" {
		t.Fatal("forged request performed action")
	}
	d.mu.Lock()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	_, err = requestDesktopControl(ctx, d.port, "open")
	cancel()
	d.mu.Unlock()
	if err == nil {
		t.Fatal("cancelled helper was not bounded")
	}
	if _, err := requestDesktopControl(t.Context(), d.port, "open"); err != nil {
		t.Fatal("helper cancellation stopped instance", err)
	}
	idle, err := winio.DialPipeContext(t.Context(), c.meta.PipeName)
	if err != nil {
		t.Fatal(err)
	}
	defer idle.Close()
	idle.SetDeadline(time.Now().Add(12 * time.Second))
	start := time.Now()
	_, err = io.ReadFull(idle, raw[:])
	if err == nil || time.Since(start) > 11*time.Second {
		t.Fatal("idle control request was not bounded", err, time.Since(start))
	}
}

func TestWindowsDesktopControlCrashHelper(t *testing.T) {
	if os.Getenv("PIWORK_TEST_CONTROL_CRASH") != "1" {
		return
	}
	port, _ := strconv.Atoi(os.Getenv("PIWORK_TEST_CONTROL_PORT"))
	d := recoveryDesktop(t)
	d.port = port
	d.origin = fmt.Sprintf("http://desktop.localhost:%d", port)
	c, err := startDesktopControl(d)
	if err != nil {
		os.Exit(91)
	}
	defer c.close()
	os.Stdout.WriteString("ready\n")
	<-time.After(time.Hour)
}

func TestWindowsDesktopControlCrashResidualsCanRestartSafely(t *testing.T) {
	d := recoveryDesktop(t)
	command := nativeTestCommand(t, "-test.run=^TestWindowsDesktopControlCrashHelper$")
	command.Env = append(os.Environ(), "PIWORK_TEST_CONTROL_CRASH=1", "PIWORK_TEST_CONTROL_PORT="+strconv.Itoa(d.port))
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { command.Process.Kill(); command.Wait() }()
	ready := make(chan string, 1)
	go func() { line, _ := bufio.NewReader(output).ReadString('\n'); ready <- line }()
	select {
	case line := <-ready:
		if line != "ready\n" {
			t.Fatal("control crash fixture unavailable")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fixture timed out")
	}
	if _, err := startDesktopControl(d); err == nil {
		t.Fatal("live other process replaced")
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	command.Wait()
	fresh, err := startDesktopControl(d)
	if err != nil {
		t.Fatal("confirmed stale control not cleaned", err)
	}
	defer fresh.close()
	if _, err := requestDesktopControl(t.Context(), d.port, "open"); err != nil {
		t.Fatal("fresh instance unavailable", err)
	}
}

func TestWindowsDesktopControlRoundTripAndCleanup(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	reply, err := requestDesktopControl(ctx, d.port, "open")
	if err != nil || !validDesktopLaunchURL(reply.LaunchURL, d.port) {
		t.Fatal("trusted recovery failed", reply, err)
	}
	if _, err := startDesktopControl(d); err == nil {
		t.Fatal("duplicate control instance started")
	}
	c.close()
	if _, err := requestDesktopControl(ctx, d.port, "open"); !errors.Is(err, errDesktopControlMissing) {
		t.Fatal("closed instance recoverable", err)
	}
	fresh, err := startDesktopControl(d)
	if err != nil {
		t.Fatal("port lock not released", err)
	}
	fresh.close()
}

func TestWindowsDesktopFramesRejectAmbiguousAndOversizedMessages(t *testing.T) {
	for _, raw := range []string{`{"version":1,"version":1}`, `{"version":1,"unknown":true}`, `{"version":1} {}`, `[]`, `{"version":"bad"}`} {
		var frame bytes.Buffer
		var prefix [4]byte
		binary.BigEndian.PutUint32(prefix[:], uint32(len(raw)+1))
		frame.Write(prefix[:])
		frame.WriteString(raw + "\n")
		var request desktopControlRequest
		if desktopControlFrameRead(&frame, &request) == nil {
			t.Fatal("invalid frame accepted", raw)
		}
	}
	for _, length := range []uint32{0, desktopControlLimit + 1, ^uint32(0)} {
		var prefix [4]byte
		binary.BigEndian.PutUint32(prefix[:], length)
		if desktopControlFrameRead(bytes.NewReader(prefix[:]), &desktopControlRequest{}) == nil {
			t.Fatal("invalid frame length accepted")
		}
	}
	request := desktopControlRequest{Version: 1, InstanceID: "fixture", Port: 42, Action: "open"}
	var frame bytes.Buffer
	if err := desktopControlFrameWrite(&frame, request); err != nil {
		t.Fatal(err)
	}
	var got desktopControlRequest
	if err := desktopControlFrameRead(&frame, &got); err != nil || got != request {
		t.Fatal("frame round trip", got, err)
	}
}

func TestWindowsDesktopMetadataCannotRedirectPipeOrSpoofProcess(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	if _, err := c.dir.TryLock(desktopControlName(d.port, ".lock")); !errors.Is(err, clientfs.ErrBusy) {
		t.Fatal("instance lock not held", err)
	}
	meta := c.meta
	meta.ServerCreation++
	created, err := desktopProcessIdentity(meta.ServerPID, c.sid)
	if err != nil || created == meta.ServerCreation {
		t.Fatal("process creation is not independently verified", err)
	}
	if desktopPipeName(c.sid, d.port, "different-instance") == c.meta.PipeName {
		t.Fatal("pipe identity lacks instance binding")
	}
}
