package clientfs

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsPrivateCreationHasProtectedCurrentUserDACL(t *testing.T) {
	d, _ := privateDirectory(t)
	f, err := d.CreateExclusive("record")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := checkPrivateHandle(windows.Handle(f.Fd()), d.sid); err != nil {
		t.Fatal(err)
	}
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		t.Fatal(err)
	}
	defer token.Close()
	t.Logf("native Windows process token elevated: %v", token.IsElevated())
}

func TestWindowsRefusesBroadOrInheritedACLWithoutRepairingIt(t *testing.T) {
	for _, flags := range []string{"P", ""} {
		t.Run("protection-"+flags, func(t *testing.T) {
			d, path := privateDirectory(t)
			if err := d.AtomicWrite(context.Background(), "record", []byte("original")); err != nil {
				t.Fatal(err)
			}
			name := filepath.Join(path, "record")
			sd, err := windows.SecurityDescriptorFromString("D:" + flags + "(A;;FA;;;" + d.sid.String() + ")(A;;FR;;;WD)")
			if err != nil {
				t.Fatal(err)
			}
			acl, _, err := sd.DACL()
			if err != nil {
				t.Fatal(err)
			}
			information := windows.SECURITY_INFORMATION(windows.DACL_SECURITY_INFORMATION | windows.PROTECTED_DACL_SECURITY_INFORMATION)
			if flags == "" {
				information = windows.DACL_SECURITY_INFORMATION | windows.UNPROTECTED_DACL_SECURITY_INFORMATION
			}
			if err := windows.SetNamedSecurityInfo(name, windows.SE_FILE_OBJECT, information, nil, nil, acl, nil); err != nil {
				t.Fatal(err)
			}
			if _, err := d.ReadFile("record", 64); !errors.Is(err, ErrUnsafe) {
				t.Fatal("broad ACL accepted", err)
			}
			if err := d.AtomicWrite(context.Background(), "record", []byte("bad")); !errors.Is(err, ErrUnsafe) {
				t.Fatal("unsafe file replaced", err)
			}
			if err := d.Remove("record"); !errors.Is(err, ErrUnsafe) {
				t.Fatal("unsafe file removed", err)
			}
			if raw, err := os.ReadFile(name); err != nil || string(raw) != "original" {
				t.Fatal("unsafe target changed", string(raw), err)
			}
		})
	}
}

func TestWindowsHardLinksDoNotBecomePrivateState(t *testing.T) {
	d, path := privateDirectory(t)
	other, otherPath := privateDirectory(t)
	if err := other.AtomicWrite(context.Background(), "sentinel", []byte("untouched")); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(filepath.Join(otherPath, "sentinel"), filepath.Join(path, "record")); err != nil {
		t.Fatal(err)
	}
	for _, action := range []func() error{
		func() error { _, err := d.ReadFile("record", 64); return err },
		func() error { return d.AtomicWrite(context.Background(), "record", []byte("bad")) },
		func() error { return d.Remove("record") },
	} {
		if err := action(); !errors.Is(err, ErrUnsafe) {
			t.Fatal("hard link accepted", err)
		}
	}
	if raw, err := os.ReadFile(filepath.Join(otherPath, "sentinel")); err != nil || string(raw) != "untouched" {
		t.Fatal(string(raw), err)
	}
}

func TestWindowsJunctionsCannotRedirectPinnedDirectories(t *testing.T) {
	base := t.TempDir()
	outsidePath := filepath.Join(t.TempDir(), "sentinel-directory")
	if err := os.Mkdir(outsidePath, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outsidePath, "sentinel"), []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	junction := filepath.Join(base, "junction")
	command := exec.Command("cmd.exe", "/d", "/c", "mklink", "/j", junction, outsidePath)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("junction fixture unavailable: %v %s", err, output)
	}
	if redirected, err := OpenDirectory(junction); !errors.Is(err, ErrUnsafe) {
		if redirected != nil {
			redirected.Close()
		}
		t.Fatal("junction opened", err)
	}
	if redirected, err := OpenPrivateDirectory(filepath.Join(junction, "new-state"), true); !errors.Is(err, ErrUnsafe) {
		if redirected != nil {
			redirected.Close()
		}
		t.Fatal("junction parent followed", err)
	}
	if raw, err := os.ReadFile(filepath.Join(outsidePath, "sentinel")); err != nil || string(raw) != "untouched" {
		t.Fatal(string(raw), err)
	}
	if _, err := os.Stat(filepath.Join(outsidePath, "new-state")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("junction target written", err)
	}
}

func TestWindowsDeviceAndStreamNamesAreNeverOpenedOrCreated(t *testing.T) {
	d, _ := privateDirectory(t)
	for _, name := range []string{"NUL", "con.txt", "COM1", "COM¹.txt", "LPT9", "record:secret", "record.", "record ", `\\.\NUL`} {
		if f, err := d.OpenRegular(name); !errors.Is(err, ErrUnsafe) {
			if f != nil {
				f.Close()
			}
			t.Fatalf("opened %q: %v", name, err)
		}
		if f, err := d.CreateExclusive(name); !errors.Is(err, ErrUnsafe) {
			if f != nil {
				f.Close()
			}
			t.Fatalf("created %q: %v", name, err)
		}
	}
	for _, name := range []string{`\\.\C:\`, `\\?\C:\`, `C:relative`} {
		if d, err := OpenPrivateDirectory(name, false); !errors.Is(err, ErrUnsafe) {
			if d != nil {
				d.Close()
			}
			t.Fatalf("opened device/drive-relative path %q: %v", name, err)
		}
	}
}

func TestWindowsPinnedParentSurvivesReplacementByJunction(t *testing.T) {
	d, path := privateDirectory(t)
	if err := d.AtomicWrite(context.Background(), "record", []byte("original")); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	sentinel := filepath.Join(outside, "record")
	if err := os.WriteFile(sentinel, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	held := path + "-held"
	if err := os.Rename(path, held); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/j", path, outside).CombinedOutput(); err != nil {
		t.Fatalf("junction fixture unavailable: %v %s", err, output)
	}
	if raw, err := d.ReadFile("record", 64); err != nil || string(raw) != "original" {
		t.Fatal("pinned reader redirected", string(raw), err)
	}
	if err := d.AtomicWrite(context.Background(), "record", []byte("replacement")); err != nil {
		t.Fatal(err)
	}
	child, err := d.Child("child", true)
	if err != nil {
		t.Fatal(err)
	}
	child.Close()
	if raw, err := os.ReadFile(sentinel); err != nil || string(raw) != "untouched" {
		t.Fatal("junction sentinel changed", string(raw), err)
	}
	if _, err := os.Stat(filepath.Join(outside, "child")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("child created outside pinned parent", err)
	}
}

func TestWindowsNativePublishFailurePreservesOldRecord(t *testing.T) {
	d, path := privateDirectory(t)
	if err := d.AtomicWrite(context.Background(), "record", []byte("original")); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(filepath.Join(path, "record"))
	if err != nil {
		t.Fatal(err)
	}
	// A real NT rename failure, after writing and flushing the temporary file.
	if err := windows.SetFileAttributes(name, windows.FILE_ATTRIBUTE_READONLY); err != nil {
		t.Fatal(err)
	}
	defer windows.SetFileAttributes(name, windows.FILE_ATTRIBUTE_NORMAL)
	if err := d.AtomicWrite(context.Background(), "record", []byte("replacement")); err == nil || errors.Is(err, ErrOutcomeUnknown) {
		t.Fatal("native precommit failure misreported", err)
	}
	if raw, err := d.ReadFile("record", 64); err != nil || string(raw) != "original" {
		t.Fatal("failed native publication changed target", string(raw), err)
	}
	entries, err := d.Entries()
	if err != nil || len(entries) != 1 || entries[0].Name() != "record" {
		t.Fatal("failed publication leaked temporary", entries, err)
	}
}

func TestWindowsOrdinaryInputsExcludeConcurrentWriters(t *testing.T) {
	d, path := privateDirectory(t)
	writer, err := d.CreateExclusive("input")
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	ordinary, err := OpenDirectory(path)
	if err != nil {
		t.Fatal(err)
	}
	defer ordinary.Close()
	if reader, err := ordinary.OpenRegular("input"); err == nil {
		reader.Close()
		t.Fatal("active writer accepted as stable input")
	}
	writer.Close()
	reader, err := ordinary.OpenRegular("input")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if writer, err := os.OpenFile(filepath.Join(path, "input"), os.O_WRONLY, 0); err == nil {
		writer.Close()
		t.Fatal("writer entered while input was being validated")
	}
}
