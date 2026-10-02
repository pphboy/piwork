package corestore

import (
	"context"
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
	_ "modernc.org/sqlite"
	"piwork/internal/contracts"
	"piwork/internal/safefs"
)

const Format = "piwork-go-core"
const SchemaVersion = 1
const MarkerName = "core-format.json"
const DatabaseName = "core.sqlite"

var ErrUnsupported = errors.New("CORE_STORAGE_FORMAT_UNSUPPORTED: use an independent supported Go data directory")
var ErrStorage = errors.New("Core storage could not be opened safely")
var ErrClosed = errors.New("Core store is closed")
var identityPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]{15,127}$`)

//go:embed schema.sql
var schemaSQL string

//go:embed schema-objects.json
var schemaObjects []byte

type Marker struct {
	Format         string `json:"format"`
	SchemaVersion  int    `json:"schemaVersion"`
	InstallationID string `json:"installationId"`
	Phase          string `json:"phase"`
}
type Options struct {
	Directory      string
	InstallationID string
	// An explicitly configured operator filename in the Core root is a managed
	// file. It never permits arbitrary extra files or changes an unmarked root.
	OperatorCredentialName string
	// Failure injection belongs only to package-local tests.
	fault func(stage string) error
}
type Store struct {
	root           *safefs.Root
	writer         *sql.DB
	reader         *sql.DB
	installationID string
	mu             sync.Mutex
	life           sync.RWMutex
	closed         bool
	transientMu    sync.Mutex
	transientWork  map[string]int
}

func Open(ctx context.Context, options Options) (_ *Store, returned error) {
	if name := options.OperatorCredentialName; name != "" {
		if !safefs.ValidFileName(name) || name == MarkerName || strings.HasPrefix(name, DatabaseName) || name == "runtime-profile.json" || strings.HasPrefix(name, ".core-format-") {
			return nil, ErrUnsupported
		}
		for _, managed := range managedDirectories {
			if name == managed {
				return nil, ErrUnsupported
			}
		}
	}
	root, err := safefs.OpenRoot(options.Directory)
	if err != nil {
		return nil, ErrStorage
	}
	keep := false
	defer func() {
		if !keep {
			root.Close()
		}
	}()
	if err := root.Lock(); err != nil {
		return nil, err
	}
	entries, err := root.Entries()
	if err != nil {
		return nil, ErrStorage
	}
	marker, err := readMarker(root, MarkerName)
	if errors.Is(err, os.ErrNotExist) {
		if len(entries) == 0 {
			if options.fault != nil {
				if err := options.fault("before-marker"); err != nil {
					return nil, err
				}
			}
			id := options.InstallationID
			if id == "" {
				id, err = newIdentity()
				if err != nil {
					return nil, ErrStorage
				}
			}
			if !identityPattern.MatchString(id) {
				return nil, ErrUnsupported
			}
			marker = Marker{Format: Format, SchemaVersion: SchemaVersion, InstallationID: id, Phase: "initializing"}
			if err := root.MakePrivate(); err != nil {
				return nil, ErrStorage
			}
			if err := writeMarker(root, marker); err != nil {
				return nil, ErrStorage
			}
		} else {
			// Only a fully persisted, identity-bound marker temporary is proof
			// of interruption before first publication. Arbitrary files fail.
			if len(entries) != 1 || !strings.HasPrefix(entries[0], ".core-format-") || !strings.HasSuffix(entries[0], ".tmp") {
				return nil, ErrUnsupported
			}
			marker, err = readMarker(root, entries[0])
			if err != nil || marker.Phase != "initializing" || entries[0] != markerTemp(marker.InstallationID) {
				return nil, ErrUnsupported
			}
			if err := root.Rename(entries[0], MarkerName); err != nil {
				return nil, ErrStorage
			}
		}
	} else if err != nil {
		return nil, ErrUnsupported
	}
	if options.InstallationID != "" && options.InstallationID != marker.InstallationID {
		return nil, ErrUnsupported
	}
	if err := validateDirectory(root, marker, options.OperatorCredentialName); err != nil {
		return nil, err
	}
	if marker.Phase == "initializing" {
		if options.fault != nil {
			if err := options.fault("after-marker"); err != nil {
				return nil, err
			}
		}
		if err := initialize(ctx, root, marker, options.fault); err != nil {
			return nil, err
		}
		marker.Phase = "ready"
	}
	if err := verifyDatabase(ctx, root, DatabaseName, marker, true); err != nil {
		return nil, err
	}
	for _, directory := range managedDirectories {
		if err := root.EnsureDirectory(directory); err != nil {
			return nil, ErrStorage
		}
	}
	writer, err := openDatabase(root, DatabaseName, false, false)
	if err != nil {
		return nil, ErrStorage
	}
	if err := verifyConnection(ctx, writer, marker); err != nil {
		writer.Close()
		return nil, err
	}
	reader, err := openDatabase(root, DatabaseName, true, false)
	if err != nil {
		writer.Close()
		return nil, ErrStorage
	}
	keep = true
	return &Store{root: root, writer: writer, reader: reader, installationID: marker.InstallationID}, nil
}
func newIdentity() (string, error) {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", err
	}
	return "installation-" + hex.EncodeToString(data[:]), nil
}
func markerTemp(id string) string   { return ".core-format-" + id + ".tmp" }
func databaseTemp(id string) string { return "core.sqlite." + id + ".initializing" }
func readMarker(root *safefs.Root, name string) (Marker, error) {
	var result Marker
	raw, err := root.ReadFile(name, 4096)
	if err != nil {
		return result, err
	}
	value, err := contracts.ParseJSON(strings.NewReader(string(raw)), 4096)
	if err != nil {
		return result, ErrUnsupported
	}
	object, ok := value.(map[string]any)
	if !ok || len(object) != 4 || object["format"] != Format || object["schemaVersion"] != int64(SchemaVersion) {
		return result, ErrUnsupported
	}
	id, ok := object["installationId"].(string)
	if !ok || !identityPattern.MatchString(id) {
		return result, ErrUnsupported
	}
	phase, ok := object["phase"].(string)
	if !ok || (phase != "initializing" && phase != "ready") {
		return result, ErrUnsupported
	}
	return Marker{Format: Format, SchemaVersion: SchemaVersion, InstallationID: id, Phase: phase}, nil
}
func writeMarker(root *safefs.Root, marker Marker) error {
	temp := markerTemp(marker.InstallationID)
	if prior, err := readMarker(root, temp); err == nil {
		if prior.InstallationID != marker.InstallationID {
			return ErrUnsupported
		}
		if err := root.Remove(temp); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return ErrUnsupported
	}
	raw, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	return root.AtomicWrite(MarkerName, temp, append(raw, '\n'))
}

var managedDirectories = []string{"secrets", "runtime", "skills", "works", "snapshots", "pi-packages"}

func validateDirectory(root *safefs.Root, marker Marker, operatorName string) error {
	if root.CheckPrivate() != nil {
		return ErrUnsupported
	}
	entries, err := root.Entries()
	if err != nil {
		return ErrStorage
	}
	files := map[string]bool{MarkerName: true, DatabaseName: true, DatabaseName + "-wal": true, DatabaseName + "-shm": true}
	directories := make(map[string]bool)
	if marker.Phase == "initializing" {
		temp := databaseTemp(marker.InstallationID)
		files[temp] = true
		files[temp+"-wal"] = true
		files[temp+"-shm"] = true
		files[temp+"-journal"] = true
		files[markerTemp(marker.InstallationID)] = true
	} else {
		files["operator.credential"] = true
		files["runtime-profile.json"] = true
		for _, name := range managedDirectories {
			directories[name] = true
		}
		if operatorName != "" {
			if !safefs.ValidFileName(operatorName) || files[operatorName] && operatorName != "operator.credential" || directories[operatorName] {
				return ErrUnsupported
			}
			files[operatorName] = true
		}
	}
	for _, entry := range entries {
		if !files[entry] && !directories[entry] {
			return ErrUnsupported
		}
		if err := root.CheckEntry(entry, directories[entry]); err != nil {
			return ErrUnsupported
		}
		if entry == markerTemp(marker.InstallationID) {
			pending, err := readMarker(root, entry)
			if err != nil || pending.InstallationID != marker.InstallationID {
				return ErrUnsupported
			}
		}
	}
	return nil
}
func openDatabase(root *safefs.Root, name string, readonly, immutable bool) (*sql.DB, error) {
	path, err := root.Path(name)
	if err != nil {
		return nil, err
	}
	query := url.Values{"_pragma": []string{"foreign_keys(1)", "busy_timeout(5000)"}, "mode": []string{"rw"}}
	if readonly {
		query.Set("mode", "ro")
		query.Add("_pragma", "query_only(1)")
	} else {
		query.Add("_pragma", "journal_mode(WAL)")
		query.Add("_pragma", "synchronous(FULL)")
		query.Set("_txlock", "immediate")
	}
	if immutable {
		query.Set("immutable", "1")
	}
	db, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: path, RawQuery: query.Encode()}).String())
	if err != nil {
		return nil, err
	}
	if readonly {
		db.SetMaxOpenConns(4)
	} else {
		db.SetMaxOpenConns(1)
	}
	return db, nil
}
func verifyConnection(ctx context.Context, db *sql.DB, marker Marker) error {
	var format, id string
	var version, userVersion int
	if err := db.QueryRowContext(ctx, "SELECT format,schema_version,installation_id FROM go_core_metadata WHERE id=1").Scan(&format, &version, &id); err != nil {
		return ErrUnsupported
	}
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&userVersion); err != nil {
		return ErrUnsupported
	}
	if format != marker.Format || version != marker.SchemaVersion || userVersion != SchemaVersion || id != marker.InstallationID {
		return ErrUnsupported
	}
	if err := verifySchema(ctx, db); err != nil {
		return err
	}
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); err != nil || integrity != "ok" {
		return ErrUnsupported
	}
	return nil
}

var expectedSchema = sync.OnceValue(func() map[string]string {
	var objects map[string]string
	if json.Unmarshal(schemaObjects, &objects) != nil {
		panic("invalid compiled Core schema")
	}
	return objects
})

func verifySchema(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, "SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL")
	if err != nil {
		return ErrUnsupported
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var name, sql string
		if rows.Scan(&name, &sql) != nil {
			return ErrUnsupported
		}
		if expectedSchema()[name] != strings.TrimSpace(sql) {
			return ErrUnsupported
		}
		count++
	}
	if rows.Err() != nil || count != len(expectedSchema()) {
		return ErrUnsupported
	}
	return nil
}
func verifyDatabase(ctx context.Context, root *safefs.Root, name string, marker Marker, immutable bool) error {
	if err := root.CheckEntry(name, false); err != nil {
		return ErrUnsupported
	}
	db, err := openDatabase(root, name, true, immutable)
	if err != nil {
		return ErrUnsupported
	}
	defer db.Close()
	return verifyConnection(ctx, db, marker)
}
func initialize(ctx context.Context, root *safefs.Root, marker Marker, fault func(string) error) error {
	if _, err := root.ReadFile(DatabaseName, 0); !errors.Is(err, os.ErrNotExist) {
		if err := verifyDatabase(ctx, root, DatabaseName, marker, true); err != nil {
			return err
		}
	} else {
		temp := databaseTemp(marker.InstallationID)
		file, err := root.OpenFile(temp, unix.O_RDWR|unix.O_CREAT)
		if err != nil {
			return ErrStorage
		}
		if err := file.Close(); err != nil {
			return ErrStorage
		}
		if fault != nil {
			if err := fault("after-database-file"); err != nil {
				return err
			}
		}
		db, err := openDatabase(root, temp, false, false)
		if err != nil {
			return ErrStorage
		}
		defer db.Close()
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&count); err != nil {
			return ErrUnsupported
		}
		if count == 0 {
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				return ErrStorage
			}
			committed := false
			defer func() {
				if !committed {
					tx.Rollback()
				}
			}()
			if _, err := tx.ExecContext(ctx, schemaSQL); err != nil {
				return ErrStorage
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO go_core_metadata(id,format,schema_version,installation_id) VALUES(1,?,?,?)", Format, SchemaVersion, marker.InstallationID); err != nil {
				return ErrStorage
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO control_metadata(key,value_json,updated_at) VALUES
('default_work_configuration','{"version":1,"revision":0,"configuration":null}',?),
('work_storage_format','{"version":2,"layout":"split-private-workspace"}',?)`, time.Now().UTC().Format(time.RFC3339Nano), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
				return ErrStorage
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO work_file_core_epoch(id,epoch) VALUES(1,0); PRAGMA user_version=1;"); err != nil {
				return ErrStorage
			}
			if fault != nil {
				if err := fault("before-database-commit"); err != nil {
					return err
				}
			}
			if err := tx.Commit(); err != nil {
				return ErrStorage
			}
			committed = true
		} else if err := verifyConnection(ctx, db, marker); err != nil {
			return err
		}
		if fault != nil {
			if err := fault("after-database-commit"); err != nil {
				return err
			}
		}
		if _, err := db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
			return ErrStorage
		}
		if err := db.Close(); err != nil {
			return ErrStorage
		}
		file, err = root.OpenFile(temp, unix.O_RDONLY)
		if err != nil {
			return ErrStorage
		}
		err = file.Sync()
		closeErr := file.Close()
		if err != nil || closeErr != nil {
			return ErrStorage
		}
		if err := root.Rename(temp, DatabaseName); err != nil {
			return ErrStorage
		}
	}
	if fault != nil {
		if err := fault("after-database-publish"); err != nil {
			return err
		}
	}
	marker.Phase = "ready"
	if err := writeMarker(root, marker); err != nil {
		return ErrStorage
	}
	if fault != nil {
		if err := fault("after-marker-publish"); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) InstallationID() string { return s.installationID }

// Write serializes short durable mutations. Callers must commit before any
// Docker/RPC/network effect; operations persist their fence within this callback.
func (s *Store) Write(ctx context.Context, callback func(*sql.Tx) error) error {
	s.life.RLock()
	defer s.life.RUnlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ErrClosed
	}
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return ErrStorage
	}
	defer tx.Rollback()
	if err := callback(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return ErrStorage
	}
	return nil
}
func (s *Store) Read(ctx context.Context, callback func(*sql.Tx) error) error {
	s.life.RLock()
	defer s.life.RUnlock()
	if s.closed {
		return ErrClosed
	}
	reader := s.reader
	tx, err := reader.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ErrStorage
	}
	defer tx.Rollback()
	if err := callback(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Close() error {
	s.life.Lock()
	defer s.life.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	err := s.reader.Close()
	_, checkpointErr := s.writer.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return errors.Join(err, checkpointErr, s.writer.Close(), s.root.Close())
}

func (s *Store) String() string { return fmt.Sprintf("%s/schema%d", Format, SchemaVersion) }
