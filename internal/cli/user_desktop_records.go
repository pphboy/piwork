package cli

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type desktopKnownOperation struct {
	OperationID string `json:"operationId"`
	Type        string `json:"type"`
	WorkID      string `json:"workId,omitempty"`
	ServiceID   string `json:"serviceId,omitempty"`
	SnapshotID  string `json:"snapshotId,omitempty"`
	RecordedAt  string `json:"recordedAt"`
	Terminal    bool   `json:"terminal,omitempty"`
	Hidden      bool   `json:"hidden,omitempty"`
}

type desktopOperationRecords struct{ credentialPath string }

func (s desktopOperationRecords) directory() (string, error) {
	if s.credentialPath == "" {
		return "", errors.New("credential path is missing")
	}
	directory := filepath.Join(filepath.Dir(s.credentialPath), "desktop-operations-go")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return "", errors.New("Desktop operation directory is unsafe")
	}
	return directory, nil
}

func (s desktopOperationRecords) withState(coreURL, userID string, update bool, action func(*[]desktopKnownOperation) error) error {
	if userID == "" || coreURL == "" {
		return errors.New("operation identity is missing")
	}
	directory, err := s.directory()
	if err != nil {
		return err
	}
	fd, err := unix.Open(filepath.Join(directory, ".lock"), unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	if err := unix.Flock(fd, unix.LOCK_EX); err != nil {
		return err
	}
	defer unix.Flock(fd, unix.LOCK_UN)
	key := sha256.Sum256([]byte(coreURL + "\x00" + userID))
	path := filepath.Join(directory, hex.EncodeToString(key[:])+".json")
	items := []desktopKnownOperation{}
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err == nil {
		info, statErr := file.Stat()
		if statErr != nil || !info.Mode().IsRegular() || info.Size() > 8<<20 {
			file.Close()
			return errors.New("Desktop operation record is unsafe")
		}
		raw, readErr := io.ReadAll(io.LimitReader(file, (8<<20)+1))
		file.Close()
		if readErr != nil || len(raw) > 8<<20 || json.Unmarshal(raw, &items) != nil {
			return errors.New("Desktop operation record is invalid")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := action(&items); err != nil || !update {
		return err
	}
	raw, err := json.Marshal(items)
	if err != nil || len(raw) > 8<<20 {
		return errors.New("Desktop operation record is too large")
	}
	var nonce [12]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	temporary := filepath.Join(directory, ".tmp-"+hex.EncodeToString(nonce[:]))
	output, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer os.Remove(temporary)
	if _, err = output.Write(raw); err == nil {
		err = output.Sync()
	}
	closeErr := output.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(temporary, path); err != nil {
		return err
	}
	parent, err := os.Open(directory)
	if err != nil {
		return err
	}
	err = parent.Sync()
	parent.Close()
	return err
}

func (s desktopOperationRecords) accept(coreURL, userID, kind string, result json.RawMessage) error {
	var value struct{ OperationID, WorkID, ServiceID, SnapshotID string }
	if json.Unmarshal(result, &value) != nil || !desktopIDPattern.MatchString(value.OperationID) {
		return errors.New("Core did not return an Operation ID")
	}
	for _, id := range []string{value.WorkID, value.ServiceID, value.SnapshotID} {
		if id != "" && !desktopIDPattern.MatchString(id) {
			return errors.New("Core returned an invalid Operation reference")
		}
	}
	if len(kind) > 80 {
		kind = kind[:80]
	}
	entry := desktopKnownOperation{OperationID: value.OperationID, Type: kind, WorkID: value.WorkID,
		ServiceID: value.ServiceID, SnapshotID: value.SnapshotID, RecordedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	return s.withState(coreURL, userID, true, func(items *[]desktopKnownOperation) error {
		for index := range *items {
			if (*items)[index].OperationID == entry.OperationID {
				(*items)[index] = entry
				return nil
			}
		}
		*items = append(*items, entry)
		return nil
	})
}

func (s desktopOperationRecords) markTerminal(coreURL, userID, operationID string) error {
	if !desktopIDPattern.MatchString(operationID) {
		return errors.New("invalid Operation ID")
	}
	return s.withState(coreURL, userID, true, func(items *[]desktopKnownOperation) error {
		for index := range *items {
			if (*items)[index].OperationID == operationID && !(*items)[index].Hidden {
				(*items)[index].Terminal = true
			}
		}
		return nil
	})
}

func (s desktopOperationRecords) hide(coreURL, userID, operationID string) error {
	if !desktopIDPattern.MatchString(operationID) {
		return errors.New("invalid Operation ID")
	}
	return s.withState(coreURL, userID, true, func(items *[]desktopKnownOperation) error {
		for index := range *items {
			if (*items)[index].OperationID == operationID {
				(*items)[index].Hidden = true
			}
		}
		return nil
	})
}

func (s desktopOperationRecords) list(coreURL, userID string) ([]desktopKnownOperation, error) {
	var result []desktopKnownOperation
	err := s.withState(coreURL, userID, false, func(items *[]desktopKnownOperation) error {
		sort.Slice(*items, func(i, j int) bool { return (*items)[i].RecordedAt > (*items)[j].RecordedAt })
		terminal := 0
		for _, item := range *items {
			if item.Hidden || !desktopIDPattern.MatchString(item.OperationID) || strings.TrimSpace(item.RecordedAt) == "" {
				continue
			}
			if item.Terminal {
				terminal++
				if terminal > 500 {
					continue
				}
			}
			result = append(result, item)
		}
		return nil
	})
	if result == nil {
		result = []desktopKnownOperation{}
	}
	return result, err
}
