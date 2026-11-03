// Linux development supervisor. Subreaping preserves ownership across setsid.
package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type result struct {
	ExitCode         int  `json:"exitCode"`
	Orphaned         bool `json:"orphaned"`
	CleanupConfirmed bool `json:"cleanupConfirmed"`
}

func descendants() ([]int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	parents := map[int]int{}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		fields := strings.Fields(string(raw)[strings.LastIndex(string(raw), ")")+1:])
		if len(fields) < 2 {
			return nil, errors.New("invalid process observation")
		}
		ppid, err := strconv.Atoi(fields[1])
		if err != nil {
			return nil, err
		}
		parents[pid] = ppid
	}
	owned := map[int]bool{os.Getpid(): true}
	for changed := true; changed; {
		changed = false
		for pid, parent := range parents {
			if owned[parent] && !owned[pid] {
				owned[pid] = true
				changed = true
			}
		}
	}
	var ids []int
	for pid := range owned {
		if pid != os.Getpid() {
			ids = append(ids, pid)
		}
	}
	return ids, nil
}

func sendOwned(signal syscall.Signal) bool {
	ids, err := descendants()
	if err != nil {
		return false
	}
	for _, pid := range ids {
		if err := syscall.Kill(pid, signal); err != nil && err != syscall.ESRCH {
			return false
		}
	}
	return true
}

// Only called after Cmd.Wait reaps the primary child, avoiding competing waits.
func reap() (bool, error) {
	for {
		pid, err := syscall.Wait4(-1, nil, syscall.WNOHANG, nil)
		if err == syscall.ECHILD {
			return true, nil
		}
		if err == syscall.EINTR {
			continue
		}
		if err != nil {
			return false, err
		}
		if pid == 0 {
			return false, nil
		}
	}
}

func run() result {
	outcome := result{ExitCode: -1}
	if len(os.Args) < 3 || unix.Prctl(unix.PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != nil {
		return outcome
	}
	millis, err := strconv.Atoi(os.Args[1])
	if err != nil || millis < 1 {
		return outcome
	}
	signals := make(chan os.Signal, 2)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)
	child := exec.Command(os.Args[2], os.Args[3:]...)
	child.Stdout, child.Stderr = os.Stdout, os.Stderr
	child.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if child.Start() != nil {
		outcome.CleanupConfirmed = true
		return outcome
	}
	waited := make(chan error, 1)
	go func() { waited <- child.Wait() }()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	var deadline time.Time
	stopped := false
	for !stopped {
		select {
		case <-signals:
			if deadline.IsZero() {
				deadline = time.Now().Add(time.Duration(millis) * time.Millisecond)
			}
			_ = sendOwned(syscall.SIGTERM)
		case err := <-waited:
			stopped = true
			outcome.ExitCode = 0
			if err != nil {
				outcome.ExitCode = child.ProcessState.ExitCode()
			}
		case <-tick.C:
			if !deadline.IsZero() && time.Now().After(deadline) {
				_ = sendOwned(syscall.SIGKILL)
			}
		}
	}
	empty, err := reap()
	if err != nil {
		return outcome
	}
	outcome.Orphaned = !empty
	if deadline.IsZero() {
		deadline = time.Now().Add(time.Duration(millis) * time.Millisecond)
	}
	hard := deadline.Add(time.Second)
	for !empty {
		if time.Now().After(hard) {
			return outcome
		}
		signal := syscall.SIGTERM
		if time.Now().After(deadline) {
			signal = syscall.SIGKILL
		}
		if !sendOwned(signal) {
			return outcome
		}
		time.Sleep(5 * time.Millisecond)
		empty, err = reap()
		if err != nil {
			return outcome
		}
	}
	outcome.CleanupConfirmed = true
	return outcome
}

func main() {
	outcome := run()
	status := os.NewFile(3, "supervisor-status")
	if status == nil || json.NewEncoder(status).Encode(outcome) != nil {
		os.Exit(1)
	}
	status.Close()
	if !outcome.CleanupConfirmed {
		os.Exit(1)
	}
}
