package corelogs

import (
	"io"
	"os"
	"sort"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

// BoundaryEntry freezes one shard's identity and byte length at the export
// cutoff. Later writes or rotation never extend what an export may read.
type BoundaryEntry struct {
	Name    string
	Size    int64
	ModTime time.Time
	Device  uint64
	Inode   uint64
}

// Boundary pins the selected shards so retention cannot delete them while an
// export still references the bytes. Release is idempotent.
type Boundary struct {
	manager *Manager
	Cutoff  time.Time
	entries []BoundaryEntry
	once    sync.Once
}

func (m *Manager) Boundary() (*Boundary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, ErrClosed
	}
	if m.active != nil {
		if err := m.active.Sync(); err != nil {
			return nil, ErrUnsafe
		}
		if m.options.Fault != nil {
			_ = m.options.Fault("sync")
		}
	}
	cutoff := time.Now().UTC()
	entries, err := m.root.Entries()
	if err != nil {
		return nil, ErrUnsafe
	}
	result := make([]BoundaryEntry, 0, len(entries))
	for _, name := range entries {
		if !shardName.MatchString(name) || m.root.CheckEntry(name, false) != nil {
			return nil, ErrUnsafe
		}
		path, err := m.root.Path(name)
		if err != nil {
			return nil, ErrUnsafe
		}
		var info unix.Stat_t
		if unix.Lstat(path, &info) != nil || info.Size == 0 {
			continue
		}
		result = append(result, BoundaryEntry{
			Name: name, Size: info.Size, ModTime: time.Unix(info.Mtim.Sec, info.Mtim.Nsec).UTC(),
			Device: uint64(info.Dev), Inode: info.Ino,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	if m.pins == nil {
		m.pins = map[string]int{}
	}
	for _, entry := range result {
		m.pins[entry.Name]++
	}
	return &Boundary{manager: m, entries: result, Cutoff: cutoff}, nil
}

func (b *Boundary) Entries() []BoundaryEntry {
	result := make([]BoundaryEntry, len(b.entries))
	copy(result, b.entries)
	return result
}

func (b *Boundary) Release() {
	if b == nil {
		return
	}
	b.once.Do(func() {
		b.manager.mu.Lock()
		defer b.manager.mu.Unlock()
		for _, entry := range b.entries {
			if b.manager.pins[entry.Name] > 1 {
				b.manager.pins[entry.Name]--
			} else {
				delete(b.manager.pins, entry.Name)
			}
		}
	})
}

// OpenSection opens a pinned shard and exposes exactly the frozen byte range.
func (b *Boundary) OpenSection(name string) (io.ReadCloser, int64, error) {
	var entry *BoundaryEntry
	for index := range b.entries {
		if b.entries[index].Name == name {
			entry = &b.entries[index]
			break
		}
	}
	if entry == nil {
		return nil, 0, ErrUnsafe
	}
	file, err := b.manager.root.OpenFile(name, unix.O_RDONLY)
	if err != nil {
		return nil, 0, ErrUnsafe
	}
	var info unix.Stat_t
	if unix.Fstat(int(file.Fd()), &info) != nil || uint64(info.Dev) != entry.Device || info.Ino != entry.Inode {
		file.Close()
		return nil, 0, ErrUnsafe
	}
	return &sectionReader{file: file, remaining: entry.Size}, entry.Size, nil
}

type sectionReader struct {
	file      *os.File
	remaining int64
}

func (s *sectionReader) Read(data []byte) (int, error) {
	if s.remaining <= 0 {
		return 0, io.EOF
	}
	if int64(len(data)) > s.remaining {
		data = data[:s.remaining]
	}
	n, err := s.file.Read(data)
	s.remaining -= int64(n)
	if err == io.EOF && s.remaining > 0 {
		return n, io.ErrUnexpectedEOF
	}
	return n, err
}

func (s *sectionReader) Close() error { return s.file.Close() }
