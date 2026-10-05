package pipackage

import (
	"os"

	"golang.org/x/sys/unix"
)

func nativePackageComponent(name string) bool { return true }

// Linux helpers already pass paths beneath their pinned /proc/self/fd roots.
// Keep that interface and the original no-follow leaf behavior intact.
func openArchiveInput(filename string) (*os.File, error) {
	return os.OpenFile(filename, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
}

func openTreeRoot(name string) (*os.Root, error) { return os.OpenRoot(name) }

func openTreeFile(root *os.Root, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
}

func openTreeDirectory(root *os.Root, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
}

func readTreeLink(root *os.Root, name string) (string, error) { return root.Readlink(name) }
