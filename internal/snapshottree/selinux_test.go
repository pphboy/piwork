//go:build linux

package snapshottree

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

// Opt in only on a real Enforcing host; absence of labels is a failure there.
func TestSELinuxHostLabelsAndOwnedTrees(t *testing.T) {
	if os.Getenv("PIWORK_TEST_SELINUX") != "1" {
		t.Skip("set PIWORK_TEST_SELINUX=1 on a SELinux Enforcing test host")
	}
	enforce, err := os.ReadFile("/sys/fs/selinux/enforce")
	if err != nil || string(bytes.TrimSpace(enforce)) != "1" {
		t.Fatal("SELinux Enforcing required", err)
	}
	for _, kind := range []string{"volume", "empty-volume", "skill", "package"} {
		t.Run(kind, func(t *testing.T) {
			source, target, blobs := fixture(t)
			control := filepath.Join(filepath.Dir(source), "control")
			if err := os.Mkdir(control, 0700); err != nil {
				t.Fatal(err)
			}
			setSELinuxLabel(t, source, "system_u:object_r:container_file_t:s0:c11,c12")
			setSELinuxLabel(t, target, "system_u:object_r:container_file_t:s0:c21,c22")
			setSELinuxLabel(t, control, "system_u:object_r:container_file_t:s0:c21,c22")
			paths := []string{""}
			if kind != "empty-volume" {
				paths = append(paths, "directory", "directory/file", "hardlink")
				if kind != "skill" {
					paths = append(paths, "external-link")
				}
				for _, root := range []string{source, control} {
					if err := os.Mkdir(filepath.Join(root, "directory"), 0750); err != nil {
						t.Fatal(err)
					}
					file := filepath.Join(root, "directory/file")
					if err := os.WriteFile(file, []byte("portable content"), 0751); err != nil {
						t.Fatal(err)
					}
					if err := os.Link(file, filepath.Join(root, "hardlink")); err != nil {
						t.Fatal(err)
					}
					if kind != "skill" {
						if err := os.Symlink("/outside/never-read", filepath.Join(root, "external-link")); err != nil {
							t.Fatal(err)
						}
					}
				}
			}
			before := map[string]string{}
			for _, path := range paths {
				name := filepath.Join(source, path)
				setSELinuxLabel(t, name, "system_u:object_r:container_file_t:s0:c11,c12")
				before[path] = selinuxLabel(t, name)
			}
			targetLabel := selinuxLabel(t, target)
			if before[""] == targetLabel {
				t.Fatal("source and destination labels must differ")
			}
			ctx := context.Background()
			capture := func() (Result, error) {
				if kind == "skill" || kind == "package" {
					return CaptureOwned(ctx, source, blobs, kind == "package")
				}
				return Capture(ctx, source, blobs)
			}
			captured, err := capture()
			if err != nil {
				t.Fatal(err)
			}
			for _, path := range paths {
				if got := selinuxLabel(t, filepath.Join(source, path)); got != before[path] {
					t.Fatal("capture changed source label", path, got)
				}
			}
			raw, err := blobs.ReadMetadata(ctx, captured.Tree)
			if err != nil || bytes.Contains(raw, []byte("security.selinux")) || bytes.Contains(raw, []byte("container_file_t")) {
				t.Fatal("host label entered tree metadata", err)
			}
			if _, err := Restore(ctx, target, blobs, captured.Tree, kind == "skill" || kind == "package"); err != nil {
				t.Fatal(err)
			}
			if got := selinuxLabel(t, target); got != targetLabel {
				t.Fatal("restore changed destination label", got, targetLabel)
			}
			for _, path := range paths {
				if got, want := selinuxLabel(t, filepath.Join(target, path)), selinuxLabel(t, filepath.Join(control, path)); got != want {
					t.Fatal("destination creation policy changed", path, got, want)
				}
				if got, want := snapshotStat(t, filepath.Join(target, path)), snapshotStat(t, filepath.Join(source, path)); got != want {
					t.Fatal("portable metadata changed", path, got, want)
				}
			}
			if kind != "empty-volume" {
				if got, err := os.ReadFile(filepath.Join(target, "directory/file")); err != nil || string(got) != "portable content" {
					t.Fatal("restored content changed", err)
				}
			}
			// Only label values change; the portable tree must have the same digest.
			for _, path := range paths {
				setSELinuxLabel(t, filepath.Join(source, path), "system_u:object_r:container_file_t:s0:c31,c32")
			}
			again, err := capture()
			if err != nil || captured.Tree != again.Tree {
				t.Fatal("host label affected portable digest", err, captured.Tree, again.Tree)
			}
		})
	}
}

func setSELinuxLabel(t *testing.T, path, label string) {
	t.Helper()
	if err := unix.Lsetxattr(path, "security.selinux", []byte(label+"\x00"), 0); err != nil {
		t.Fatal("set test host label", err)
	}
}

func selinuxLabel(t *testing.T, path string) string {
	t.Helper()
	raw := make([]byte, 4096)
	n, err := unix.Lgetxattr(path, "security.selinux", raw)
	if err != nil || n <= 0 || n > len(raw) {
		t.Fatal("visible security.selinux required", path, err)
	}
	return string(raw[:n])
}
