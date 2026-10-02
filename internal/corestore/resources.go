package corestore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"piwork/internal/contracts"
)

var ErrIntentUnconfirmed = errors.New("prior resource creation must be reconciled")

type ResourceIntent struct {
	WorkID, Kind, LogicalID, Name string
	Generation                    int64
	Labels                        map[string]string
}
type ResourceBinding struct {
	InstallationID, WorkID, Kind, LogicalID, RuntimeID string
	Generation                                         int64
	LabelsJSON, ObservedAt                             string
}

func ReadResourceBinding(tx *sql.Tx, installation, workID, kind, logical string) (ResourceBinding, error) {
	var v ResourceBinding
	err := tx.QueryRow(`SELECT installation_id,work_id,resource_kind,logical_id,runtime_id,generation,labels_json,observed_at FROM resource_bindings WHERE installation_id=? AND resource_kind=? AND logical_id=?`, installation, kind, workID+"/"+logical).Scan(&v.InstallationID, &v.WorkID, &v.Kind, &v.LogicalID, &v.RuntimeID, &v.Generation, &v.LabelsJSON, &v.ObservedAt)
	return v, notFound(err)
}
func (s *Store) RecordResourceIntent(ctx context.Context, intent ResourceIntent) error {
	if intent.WorkID == "" || intent.Kind == "" || intent.LogicalID == "" || intent.Name == "" || !validBudget(intent.Generation) || intent.Labels["piwork.installation_id"] != s.installationID || intent.Labels["piwork.managed"] != "true" || intent.Labels["piwork.work_id"] != intent.WorkID {
		return ErrRevisionConflict
	}
	bytes, err := json.Marshal(intent.Labels)
	if err != nil {
		return ErrStorage
	}
	value, err := contracts.ParseJSON(strings.NewReader(string(bytes)), 1<<20)
	if err != nil {
		return err
	}
	encoded, err := contracts.EncodeCanonicalJSON(value)
	if err != nil {
		return err
	}
	return s.Write(ctx, func(tx *sql.Tx) error {
		current, err := ReadResourceBinding(tx, s.installationID, intent.WorkID, intent.Kind, intent.LogicalID)
		if err == nil {
			if current.WorkID != intent.WorkID || current.RuntimeID != intent.Name || current.Generation != intent.Generation || current.LabelsJSON != string(encoded) {
				return ErrRevisionConflict
			}
			return ErrIntentUnconfirmed
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		_, err = tx.Exec(`INSERT INTO resource_bindings(installation_id,work_id,resource_kind,logical_id,runtime_id,generation,labels_json,observed_at) VALUES(?,?,?,?,?,?,?,?)`, s.installationID, intent.WorkID, intent.Kind, intent.WorkID+"/"+intent.LogicalID, intent.Name, intent.Generation, string(encoded), nowTimestamp(""))
		if err == nil && strings.HasPrefix(intent.Kind, "package-") {
			raw, _ := json.Marshal(map[string]string{"state": "creating", "name": intent.Name, "workId": intent.WorkID, "kind": intent.Kind, "logicalId": intent.LogicalID})
			_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)`, packageAttemptKey(s.installationID, intent.WorkID, intent.Kind, intent.LogicalID), string(raw), nowTimestamp(""))
		}
		return err
	})
}

// Existing intent survives a lost create response. Recovery may remove it only
// after settling the attempt and confirming name/identity-based Engine absence.
func (s *Store) ReleaseResourceIntent(ctx context.Context, workID, kind, logical string, absenceConfirmed bool) error {
	if !absenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	return s.Write(ctx, func(tx *sql.Tx) error {
		if strings.HasPrefix(kind, "package-") {
			if _, err := tx.Exec(`DELETE FROM control_metadata WHERE key=?`, packageAttemptKey(s.installationID, workID, kind, logical)); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`DELETE FROM resource_bindings WHERE installation_id=? AND resource_kind=? AND logical_id=?`, s.installationID, kind, workID+"/"+logical)
		return err
	})
}

func packageAttemptKey(installation, work, kind, logical string) string {
	sum := sha256.Sum256([]byte(installation + "\x00" + work + "\x00" + kind + "\x00" + logical))
	return "package_attempt_" + hex.EncodeToString(sum[:])
}

// The creating marker is durable before the Engine call. A process restart
// cannot turn an unanswered create into confirmed absence merely by losing
// an in-memory uncertainty flag.
func (s *Store) PackageCreationUnsettled(ctx context.Context, work, kind, logical, name string) (bool, error) {
	raw, err := s.ControlMetadata(ctx, packageAttemptKey(s.installationID, work, kind, logical))
	if err != nil {
		return false, err
	}
	var recorded struct{ State, Name, WorkID, Kind, LogicalID string }
	if raw == nil || json.Unmarshal(raw, &recorded) != nil || recorded.Name != name || recorded.WorkID != work || recorded.Kind != kind || recorded.LogicalID != logical || recorded.State != "creating" && recorded.State != "settled" {
		return false, ErrStorage
	}
	return recorded.State == "creating", nil
}

func (s *Store) SettlePackageCreation(ctx context.Context, work, kind, logical, name string) error {
	return s.Write(ctx, func(tx *sql.Tx) error {
		binding, err := ReadResourceBinding(tx, s.installationID, work, kind, logical)
		if err != nil || binding.RuntimeID != name {
			if err != nil {
				return err
			}
			return ErrRevisionConflict
		}
		raw, _ := json.Marshal(map[string]string{"state": "settled", "name": name, "workId": work, "kind": kind, "logicalId": logical})
		result, err := tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?`, string(raw), nowTimestamp(""), packageAttemptKey(s.installationID, work, kind, logical))
		return changed(result, err, ErrStorage)
	})
}
