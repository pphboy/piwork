package client

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
	"piwork/internal/clientfs"
)

func assertCredentialPrivate(t *testing.T, path string) {
	t.Helper()
	d, err := clientfs.OpenPrivateDirectory(filepath.Dir(path), false)
	if err != nil {
		t.Fatal("credential directory permissions", err)
	}
	defer d.Close()
	f, err := d.OpenRegular(filepath.Base(path))
	if err != nil {
		t.Fatal("credential file permissions", err)
	}
	f.Close()
}

func makeCredentialLink(t *testing.T, target, link string) {
	t.Helper()
	// A real extra hard link needs no symlink privilege. Symlink/reparse
	// fixtures are exercised separately, rather than silently skipped here.
	if err := os.Link(target, link); err != nil {
		t.Fatal(err)
	}
}

func makeCredentialUnsafe(t *testing.T, path string) {
	t.Helper()
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		t.Fatal(err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
}

func restoreCredentialDirectory(t *testing.T, path string) {
	t.Helper()
	// The broad ACL fixture still permits its owner to inspect and remove it.
}
