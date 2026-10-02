// Package fileprotocol is the unchanged version 1 framed Work file protocol.
package fileprotocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"time"

	"piwork/internal/contracts"
)

const (
	Request    byte  = 1
	DataIn     byte  = 2
	End        byte  = 3
	Ack        byte  = 4
	Cancel     byte  = 5
	Meta       byte  = 17
	DataOut    byte  = 18
	Prepared   byte  = 19
	Result     byte  = 20
	Error      byte  = 21
	MaxData          = 1 << 20
	MaxControl       = 64 << 10
	MaxFile    int64 = 10 << 30
)
const IdleTimeout = time.Minute
const RequestTimeout = 30 * time.Minute
const AckTimeout = 10 * time.Second

type ProtocolError struct{ Code string }

func (e *ProtocolError) Error() string { return e.Code }
func Failure(code string) error        { return &ProtocolError{Code: code} }
func Code(err error) string {
	var failure *ProtocolError
	if errors.As(err, &failure) {
		return failure.Code
	}
	return "FILE_RUNTIME_UNAVAILABLE"
}
func protocolFailure() error { return Failure("FILE_BACKEND_PROTOCOL_ERROR") }

func readFailure(err error) error {
	var failure *ProtocolError
	if errors.As(err, &failure) {
		return err
	}
	return protocolFailure()
}

type Frame struct {
	Kind byte
	Data []byte
}

func direction(kind byte, inbound bool) bool {
	if inbound {
		return kind >= Request && kind <= Cancel
	}
	return kind >= Meta && kind <= Error
}
func limit(kind byte) int {
	if kind == DataIn || kind == DataOut {
		return MaxData
	}
	return MaxControl
}
func Read(source io.Reader, inbound bool) (Frame, error) {
	var header [5]byte
	if _, err := io.ReadFull(source, header[:]); err != nil {
		return Frame{}, readFailure(err)
	}
	kind, size := header[0], binary.BigEndian.Uint32(header[1:])
	if !direction(kind, inbound) || uint64(size) > uint64(limit(kind)) {
		return Frame{}, protocolFailure()
	}
	payload := make([]byte, int(size))
	if _, err := io.ReadFull(source, payload); err != nil {
		return Frame{}, readFailure(err)
	}
	if kind != DataIn && kind != DataOut {
		parsed, err := contracts.ParseJSON(bytes.NewReader(payload), MaxControl)
		if _, ok := parsed.(map[string]any); err != nil || !ok {
			return Frame{}, protocolFailure()
		}
	}
	return Frame{Kind: kind, Data: payload}, nil
}
func Write(sink io.Writer, kind byte, value any, inbound bool) error {
	if !direction(kind, inbound) {
		return protocolFailure()
	}
	var payload []byte
	if kind == DataIn || kind == DataOut {
		var ok bool
		payload, ok = value.([]byte)
		if !ok {
			return protocolFailure()
		}
	} else {
		var err error
		payload, err = json.Marshal(value)
		if err != nil {
			return protocolFailure()
		}
		parsed, err := contracts.ParseJSON(bytes.NewReader(payload), MaxControl)
		if _, ok := parsed.(map[string]any); err != nil || !ok {
			return protocolFailure()
		}
	}
	if len(payload) > limit(kind) {
		return protocolFailure()
	}
	var header [5]byte
	header[0] = kind
	binary.BigEndian.PutUint32(header[1:], uint32(len(payload)))
	for _, data := range [][]byte{header[:], payload} {
		for len(data) > 0 {
			n, err := sink.Write(data)
			if err != nil || n <= 0 {
				var failure *ProtocolError
				if errors.As(err, &failure) {
					return err
				}
				return Failure("FILE_RUNTIME_UNAVAILABLE")
			}
			data = data[n:]
		}
	}
	return nil
}
func Decode[T any](frame Frame, schema string) (T, error) {
	value, err := contracts.Decode[T](bytes.NewReader(frame.Data), schema, MaxControl)
	if err != nil {
		return value, protocolFailure()
	}
	return value, nil
}

func ValidateRequest(frame Frame, jobID, workID string, epoch int64) (contracts.FileHelperRequest, error) {
	var zero contracts.FileHelperRequest
	if frame.Kind != Request {
		return zero, protocolFailure()
	}
	request, err := Decode[contracts.FileHelperRequest](frame, "FileHelperRequestSchema")
	if err != nil || string(request.JobId) != jobID || string(request.WorkId) != workID || request.Epoch != epoch || epoch < 0 {
		return zero, protocolFailure()
	}
	if request.Action == "CLEANUP" {
		if !request.Temporaries.Present || request.Temporaries.Null {
			return zero, protocolFailure()
		}
	} else if request.Temporaries.Present {
		return zero, protocolFailure()
	}
	return request, nil
}
