package corestore

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"piwork/internal/contracts"
)

type DefaultWorkConfiguration struct {
	Version       int                   `json:"version"`
	Revision      int64                 `json:"revision"`
	Configuration *contracts.WorkConfig `json:"configuration"`
}

func readDefaultWork(tx *sql.Tx) (DefaultWorkConfiguration, error) {
	var raw string
	if err := tx.QueryRow(`SELECT value_json FROM control_metadata WHERE key='default_work_configuration'`).Scan(&raw); err != nil {
		return DefaultWorkConfiguration{}, err
	}
	if _, err := contracts.ParseJSON(strings.NewReader(raw), 2<<20); err != nil {
		return DefaultWorkConfiguration{}, ErrStorage
	}
	var view DefaultWorkConfiguration
	decoder := json.NewDecoder(bytes.NewReader([]byte(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&view) != nil || view.Version != 1 || view.Revision < 0 || view.Revision > contracts.MaxSafeInteger {
		return DefaultWorkConfiguration{}, ErrStorage
	}
	if view.Configuration != nil {
		encoded, err := json.Marshal(view.Configuration)
		if err != nil {
			return DefaultWorkConfiguration{}, ErrStorage
		}
		if _, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(encoded), "WorkConfigSchema", 2<<20); err != nil {
			return DefaultWorkConfiguration{}, ErrStorage
		}
	}
	return view, nil
}

// ReadDefaultWorkTx lets a catalog mutation check default references in the
// same transaction that changes its selected package head.
func ReadDefaultWorkTx(tx *sql.Tx) (DefaultWorkConfiguration, error) {
	return readDefaultWork(tx)
}

// AppendDefaultPackageTx publishes the catalog and its default selection in
// one transaction, merging the latest defaults instead of overwriting edits.
func AppendDefaultPackageTx(tx *sql.Tx, name contracts.PiPackageName, now string) error {
	current, err := readDefaultWork(tx)
	if err != nil {
		return err
	}
	if current.Configuration == nil || current.Revision >= contracts.MaxSafeInteger {
		return ErrRevisionConflict
	}
	for _, item := range current.Configuration.Packages {
		if item.Name == name {
			return nil
		}
	}
	if len(current.Configuration.Packages) >= 64 {
		return contracts.NewError("INVALID_CONFIGURATION", "packages")
	}
	current.Configuration.Packages = append(current.Configuration.Packages, contracts.PiPackageSelectionEntry{Name: name, Enabled: true})
	current.Revision++
	raw, err := json.Marshal(current)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key='default_work_configuration'`, string(raw), now)
	return err
}

func (s *Store) DefaultWork(ctx context.Context) (DefaultWorkConfiguration, error) {
	var view DefaultWorkConfiguration
	err := s.Read(ctx, func(tx *sql.Tx) error { var err error; view, err = readDefaultWork(tx); return err })
	return view, err
}

// CompareAndSwapDefaultWork stores an independently copied configuration.
// The caller resolves catalog references before this transaction; a stale
// revision cannot overwrite a newer default.
func (s *Store) CompareAndSwapDefaultWork(ctx context.Context, expected int64, configuration contracts.WorkConfig) (DefaultWorkConfiguration, error) {
	var output DefaultWorkConfiguration
	encoded, err := json.Marshal(configuration)
	if err != nil {
		return output, contracts.NewError("INVALID_CONFIGURATION", "")
	}
	validated, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(encoded), "WorkConfigSchema", 2<<20)
	if err != nil {
		return output, err
	}
	err = s.Write(ctx, func(tx *sql.Tx) error {
		current, err := readDefaultWork(tx)
		if err != nil {
			return err
		}
		if expected != current.Revision || current.Revision >= contracts.MaxSafeInteger {
			return ErrRevisionConflict
		}
		output = DefaultWorkConfiguration{Version: 1, Revision: current.Revision + 1, Configuration: &validated}
		raw, err := json.Marshal(output)
		if err != nil {
			return ErrStorage
		}
		result, err := tx.ExecContext(ctx, `UPDATE control_metadata SET value_json=?,updated_at=? WHERE key='default_work_configuration'`, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return ErrStorage
		}
		return nil
	})
	if err != nil {
		return DefaultWorkConfiguration{}, err
	}
	return output, nil
}

// UpdateDefaultWork merges and validates a default configuration inside one
// write transaction. Callers can authorize the actor and resolve catalog
// references using the same transaction; no public revision is required.
func (s *Store) UpdateDefaultWork(ctx context.Context, mutate func(*sql.Tx, DefaultWorkConfiguration) (contracts.WorkConfig, error)) (DefaultWorkConfiguration, error) {
	var output DefaultWorkConfiguration
	err := s.Write(ctx, func(tx *sql.Tx) error {
		current, err := readDefaultWork(tx)
		if err != nil {
			return err
		}
		if current.Configuration == nil || current.Revision >= contracts.MaxSafeInteger {
			return contracts.NewError("CONFLICT", "")
		}
		candidate, err := mutate(tx, current)
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(candidate)
		if err != nil {
			return contracts.NewError("INVALID_REQUEST", "")
		}
		validated, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(encoded), "WorkConfigSchema", 2<<20)
		if err != nil {
			return err
		}
		output = DefaultWorkConfiguration{Version: 1, Revision: current.Revision + 1, Configuration: &validated}
		raw, err := json.Marshal(output)
		if err != nil {
			return ErrStorage
		}
		result, err := tx.ExecContext(ctx, `UPDATE control_metadata SET value_json=?,updated_at=? WHERE key='default_work_configuration'`, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return ErrStorage
		}
		return nil
	})
	return output, err
}

// SyncDefaultWorkRuntime changes only the two runtime-owned references when a
// new installation runtime revision is accepted. Custom defaults for Skills,
// packages, AGENTS.md, tools, MCP, and resources remain intact.
func (s *Store) SyncDefaultWorkRuntime(ctx context.Context, runtimeRevision int64, imageID, modelID contracts.ResourceId, ifEmpty contracts.WorkConfig) error {
	return s.Write(ctx, func(tx *sql.Tx) error {
		return SyncDefaultWorkRuntimeTx(ctx, tx, runtimeRevision, imageID, modelID, ifEmpty)
	})
}

// SyncDefaultWorkRuntimeTx publishes reference selection in the same transaction
// as the provider/model admission check.
func SyncDefaultWorkRuntimeTx(ctx context.Context, tx *sql.Tx, runtimeRevision int64, imageID, modelID contracts.ResourceId, ifEmpty contracts.WorkConfig) error {
	if runtimeRevision < 1 || runtimeRevision > contracts.MaxSafeInteger || imageID == "" || modelID == "" {
		return contracts.NewError("INVALID_REQUEST", "")
	}

	var marker string
	err := tx.QueryRowContext(ctx, `SELECT value_json FROM control_metadata WHERE key='default_work_source_runtime'`).Scan(&marker)
	var prior struct {
		Version  int   `json:"version"`
		Revision int64 `json:"revision"`
	}
	if err == nil {
		if json.Unmarshal([]byte(marker), &prior) != nil || prior.Version != 1 || prior.Revision < 1 || prior.Revision > runtimeRevision {
			return ErrStorage
		}
		if prior.Revision == runtimeRevision {
			return nil
		}
	} else if err != sql.ErrNoRows {
		return err
	}
	current, err := readDefaultWork(tx)
	if err != nil || current.Revision >= contracts.MaxSafeInteger {
		return ErrStorage
	}
	configuration := ifEmpty
	if current.Configuration != nil {
		configuration = *current.Configuration
	}
	configuration.AgentImage.CatalogId = imageID
	configuration.ModelRef = modelID
	encoded, err := json.Marshal(configuration)
	if err != nil {
		return ErrStorage
	}
	validated, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(encoded), "WorkConfigSchema", 2<<20)
	if err != nil {
		return ErrStorage
	}
	current.Configuration = &validated
	current.Revision++
	raw, err := json.Marshal(current)
	if err != nil {
		return ErrStorage
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `UPDATE control_metadata SET value_json=?,updated_at=? WHERE key='default_work_configuration'`, string(raw), now); err != nil {
		return err
	}
	source, _ := json.Marshal(struct {
		Version  int   `json:"version"`
		Revision int64 `json:"revision"`
	}{1, runtimeRevision})
	_, err = tx.ExecContext(ctx, `INSERT INTO control_metadata(key,value_json,updated_at) VALUES('default_work_source_runtime',?,?)
			ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, string(source), now)
	return err
}
