package fileprotocol

import (
	"bytes"
	"encoding/json"
	"io"
	"time"

	"piwork/internal/contracts"
)

type Session struct {
	Source        io.Reader
	Sink          io.Writer
	JobID, WorkID string
	Epoch         int64
	Request       *contracts.FileHelperRequest
	Deadline      time.Time
	// The trusted helper sets this for pollable stdin. Core uses cancellable
	// Engine streams and its own durable request/idle/authorization deadlines.
	ReadDeadline                         func(time.Time) error
	UploadEnded, CommitGranted, Finished bool
	temporaries                          map[string]bool
}

func (session *Session) read(seconds time.Duration) (Frame, error) {
	deadline := time.Now().Add(seconds)
	if session.Deadline.Before(deadline) {
		deadline = session.Deadline
	}
	if !time.Now().Before(deadline) {
		return Frame{}, Failure("FILE_TRANSFER_TIMEOUT")
	}
	if session.ReadDeadline != nil {
		if err := session.ReadDeadline(deadline); err != nil {
			return Frame{}, Failure("FILE_RUNTIME_UNAVAILABLE")
		}
	}
	frame, err := Read(session.Source, true)
	if err != nil {
		if !time.Now().Before(deadline) {
			return Frame{}, Failure("FILE_TRANSFER_TIMEOUT")
		}
		return Frame{}, err
	}
	if frame.Kind == Cancel {
		return Frame{}, Failure("FILE_TRANSFER_TIMEOUT")
	}
	return frame, nil
}
func (session *Session) Start() (contracts.FileHelperRequest, error) {
	if session.Request != nil {
		return contracts.FileHelperRequest{}, protocolFailure()
	}
	session.Deadline = time.Now().Add(RequestTimeout)
	frame, err := session.read(IdleTimeout)
	if err != nil {
		return contracts.FileHelperRequest{}, err
	}
	request, err := ValidateRequest(frame, session.JobID, session.WorkID, session.Epoch)
	if err != nil {
		return request, err
	}
	session.Request = &request
	session.temporaries = map[string]bool{}
	return request, nil
}
func nullable(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }
func (session *Session) Prepare(phase string, temporaryID *string, parent []string, name *string, device, inode *string) error {
	if session.Request == nil || session.Finished || phase != "temporary" && phase != "commit" {
		return protocolFailure()
	}
	if phase == "commit" {
		if session.CommitGranted || session.Request.Action == "PUT" && !session.UploadEnded {
			return protocolFailure()
		}
	} else {
		if temporaryID == nil {
			return protocolFailure()
		}
		created, planned := session.temporaries[*temporaryID]
		if created || !planned && (device != nil || inode != nil) || planned && (device == nil || inode == nil) {
			return protocolFailure()
		}
	}
	if parent == nil {
		parent = []string{}
	}
	notice := contracts.FileHelperPrepared{Epoch: session.Epoch, Phase: phase, TemporaryId: nullable(temporaryID), ParentSegments: parent, Name: nullable(name), Device: nullable(device), Inode: nullable(inode)}
	if err := Write(session.Sink, Prepared, notice, false); err != nil {
		return err
	}
	frame, err := session.read(AckTimeout)
	if err != nil {
		return err
	}
	if frame.Kind != Ack {
		return protocolFailure()
	}
	ack, err := Decode[contracts.FileHelperAck](frame, "FileHelperAckSchema")
	if err != nil || ack.Epoch != session.Epoch || ack.Phase != phase || !bytes.Equal(ack.TemporaryId, notice.TemporaryId) {
		return protocolFailure()
	}
	if phase == "commit" {
		session.CommitGranted = true
	} else {
		session.temporaries[*temporaryID] = device != nil
	}
	return nil
}
func (session *Session) Upload(consume func([]byte) error) (int64, error) {
	if session.Request == nil || session.Request.Action != "PUT" || session.UploadEnded {
		return 0, protocolFailure()
	}
	var count int64
	for {
		frame, err := session.read(IdleTimeout)
		if err != nil {
			return count, err
		}
		if frame.Kind == End {
			parsed, err := contracts.ParseJSON(bytes.NewReader(frame.Data), MaxControl)
			value, ok := parsed.(map[string]any)
			if err != nil || !ok || len(value) != 0 {
				return count, protocolFailure()
			}
			if string(session.Request.ExpectedLength) != "null" {
				var expected int64
				if json.Unmarshal(session.Request.ExpectedLength, &expected) != nil || count != expected {
					return count, Failure("FILE_REQUEST_INVALID")
				}
			}
			session.UploadEnded = true
			return count, nil
		}
		if frame.Kind != DataIn {
			return count, protocolFailure()
		}
		count += int64(len(frame.Data))
		if count > MaxFile {
			return count, Failure("FILE_LIMIT_EXCEEDED")
		}
		if err := consume(frame.Data); err != nil {
			return count, err
		}
	}
}
func (session *Session) SendMeta(value contracts.FileHelperMeta) error {
	if session.Request == nil || session.Finished {
		return protocolFailure()
	}
	return Write(session.Sink, Meta, value, false)
}
func (session *Session) SendData(data []byte) error {
	if session.Request == nil || session.Finished {
		return protocolFailure()
	}
	return Write(session.Sink, DataOut, data, false)
}
func Mutation(action string) bool {
	switch action {
	case "PUT", "MKCOL", "COPY", "MOVE", "DELETE":
		return true
	}
	return false
}
func (session *Session) SendResult(status, count, entries int64) error {
	if session.Request == nil || session.Finished || Mutation(session.Request.Action) && !session.CommitGranted || session.Request.Action == "PUT" && !session.UploadEnded {
		return protocolFailure()
	}
	err := Write(session.Sink, Result, contracts.FileHelperResult{Status: status, Bytes: count, Entries: entries}, false)
	if err == nil {
		session.Finished = true
	}
	return err
}
func (session *Session) SendError(code string, path []string, terminal bool) error {
	if session.Finished {
		return nil
	}
	err := Write(session.Sink, Error, contracts.FileHelperError{Code: code, PathSegments: nullable(path)}, false)
	if terminal && err == nil {
		session.Finished = true
	}
	return err
}
