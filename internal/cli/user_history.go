package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"piwork/internal/client"
	"piwork/internal/contracts"
	"piwork/internal/sessionhistory"
	"strings"
	"syscall"
)

type historyOutput struct {
	ctx       context.Context
	file      *os.File
	directory string
}

func (h *historyOutput) WriteTo(w io.Writer) (int64, error) {
	// Convert a closed stdout pipe into an I/O error so the private spool's
	// cleanup defers still run. Go otherwise exits on SIGPIPE for file descriptor 1.
	pipe := make(chan os.Signal, 1)
	signal.Notify(pipe, syscall.SIGPIPE)
	defer signal.Stop(pipe)
	defer os.RemoveAll(h.directory)
	defer h.file.Close()
	if _, err := h.file.Seek(0, 0); err != nil {
		return 0, err
	}
	if h.ctx != nil {
		w = historyContextWriter{h.ctx, w}
	}
	return io.Copy(w, h.file)
}

type historyContextWriter struct {
	ctx    context.Context
	writer io.Writer
}

func (w historyContextWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	return w.writer.Write(p)
}

type historyMessage struct {
	id, role, run, block   string
	blocks                 []map[string]any
	blockIndex, blockCount int64
	offset, total          int64
	text                   strings.Builder
	allText                strings.Builder
}

func (m *historyMessage) add(part contracts.HistorySegment) (map[string]any, error) {
	invalid := func() (map[string]any, error) {
		return nil, &client.APIError{Code: "RESPONSE_INCOMPLETE", Text: "Saved message has a missing or conflicting range"}
	}
	if m.id == "" {
		if part.BlockIndex != 0 || part.ByteOffset != 0 {
			return invalid()
		}
		m.id = string(part.EntryId)
		m.role = part.Role
		m.run = part.RunId
		m.blockCount = int64(part.BlockCount)
		m.blocks = []map[string]any{}
	}
	if string(part.EntryId) != m.id || part.Role != m.role || part.RunId != m.run || int64(part.BlockIndex) != m.blockIndex || int64(part.BlockCount) != m.blockCount || int64(part.ByteOffset) != m.offset {
		return invalid()
	}
	if m.offset == 0 {
		m.block = string(part.BlockId)
		m.total = int64(part.TotalBytes)
	}
	if m.block != string(part.BlockId) || m.total != int64(part.TotalBytes) {
		return invalid()
	}
	m.text.WriteString(part.Text)
	m.offset += int64(len(part.Text))
	if !part.Complete {
		return nil, nil
	}
	if m.offset != m.total {
		return invalid()
	}
	text := m.text.String()
	block := map[string]any{"blockId": part.BlockId, "type": part.Type}
	switch part.Type {
	case "text", "run-result":
		block["type"] = "text"
		block["text"] = text
		m.allText.WriteString(text)
	case "tool-call":
		block["toolCallId"] = part.ToolCallId.Value
		block["toolName"] = part.ToolName.Value
	case "tool-result":
		block["toolCallId"] = part.ToolCallId.Value
		block["toolName"] = part.ToolName.Value
		result := map[string]any{"kind": part.ResultKind.Value, "truncated": part.Truncated.Value, "isError": part.IsError.Value}
		if part.ResultKind.Value == "text" {
			result["text"] = text
			m.allText.WriteString(text)
		}
		block["result"] = result
	case "image":
		block["image"] = part.Image.Value
	case "empty":
	default:
		return invalid()
	}
	if part.Type != "empty" {
		m.blocks = append(m.blocks, block)
	}
	m.blockIndex++
	m.offset = 0
	m.block = ""
	m.text.Reset()
	if m.blockIndex < m.blockCount {
		return nil, nil
	}
	value := map[string]any{"entryId": m.id, "role": m.role, "runId": m.run, "text": m.allText.String(), "createdAt": "", "blocks": m.blocks}
	*m = historyMessage{}
	return value, nil
}

func buildSessionHistory(ctx context.Context, api *client.Client, work, session string) (_ any, resultErr error) {
	directory, err := os.MkdirTemp("", "piwork-history-")
	if err != nil {
		return nil, err
	}
	published := false
	defer func() {
		if !published {
			os.RemoveAll(directory)
		}
		if resultErr != nil {
			resultErr = fmt.Errorf("Session %s/%s could not be read completely; retry the original session show: %w", work, session, resultErr)
		}
	}()
	open := func(name string) (*os.File, error) {
		return os.OpenFile(filepath.Join(directory, name), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	}
	messages, err := open("messages.jsonl")
	if err != nil {
		return nil, err
	}
	defer messages.Close()
	runs, err := open("runs.jsonl")
	if err != nil {
		return nil, err
	}
	defer runs.Close()
	query := contracts.HistoryQuery{Direction: contracts.Supplied("newer"), ImageProfile: contracts.Supplied("chat-images-v1")}
	var sessionView contracts.ChatSessionView
	var assembly historyMessage
	for {
		page, err := api.HistoryPage(ctx, work, session, query)
		if err != nil {
			return nil, err
		}
		if !query.Snapshot.Present {
			query.Snapshot = contracts.Supplied(page.SnapshotId)
			sessionView = page.Session
		}
		for _, part := range page.Segments {
			value, err := assembly.add(part)
			if err != nil {
				return nil, err
			}
			if value != nil {
				if err := json.NewEncoder(messages).Encode(value); err != nil {
					return nil, err
				}
			}
		}
		next, err := sessionhistory.Next(page)
		if err != nil {
			return nil, err
		}
		if next == "" {
			break
		}
		if query.Cursor.Present && query.Cursor.Value == next {
			return nil, errors.New("history cursor did not advance")
		}
		query.Cursor = contracts.Supplied(next)
	}
	if assembly.id != "" {
		return nil, &client.APIError{Code: "RESPONSE_INCOMPLETE", Text: "Saved conversation ended inside a message"}
	}
	query.Cursor = contracts.Field[string]{}
	query.Content = contracts.Supplied("runs")
	for {
		page, err := api.HistoryPage(ctx, work, session, query)
		if err != nil {
			return nil, err
		}
		for _, summary := range page.Runs {
			raw, err := json.Marshal(summary)
			if err != nil {
				return nil, err
			}
			raw, err = api.CompleteHistoryRun(ctx, raw)
			if err != nil {
				return nil, err
			}
			if _, err = runs.Write(append(raw, '\n')); err != nil {
				return nil, err
			}
		}
		next, err := sessionhistory.Next(page)
		if err != nil {
			return nil, err
		}
		if next == "" {
			break
		}
		if query.Cursor.Present && query.Cursor.Value == next {
			return nil, errors.New("history cursor did not advance")
		}
		query.Cursor = contracts.Supplied(next)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	output, err := open("complete.json")
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			output.Close()
		}
	}()
	if _, err = io.WriteString(output, "{\"session\":"); err != nil {
		return nil, err
	}
	if err = json.NewEncoder(output).Encode(sessionView); err != nil {
		return nil, err
	}
	if _, err = io.WriteString(output, ",\"messages\":"); err != nil {
		return nil, err
	}
	if err = historyArray(ctx, output, messages); err != nil {
		return nil, err
	}
	if _, err = io.WriteString(output, ",\"runs\":"); err != nil {
		return nil, err
	}
	if err = historyArray(ctx, output, runs); err != nil {
		return nil, err
	}
	if _, err = io.WriteString(output, "}\n"); err != nil {
		return nil, err
	}
	if err = output.Sync(); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	success = true
	published = true
	return &historyOutput{ctx: ctx, file: output, directory: directory}, nil
}

// Stream NDJSON records into one array without reading a whole record/file.
func historyArray(ctx context.Context, w io.Writer, file *os.File) error {
	if _, err := file.Seek(0, 0); err != nil {
		return err
	}
	if _, err := io.WriteString(w, "["); err != nil {
		return err
	}
	reader := bufio.NewReaderSize(file, 64<<10)
	first, start := true, true
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		part, err := reader.ReadSlice('\n')
		if len(part) > 0 {
			if start && !first {
				if _, e := io.WriteString(w, ","); e != nil {
					return e
				}
			}
			if part[len(part)-1] == '\n' {
				part = part[:len(part)-1]
				start = true
			} else {
				start = false
			}
			if _, e := w.Write(part); e != nil {
				return e
			}
			first = false
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) {
			if !start {
				return io.ErrUnexpectedEOF
			}
			break
		}
		if err != nil {
			return err
		}
	}
	_, err := io.WriteString(w, "]")
	return err
}
