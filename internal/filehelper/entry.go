package filehelper

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"time"

	"piwork/internal/cli"
	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
)

var scopeID = regexp.MustCompile(`^[A-Za-z0-9-]{16,128}$`)

func Entry(ctx context.Context, args []string, source io.Reader, sink, stderr io.Writer) int {
	if len(args) == 1 && (args[0] == "--version" || args[0] == "version") {
		return cli.Entry("piwork-file-helper", args, sink, stderr)
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		fmt.Fprintln(sink, "Usage: piwork-file-helper --job-id ID --work-id ID --epoch N")
		return 0
	}
	options := flag.NewFlagSet("piwork-file-helper", flag.ContinueOnError)
	options.SetOutput(io.Discard)
	jobID, workID, epoch := options.String("job-id", "", ""), options.String("work-id", "", ""), options.Int64("epoch", -1, "")
	if options.Parse(args) != nil || options.NArg() != 0 || !scopeID.MatchString(*jobID) || !scopeID.MatchString(*workID) || *epoch < 0 || *epoch > contracts.MaxSafeInteger {
		json.NewEncoder(stderr).Encode(map[string]string{"code": "FILE_REQUEST_INVALID"})
		return 2
	}
	ctx, cancel := context.WithTimeout(ctx, fileprotocol.RequestTimeout)
	defer cancel()
	session := &fileprotocol.Session{Source: source, Sink: sink, JobID: *jobID, WorkID: *workID, Epoch: *epoch}
	if file, ok := source.(*os.File); ok {
		fd, err := pollableFile(file)
		if err != nil {
			json.NewEncoder(stderr).Encode(map[string]string{"code": "FILE_RUNTIME_UNAVAILABLE"})
			return 1
		}
		reader := &pollReader{ctx: ctx, fd: fd}
		session.Source = reader
		session.ReadDeadline = reader.setDeadline
	}
	if file, ok := sink.(*os.File); ok {
		fd, err := pollableFile(file)
		if err != nil {
			json.NewEncoder(stderr).Encode(map[string]string{"code": "FILE_RUNTIME_UNAVAILABLE"})
			return 1
		}
		session.Sink = &pollWriter{ctx: ctx, fd: fd, deadline: time.Now().Add(fileprotocol.RequestTimeout)}
	}
	request, err := session.Start()
	if err == nil {
		err = Handle(session, request, "/workspace")
	}
	if err != nil {
		_ = session.SendError(fileprotocol.Code(err), nil, true)
		return 1
	}
	if !session.Finished {
		_ = session.SendError("FILE_BACKEND_PROTOCOL_ERROR", nil, true)
		return 1
	}
	return 0
}
