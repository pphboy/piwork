package cli

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"context"
	"piwork/internal/clientfs"
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

func (s desktopOperationRecords) withState(coreURL, userID string, update bool, action func(*[]desktopKnownOperation) error) error {
	if userID == "" || coreURL == "" {
		return errors.New("operation identity is missing")
	}
	if s.credentialPath == "" {
		return errors.New("credential path is missing")
	}
	directory, err := clientfs.OpenPrivateDirectory(filepath.Join(filepath.Dir(s.credentialPath), "desktop-operations-go"), true)
	if err != nil {
		return err
	}
	defer directory.Close()
	// Retain the original Linux .lock inode and blocking serialization.
	lock, err := directory.Lock(context.Background(), ".lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	key := sha256.Sum256([]byte(coreURL + "\x00" + userID))
	name := hex.EncodeToString(key[:]) + ".json"
	items := []desktopKnownOperation{}
	raw, err := directory.ReadFile(name, 8<<20)
	if err == nil {
		if json.Unmarshal(raw, &items) != nil {
			return errors.New("Desktop operation record is invalid")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := action(&items); err != nil || !update {
		return err
	}
	raw, err = json.Marshal(items)
	if err != nil || len(raw) > 8<<20 {
		return errors.New("Desktop operation record is too large")
	}
	return directory.AtomicWrite(context.Background(), name, raw)
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
