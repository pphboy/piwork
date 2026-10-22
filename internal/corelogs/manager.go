package corelogs

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/sys/unix"
	"piwork/internal/safefs"
)

const (
	DefaultMaxSegmentBytes = int64(16 << 20)
	DefaultMaxTotalBytes   = int64(256 << 20)
	DefaultMaxAge          = 7 * 24 * time.Hour
	DefaultSyncInterval    = time.Second
	maxRecordBytes         = 64 << 10
	maxMessageBytes        = 16 << 10
	maxFieldValueBytes     = 1024
	maxFields              = 16
)

var (
	ErrClosed = errors.New("core log manager is closed")
	ErrUnsafe = errors.New("core log storage is unsafe")

	shardName    = regexp.MustCompile(`^core-([a-f0-9]{32})-([0-9]{8})\.jsonl$`)
	streamNames  = map[string]bool{"stdout": true, "stderr": true}
	levelNames   = map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
	fieldKeyName = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`)
	eventName    = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$`)
	identifier   = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)
)

type Options struct {
	Stdout, Stderr  io.Writer
	MaxSegmentBytes int64
	MaxTotalBytes   int64
	MaxAge          time.Duration
	SyncInterval    time.Duration
	Now             func() time.Time
	// Fault is a package-test hook. Production callers leave it nil.
	Fault func(stage string) error
}

type Event struct {
	Stream        string
	Level         string
	Component     string
	Event         string
	Message       string
	WorkID        string
	ServiceID     string
	OperationID   string
	CorrelationID string
	Fields        map[string]string
	// ConsoleText replaces the default console rendering while the file keeps
	// the structured record. It is never stored.
	ConsoleText []byte
}

type Record struct {
	Time          string            `json:"time"`
	BootID        string            `json:"bootId"`
	Seq           int64             `json:"seq"`
	Stream        string            `json:"stream"`
	Level         string            `json:"level"`
	Component     string            `json:"component"`
	Event         string            `json:"event"`
	Message       string            `json:"message"`
	WorkID        string            `json:"workId,omitempty"`
	ServiceID     string            `json:"serviceId,omitempty"`
	OperationID   string            `json:"operationId,omitempty"`
	CorrelationID string            `json:"correlationId,omitempty"`
	Fields        map[string]string `json:"fields,omitempty"`
	Truncated     bool              `json:"truncated,omitempty"`
}

type Segment struct {
	Name    string
	Size    int64
	ModTime time.Time
	Partial bool
	Active  bool
}

type Status struct {
	BootID        string
	ActiveSegment string
	FileFault     bool
	SyncError     string
}

type Manager struct {
	mu         sync.Mutex
	root       *safefs.Root
	options    Options
	bootID     string
	sequence   int64
	segment    int64
	active     *os.File
	activeName string
	activeSize int64
	fileFault  bool
	faultFrom  string
	faultTo    string
	syncError  string
	closed     bool
	pins       map[string]int
	stop       chan struct{}
	stopped    chan struct{}
}

func Open(root *safefs.Root, options Options) (*Manager, error) {
	if root == nil {
		return nil, ErrUnsafe
	}
	applyDefaults(&options)
	m := &Manager{root: root, options: options, stop: make(chan struct{}), stopped: make(chan struct{})}
	entries, err := root.Entries()
	if err != nil {
		return nil, ErrUnsafe
	}
	for _, name := range entries {
		if !shardName.MatchString(name) || root.CheckEntry(name, false) != nil {
			return nil, ErrUnsafe
		}
	}
	var boot [16]byte
	if _, err := rand.Read(boot[:]); err != nil {
		return nil, ErrUnsafe
	}
	m.bootID = hex.EncodeToString(boot[:])
	if err := m.openSegmentLocked(); err != nil {
		return nil, err
	}
	if err := m.applyRetentionLocked(); err != nil {
		m.closeActiveLocked()
		return nil, err
	}
	if options.SyncInterval > 0 {
		go m.syncLoop()
	} else {
		close(m.stopped)
	}
	return m, nil
}

func applyDefaults(options *Options) {
	if options.MaxSegmentBytes <= 0 {
		options.MaxSegmentBytes = DefaultMaxSegmentBytes
	}
	if options.MaxTotalBytes <= 0 {
		options.MaxTotalBytes = DefaultMaxTotalBytes
	}
	if options.MaxAge <= 0 {
		options.MaxAge = DefaultMaxAge
	}
	if options.SyncInterval == 0 {
		options.SyncInterval = DefaultSyncInterval
	}
	if options.Now == nil {
		options.Now = func() time.Time { return time.Now().UTC() }
	}
}

func (m *Manager) now() time.Time { return m.options.Now().UTC() }

func (m *Manager) BootID() string { return m.bootID }

func (m *Manager) syncLoop() {
	defer close(m.stopped)
	ticker := time.NewTicker(m.options.SyncInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			m.mu.Lock()
			if !m.closed && m.active != nil {
				if err := m.active.Sync(); err != nil {
					m.syncError = "log file sync failed"
				}
			}
			if m.options.Fault != nil {
				_ = m.options.Fault("sync")
			}
			m.mu.Unlock()
		}
	}
}

func (m *Manager) openSegmentLocked() error {
	name := fmt.Sprintf("core-%s-%08d.jsonl", m.bootID, m.segment)
	file, err := m.root.OpenFile(name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_APPEND)
	if err != nil {
		return ErrUnsafe
	}
	m.active = file
	m.activeName = name
	m.activeSize = 0
	return nil
}

func (m *Manager) rotateLocked() error {
	if m.active != nil {
		_ = m.active.Sync()
		if m.options.Fault != nil {
			_ = m.options.Fault("sync")
		}
		if err := m.active.Close(); err != nil {
			return ErrUnsafe
		}
		m.active = nil
	}
	m.segment++
	if err := m.openSegmentLocked(); err != nil {
		return err
	}
	return m.applyRetentionLocked()
}

func (m *Manager) Emit(event Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return ErrClosed
	}
	record := m.newRecordLocked(event)
	var failures []error
	if err := m.writeConsoleLocked(event, record); err != nil {
		failures = append(failures, err)
	}
	if err := m.writeFileLocked(&record); err != nil {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

func (m *Manager) newRecordLocked(event Event) Record {
	now := m.now()
	record := Record{
		Time: now.Format(time.RFC3339Nano), BootID: m.bootID, Seq: m.sequence,
		Stream: event.Stream, Level: event.Level, Component: event.Component, Event: event.Event,
		Message: event.Message, Fields: sanitizeFields(event.Fields),
	}
	m.sequence++
	if !streamNames[record.Stream] {
		record.Stream = "stderr"
	}
	if !levelNames[record.Level] {
		record.Level = "info"
	}
	if !eventName.MatchString(record.Component) {
		record.Component = "core"
	}
	if !eventName.MatchString(record.Event) {
		record.Event = "app.log"
	}
	record.WorkID = safeIdentifier(event.WorkID)
	record.ServiceID = safeIdentifier(event.ServiceID)
	record.OperationID = safeIdentifier(event.OperationID)
	record.CorrelationID = safeIdentifier(event.CorrelationID)
	if len(record.Message) > maxMessageBytes {
		record.Message = truncateUTF8(record.Message, maxMessageBytes)
		record.Truncated = true
	}
	return record
}

func safeIdentifier(value string) string {
	if value != "" && identifier.MatchString(value) {
		return value
	}
	return ""
}

func sanitizeFields(fields map[string]string) map[string]string {
	if len(fields) == 0 {
		return nil
	}
	result := make(map[string]string, len(fields))
	index := 0
	for key, value := range fields {
		if index >= maxFields {
			break
		}
		if !fieldKeyName.MatchString(key) {
			continue
		}
		if len(value) > maxFieldValueBytes {
			value = truncateUTF8(value, maxFieldValueBytes)
		}
		result[key] = value
		index++
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func truncateUTF8(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	cut := value[:limit]
	for !utf8.ValidString(cut) && len(cut) > 0 {
		cut = cut[:len(cut)-1]
	}
	return cut
}

func (m *Manager) writeConsoleLocked(event Event, record Record) error {
	console := m.options.Stderr
	if record.Stream == "stdout" {
		console = m.options.Stdout
	}
	if console == nil {
		return nil
	}
	text := event.ConsoleText
	if text == nil {
		text = []byte(fmt.Sprintf("%s %s %s %s: %s\n", record.Time, record.Level, record.Component, record.Event, record.Message))
	}
	if len(text) > 0 && text[len(text)-1] != '\n' {
		text = append(text, '\n')
	}
	_, err := console.Write(text)
	return err
}

func (m *Manager) writeFileLocked(record *Record) error {
	if m.fileFault {
		if err := m.recoverFileLocked(); err != nil {
			m.faultTo = record.Time
			return err
		}
		m.fileFault = false
	}
	line, err := encodeRecord(*record)
	if err != nil {
		return err
	}
	if m.activeSize > 0 && m.activeSize+int64(len(line)) > m.options.MaxSegmentBytes {
		if err := m.rotateLocked(); err != nil {
			m.markFileFault(record.Time)
			return err
		}
	}
	if m.options.Fault != nil {
		if err := m.options.Fault("write"); err != nil {
			m.markFileFault(record.Time)
			return err
		}
	}
	if _, err := m.active.Write(line); err != nil {
		m.markFileFault(record.Time)
		return ErrUnsafe
	}
	m.activeSize += int64(len(line))
	return nil
}

func (m *Manager) markFileFault(at string) {
	if !m.fileFault {
		m.faultFrom = at
	}
	m.faultTo = at
	m.fileFault = true
}

// recoverFileLocked starts a fresh shard after a write failure and records the
// known unavailable interval before the next real record.
func (m *Manager) recoverFileLocked() error {
	if m.active != nil {
		_ = m.active.Close()
		m.active = nil
	}
	m.segment++
	if err := m.openSegmentLocked(); err != nil {
		return err
	}
	if m.options.Fault != nil {
		if err := m.options.Fault("write"); err != nil {
			return err
		}
	}
	to := m.now().Format(time.RFC3339Nano)
	gap := Record{
		Time: to, BootID: m.bootID, Seq: m.sequence,
		Stream: "stderr", Level: "warn", Component: "corelogs", Event: "log.gap",
		Message: "log file writes were unavailable",
		Fields:  map[string]string{"from": m.faultFrom, "to": to, "known": "true"},
	}
	m.sequence++
	line, err := encodeRecord(gap)
	if err != nil {
		return err
	}
	if _, err := m.active.Write(line); err != nil {
		return ErrUnsafe
	}
	m.activeSize += int64(len(line))
	_ = m.applyRetentionLocked()
	return nil
}

func encodeRecord(record Record) ([]byte, error) {
	line, err := json.Marshal(record)
	if err != nil {
		return nil, ErrUnsafe
	}
	line = append(line, '\n')
	if len(line) > maxRecordBytes {
		return nil, ErrUnsafe
	}
	return line, nil
}

func (m *Manager) applyRetentionLocked() error {
	now := m.now()
	entries, err := m.root.Entries()
	if err != nil {
		return ErrUnsafe
	}
	segments := make([]Segment, 0, len(entries))
	for _, name := range entries {
		if !shardName.MatchString(name) || m.root.CheckEntry(name, false) != nil {
			return ErrUnsafe
		}
		path, err := m.root.Path(name)
		if err != nil {
			return ErrUnsafe
		}
		var info unix.Stat_t
		if unix.Lstat(path, &info) != nil {
			return ErrUnsafe
		}
		segments = append(segments, Segment{Name: name, Size: info.Size, ModTime: time.Unix(info.Mtim.Sec, info.Mtim.Nsec).UTC(), Active: name == m.activeName})
	}
	sort.Slice(segments, func(i, j int) bool {
		if segments[i].ModTime.Equal(segments[j].ModTime) {
			return segments[i].Name < segments[j].Name
		}
		return segments[i].ModTime.Before(segments[j].ModTime)
	})
	total := int64(0)
	for _, segment := range segments {
		total += segment.Size
	}
	for _, segment := range segments {
		if segment.Active || m.pins[segment.Name] > 0 {
			continue
		}
		expired := segment.ModTime.Before(now.Add(-m.options.MaxAge))
		overLimit := total > m.options.MaxTotalBytes
		if !expired && !overLimit {
			break
		}
		if err := m.root.Remove(segment.Name); err != nil {
			return ErrUnsafe
		}
		total -= segment.Size
	}
	return nil
}

func (m *Manager) Segments() ([]Segment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, ErrClosed
	}
	entries, err := m.root.Entries()
	if err != nil {
		return nil, ErrUnsafe
	}
	result := make([]Segment, 0, len(entries))
	for _, name := range entries {
		if !shardName.MatchString(name) || m.root.CheckEntry(name, false) != nil {
			return nil, ErrUnsafe
		}
		path, err := m.root.Path(name)
		if err != nil {
			return nil, ErrUnsafe
		}
		var info unix.Stat_t
		if unix.Lstat(path, &info) != nil {
			return nil, ErrUnsafe
		}
		segment := Segment{Name: name, Size: info.Size, ModTime: time.Unix(info.Mtim.Sec, info.Mtim.Nsec).UTC(), Active: name == m.activeName}
		if segment.Size > 0 {
			file, err := m.root.OpenFile(name, unix.O_RDONLY)
			if err != nil {
				return nil, ErrUnsafe
			}
			var last [1]byte
			_, readErr := file.ReadAt(last[:], segment.Size-1)
			file.Close()
			if readErr != nil {
				return nil, ErrUnsafe
			}
			segment.Partial = last[0] != '\n'
		}
		result = append(result, segment)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result, nil
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Status{BootID: m.bootID, ActiveSegment: m.activeName, FileFault: m.fileFault, SyncError: m.syncError}
}

func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	close(m.stop)
	m.mu.Unlock()
	<-m.stopped
	m.mu.Lock()
	defer m.mu.Unlock()
	var failures []error
	if m.active != nil {
		if err := m.active.Sync(); err != nil {
			failures = append(failures, ErrUnsafe)
		}
		if m.options.Fault != nil {
			if err := m.options.Fault("sync"); err != nil {
				failures = append(failures, ErrUnsafe)
			}
		}
		if err := m.active.Close(); err != nil {
			failures = append(failures, ErrUnsafe)
		}
		m.active = nil
	}
	return errors.Join(failures...)
}

func (m *Manager) closeActiveLocked() {
	if m.active != nil {
		_ = m.active.Close()
		m.active = nil
	}
}

// StreamWriter turns line-oriented text into managed records while preserving
// the original console bytes. A partial line is buffered until its newline.
type StreamWriter struct {
	manager   *Manager
	stream    string
	component string
	mu        sync.Mutex
	buffer    []byte
	closed    bool
}

func (m *Manager) Writer(stream, component string) *StreamWriter {
	return &StreamWriter{manager: m, stream: stream, component: component}
}

func (w *StreamWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return 0, ErrClosed
	}
	w.buffer = append(w.buffer, data...)
	for {
		index := bytes.IndexByte(w.buffer, '\n')
		if index < 0 {
			break
		}
		line := w.buffer[:index]
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		console := append([]byte(nil), w.buffer[:index+1]...)
		w.buffer = w.buffer[index+1:]
		if err := w.manager.Emit(Event{
			Stream: w.stream, Level: "info", Component: w.component, Event: "app.log",
			Message: string(line), ConsoleText: console,
		}); err != nil {
			return len(data), err
		}
	}
	if len(w.buffer) > maxRecordBytes {
		line := w.buffer
		w.buffer = nil
		return len(data), w.manager.Emit(Event{
			Stream: w.stream, Level: "info", Component: w.component, Event: "app.log",
			Message: string(line), ConsoleText: append(append([]byte(nil), line...), '\n'),
		})
	}
	return len(data), nil
}

func (w *StreamWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	w.closed = true
	if len(w.buffer) == 0 {
		return nil
	}
	line := w.buffer
	w.buffer = nil
	return w.manager.Emit(Event{
		Stream: w.stream, Level: "info", Component: w.component, Event: "app.log",
		Message: string(line), ConsoleText: append(append([]byte(nil), line...), '\n'),
	})
}
