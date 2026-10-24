//go:build integration

package agentclient

import (
	"bufio"
	"context"
	"encoding/json"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"io"
	"os/exec"
	"path/filepath"
	"piwork/internal/contracts"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/sessionhistory"
	"testing"
	"time"
)

func TestRealTSHistoryWire(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("integration requires Node 24", err)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, node, filepath.Join(root, "apps/agentd/test/history-wire.mjs"), t.TempDir())
	command.Dir = root
	out, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = io.Discard
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { command.Process.Kill(); command.Wait() })
	var address struct {
		Port                   int
		Session, Run           string
		MixedSession, MixedRun string
		Empty                  []struct {
			Session, Run, Name string
			HasText            bool
		}
	}
	line, err := bufio.NewReader(out).ReadBytes('\n')
	if err != nil || json.Unmarshal(line, &address) != nil {
		t.Fatalf("fixture startup: %v %s", err, line)
	}
	connection, err := grpc.NewClient("127.0.0.1:"+jsonNumber(address.Port), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	c := (&Client{scope: internaltls.Scope{WorkID: "work-wire"}, rpc: agentv1.NewAgentServiceClient(connection)}).WithHistoryProfile()
	if _, err = c.HistoryCapabilities(ctx); err != nil {
		t.Fatal(err)
	}
	query := contracts.HistoryQuery{Direction: contracts.Supplied("newer")}
	entries := map[string]bool{}
	pages, maxBytes := 0, 0
	for {
		page, err := c.ReadSessionPage(ctx, address.Session, query)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(page)
		if len(raw)+1 > maxBytes {
			maxBytes = len(raw) + 1
		}
		for _, part := range page.Segments {
			entries[string(part.EntryId)] = true
		}
		pages++
		next, err := sessionhistory.Next(page)
		if err != nil {
			t.Fatal(err)
		}
		if next == "" {
			break
		}
		query.Cursor = contracts.Supplied(next)
	}
	if len(entries) != 454 || pages < 20 || maxBytes > contracts.HistoryPageBytes {
		t.Fatal("bad reconstruction", len(entries), pages, maxBytes)
	}
	run, err := c.GetRun(ctx, address.Run)
	if err != nil || run.FinalText != "" || run.ResultRefJson == nil {
		t.Fatal("unbounded metadata", err)
	}
	var bytes, frames int
	var last uint64
	err = c.WatchRun(ctx, address.Run, nil, func(event *agentv1.RunEvent) error {
		if part := event.GetText(); part != nil {
			bytes += len(part.Delta)
			frames++
		}
		last = event.Sequence
		return nil
	})
	if err != nil || bytes != 7*1024*1024 || frames < 200 || last == 0 {
		t.Fatal("fragment wire", err, bytes, frames, last)
	}
	// Result text is a subset of a mixed SDK message, with the same source
	// block positions. Go must accept the gap occupied by the omitted tool.
	mixed, err := c.ReadSessionPage(ctx, address.MixedSession, contracts.HistoryQuery{Direction: contracts.Supplied("newer")})
	if err != nil || len(mixed.Segments) != 3 {
		t.Fatal("mixed message", err)
	}
	for _, direction := range []string{"newer", "older"} {
		result, err := c.ReadSessionPage(ctx, address.MixedSession, contracts.HistoryQuery{Direction: contracts.Supplied(direction), Content: contracts.Supplied("result"), RunId: contracts.Supplied(contracts.Identifier(address.MixedRun)), Snapshot: contracts.Supplied(mixed.SnapshotId)})
		if err != nil || result.HasMore || len(result.Segments) != 2 {
			t.Fatal("mixed result", direction, err)
		}
		for i, part := range result.Segments {
			source := mixed.Segments[i*2]
			if part.EntryId != source.EntryId || part.BlockId != source.BlockId || part.BlockIndex != source.BlockIndex || part.BlockCount != source.BlockCount || part.Text != source.Text {
				t.Fatal("result changed source block shape", direction, part, source)
			}
		}
	}
	t.Log("mixed SDK final result kept source block positions through Go/TS wire in both directions")
	if len(address.Empty) != 4 {
		t.Fatal("missing empty-result wire fixtures")
	}
	for _, sample := range address.Empty {
		for _, direction := range []string{"newer", "older"} {
			result, err := c.ReadSessionPage(ctx, sample.Session, contracts.HistoryQuery{Direction: contracts.Supplied(direction), Content: contracts.Supplied("result"), RunId: contracts.Supplied(contracts.Identifier(sample.Run))})
			if err != nil || result.HasMore || len(result.Segments) != 1 {
				t.Fatal("empty result", sample.Name, direction, err)
			}
			part := result.Segments[0]
			if part.Text != "" || !part.Complete || part.ByteOffset != 0 || part.TotalBytes != 0 || part.Type != "text" && sample.HasText || part.Type != "run-result" && !sample.HasText {
				t.Fatal("empty result representation", sample.Name, part)
			}
			messages, err := c.ReadSessionPage(ctx, sample.Session, contracts.HistoryQuery{Direction: contracts.Supplied("newer"), Snapshot: contracts.Supplied(result.SnapshotId)})
			if err != nil || messages.HasMore {
				t.Fatal("empty result source", sample.Name, err)
			}
			for _, source := range messages.Segments {
				if sample.HasText && source.BlockId == part.BlockId && (source.EntryId != part.EntryId || source.BlockIndex != part.BlockIndex || source.BlockCount != part.BlockCount) || !sample.HasText && source.Type != "run-result" && source.EntryId == part.EntryId {
					t.Fatal("empty result changed SDK entry shape", sample.Name, part, source)
				}
			}
		}
	}
	t.Log("four empty SDK result shapes kept complete identities through Go/TS wire in both directions")
	t.Logf("real Go↔TS: %d entries, %d pages, max JSON %d bytes, %d same-sequence frames", len(entries), pages, maxBytes, frames)
}
func jsonNumber(n int) string { raw, _ := json.Marshal(n); return string(raw) }
