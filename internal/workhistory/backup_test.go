//go:build linux

package workhistory

import (
	"bufio"
	"context"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"path/filepath"
	"piwork/internal/workpackage"
	"reflect"
	"testing"
	"time"
)

func TestHistoryBackupRestoresExactOriginalBytesWithoutBusinessRollback(t *testing.T) {
	private, scope := brainFixture(t)
	before := fingerprint(t, private)
	spool := t.TempDir()
	contexts := []string{}
	for id := range scope.ContextIDs {
		contexts = append(contexts, id)
	}
	request := BackupRequest{OperationID: "operation-1111111111111111", WorkID: scope.SourceWorkID, BackupKey: "backup-1111111111111111", ContextIDs: contexts}
	saved, err := CheckpointHistory(context.Background(), private, spool, request)
	if err != nil {
		t.Fatal(err)
	}
	if saved.SchemaVersion != 4 || saved.State != "saved" || len(saved.ManifestDigest) != 64 {
		t.Fatal(saved)
	}
	again, err := CheckpointHistory(context.Background(), private, spool, request)
	if err != nil || again != saved {
		t.Fatal(again, err)
	}
	db, err := database(filepath.Join(private, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE runs SET final_text='candidate changed history'"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	business := filepath.Join(private, "business-user.bin")
	if os.WriteFile(business, []byte("new business state"), 0600) != nil {
		t.Fatal("business")
	}
	request.ExpectedManifestDigest = saved.ManifestDigest
	restored, err := RestoreHistoryBackup(context.Background(), private, spool, request)
	if err != nil {
		t.Fatal(err)
	}
	if restored.State != "restored" {
		t.Fatal(restored)
	}
	after := fingerprint(t, private)
	delete(after, "business-user.bin")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("history recovery changed original bytes", before, after)
	}
	if raw, err := os.ReadFile(business); err != nil || string(raw) != "new business state" {
		t.Fatal("business data rolled back", err)
	}
	if retried, err := RestoreHistoryBackup(context.Background(), private, spool, request); err != nil || retried != restored {
		t.Fatal("lost helper response must be safely retryable", retried, err)
	}
}

func TestCheckpointResumesAllocatedMemoryBeforeSavedReceipt(t *testing.T) {
	for _, published := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-path", true: "before-initialization"}[published], func(t *testing.T) {
			private, scope := brainFixture(t)
			spool := t.TempDir()
			contexts := []string{}
			for id := range scope.ContextIDs {
				contexts = append(contexts, id)
			}
			request := BackupRequest{OperationID: "operation-1111111111111111", WorkID: scope.SourceWorkID, BackupKey: "backup-1111111111111111", ContextIDs: contexts}
			saved, err := CheckpointHistory(context.Background(), private, spool, request)
			if err != nil {
				t.Fatal(err)
			}
			fd, err := workpackage.OpenDirectoryFD(spool)
			if err != nil {
				t.Fatal(err)
			}
			defer unix.Close(fd)
			manifest, _, err := backupManifest(fd)
			if err != nil {
				t.Fatal(err)
			}
			manifest.MemoryInitialized = false
			if !published {
				if err := os.Remove(filepath.Join(private, "memory.sqlite")); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := writeBackupManifest(fd, manifest); err != nil {
				t.Fatal(err)
			}
			resumed, err := CheckpointHistory(context.Background(), private, spool, request)
			if err != nil || resumed.State != "saved" {
				t.Fatal(resumed, err)
			}
			request.ExpectedManifestDigest = resumed.ManifestDigest
			if _, err := RestoreHistoryBackup(context.Background(), private, spool, request); err != nil {
				t.Fatal(err)
			}
			if saved.SchemaVersion != 4 {
				t.Fatal(saved)
			}
		})
	}
}

func TestHistoryBackupRejectsWrongDigestAndUnknownMemoryOwnership(t *testing.T) {
	for _, scenario := range []string{"digest", "inode", "link", "memory-exists"} {
		t.Run(scenario, func(t *testing.T) {
			private, scope := brainFixture(t)
			spool := t.TempDir()
			contexts := []string{}
			for id := range scope.ContextIDs {
				contexts = append(contexts, id)
			}
			request := BackupRequest{OperationID: "operation-1111111111111111", WorkID: scope.SourceWorkID, BackupKey: "backup-1111111111111111", ContextIDs: contexts}
			if scenario == "memory-exists" {
				if os.WriteFile(filepath.Join(private, "memory.sqlite"), []byte("user-owned file"), 0600) != nil {
					t.Fatal("write")
				}
				if _, err := CheckpointHistory(context.Background(), private, spool, request); err == nil {
					t.Fatal("overwrote unknown Memory")
				}
				return
			}
			result, err := CheckpointHistory(context.Background(), private, spool, request)
			if err != nil {
				t.Fatal(err)
			}
			request.ExpectedManifestDigest = result.ManifestDigest
			if scenario == "digest" {
				request.ExpectedManifestDigest = "wrong"
			}
			if scenario == "inode" || scenario == "link" {
				memory := filepath.Join(private, "memory.sqlite")
				if os.Rename(memory, memory+".original") != nil {
					t.Fatal("rename")
				}
				if scenario == "link" {
					if os.Symlink(memory+".original", memory) != nil {
						t.Fatal("link")
					}
				} else {
					raw, err := os.ReadFile(memory + ".original")
					if err != nil {
						t.Fatal(err)
					}
					if os.WriteFile(memory, raw, 0600) != nil {
						t.Fatal("write")
					}
				}
			}
			before := fingerprintExceptLinks(t, private)
			if _, err := RestoreHistoryBackup(context.Background(), private, spool, request); err == nil {
				t.Fatal("unproven recovery accepted")
			}
			if !reflect.DeepEqual(before, fingerprintExceptLinks(t, private)) {
				t.Fatal("rejected recovery changed user files")
			}
		})
	}
}
func fingerprintExceptLinks(t *testing.T, root string) map[string]string { return fingerprint(t, root) }

func TestHistoryBackupWALWriter(t *testing.T) {
	path := os.Getenv("PIWORK_HISTORY_WAL_WRITER")
	if path == "" {
		return
	}
	db, err := database(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("PRAGMA journal_mode=WAL; UPDATE runs SET final_text='durable WAL before migration'"); err != nil {
		t.Fatal(err)
	}
	os.Stdout.WriteString("wal-committed\n")
	for {
		time.Sleep(time.Hour)
	}
}

func TestHistoryBackupPreservesKilledLegacyWriterWALAndRestoresIt(t *testing.T) {
	private, scope := brainFixture(t)
	spool := t.TempDir()
	child := exec.Command(os.Args[0], "-test.run=^TestHistoryBackupWALWriter$")
	child.Env = append(os.Environ(), "PIWORK_HISTORY_WAL_WRITER="+filepath.Join(private, "work.sqlite"))
	pipe, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.Process.Kill() })
	ready := make(chan bool, 1)
	go func() {
		scanner := bufio.NewScanner(pipe)
		ready <- scanner.Scan() && scanner.Text() == "wal-committed"
	}()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("writer did not commit WAL")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("WAL writer timeout")
	}
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	before := fingerprint(t, private)
	if before["work.sqlite-wal"] == "" {
		t.Fatal("not an actual persisted WAL")
	}
	contexts := []string{}
	for id := range scope.ContextIDs {
		contexts = append(contexts, id)
	}
	request := BackupRequest{OperationID: "operation-1111111111111111", WorkID: scope.SourceWorkID, BackupKey: "backup-1111111111111111", ContextIDs: contexts}
	result, err := CheckpointHistory(context.Background(), private, spool, request)
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := database(filepath.Join(private, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := candidate.Exec("UPDATE runs SET final_text='candidate changes'"); err != nil {
		t.Fatal(err)
	}
	candidate.Close()
	request.ExpectedManifestDigest = result.ManifestDigest
	if _, err := RestoreHistoryBackup(context.Background(), private, spool, request); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, fingerprint(t, private)) {
		t.Fatal("WAL recovery changed original history bytes")
	}
	restored, err := database(filepath.Join(private, "work.sqlite"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var text string
	if err := restored.QueryRow("SELECT final_text FROM runs").Scan(&text); err != nil || text != "durable WAL before migration" {
		t.Fatal(text, err)
	}
}
