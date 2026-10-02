package coreapp

import (
	"context"
	"io"
	"reflect"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/filehelper"
	"piwork/internal/fileprotocol"
	"piwork/internal/workfiles"
)

func (a *Application) exchangeFileFrames(ctx context.Context, stream io.ReadWriter, job corestore.FileJob, input fileExecutionInput, firstFrame func()) (fileExecutionResult, error) {
	result := fileExecutionResult{Failures: []contracts.FileHelperError{}}
	request := contracts.FileHelperRequest{Version: 1, JobId: contracts.ResourceId(job.ID), WorkId: contracts.ResourceId(job.WorkID), Epoch: job.WorkEpoch, Action: input.Action, PathSegments: input.Path,
		DestinationSegments: jsonValue(input.Destination), Depth: jsonValue(input.Depth), Overwrite: jsonValue(input.Overwrite), Range: jsonValue(input.Range), ExpectedLength: jsonValue(input.ExpectedLength), Conditions: input.Conditions}
	if _, err := fileprotocol.ValidateRequest(fileprotocol.Frame{Kind: fileprotocol.Request, Data: jsonValue(request)}, job.ID, job.WorkID, job.WorkEpoch); err != nil {
		return result, err
	}
	if err := fileprotocol.Write(stream, fileprotocol.Request, request, true); err != nil {
		return result, err
	}
	var metadata, metadataBytes, transferred int64
	var uploadBytes int64
	uploaded := false
	seenMetadata := map[string]bool{}
	for {
		if ctx.Err() != nil {
			return result, fileFailure(ctx.Err())
		}
		frame, err := fileprotocol.Read(stream, false)
		if err != nil {
			return result, err
		}
		if firstFrame != nil {
			firstFrame()
			firstFrame = nil
		}
		switch frame.Kind {
		case fileprotocol.Meta:
			item, err := fileprotocol.Decode[contracts.FileHelperMeta](frame, "FileHelperMetaSchema")
			if err != nil {
				return result, err
			}
			if input.Action != "PROPFIND" && input.Action != "GET" && input.Action != "HEAD" || filehelper.ValidateSegments(item.PathSegments) != nil {
				return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			if metadata == 0 || input.Action != "PROPFIND" {
				if metadata != 0 || !reflect.DeepEqual(item.PathSegments, input.Path) {
					return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
				}
			} else {
				if len(item.PathSegments) != len(input.Path)+1 || !reflect.DeepEqual(item.PathSegments[:len(input.Path)], input.Path) {
					return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
				}
			}
			key := string(jsonValue(item.PathSegments))
			if seenMetadata[key] {
				return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			seenMetadata[key] = true
			metadata++
			metadataBytes += int64(len(frame.Data))
			if metadata > filehelper.MaxEntries+1 || metadataBytes > workfiles.MaxMetadata {
				return result, fileprotocol.Failure("FILE_LIMIT_EXCEEDED")
			}
			if input.OnMeta != nil {
				if err := input.OnMeta(item); err != nil {
					return result, err
				}
			}
		case fileprotocol.DataOut:
			if input.Action != "GET" || metadata != 1 {
				return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			transferred += int64(len(frame.Data))
			if transferred > fileprotocol.MaxFile {
				return result, fileprotocol.Failure("FILE_LIMIT_EXCEEDED")
			}
			if input.OnData != nil {
				if err := input.OnData(frame.Data); err != nil {
					return result, err
				}
			}
		case fileprotocol.Prepared:
			notice, err := fileprotocol.Decode[contracts.FileHelperPrepared](frame, "FileHelperPreparedSchema")
			if err != nil {
				return result, err
			}
			if input.Action == "PUT" && notice.Phase == "commit" && !uploaded {
				return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			ack, err := a.recordFilePrepared(ctx, job, notice)
			if err != nil {
				return result, err
			}
			if ctx.Err() != nil {
				return result, fileFailure(ctx.Err())
			}
			if err := fileprotocol.Write(stream, fileprotocol.Ack, ack, true); err != nil {
				return result, err
			}
			if input.Action == "PUT" && notice.Phase == "temporary" && string(notice.Device) != "null" {
				if uploaded || input.Body == nil {
					return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
				}
				uploadBytes, err = uploadFileBody(ctx, stream, input.Body)
				if err != nil {
					return result, err
				}
				uploaded = true
			}
		case fileprotocol.Error:
			failure, err := fileprotocol.Decode[contracts.FileHelperError](frame, "FileHelperErrorSchema")
			if err != nil {
				return result, err
			}
			if _, known := workfiles.Status[failure.Code]; !known {
				return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			if string(failure.PathSegments) == "null" {
				if len(result.Failures) != 0 {
					return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
				}
				return result, fileprotocol.Failure(failure.Code)
			}
			result.Failures = append(result.Failures, failure)
			if len(result.Failures) > filehelper.MaxEntries {
				return result, fileprotocol.Failure("FILE_LIMIT_EXCEEDED")
			}
		case fileprotocol.Result:
			value, err := fileprotocol.Decode[contracts.FileHelperResult](frame, "FileHelperResultSchema")
			if err != nil {
				return result, err
			}
			result.FileHelperResult = value
			if len(result.Failures) > 0 && (value.Status != 207 || value.Entries != int64(len(result.Failures))) || input.Action == "GET" && value.Bytes != transferred || input.Action == "PUT" && (!uploaded || value.Bytes != uploadBytes) {
				return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			return result, nil
		default:
			return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
	}
}
func uploadFileBody(ctx context.Context, stream io.Writer, body io.Reader) (int64, error) {
	buffer := make([]byte, 64<<10)
	var total int64
	for {
		if ctx.Err() != nil {
			return total, fileFailure(ctx.Err())
		}
		n, err := body.Read(buffer)
		if n > 0 {
			total += int64(n)
			if total > fileprotocol.MaxFile {
				return total, fileprotocol.Failure("FILE_LIMIT_EXCEEDED")
			}
			if writeErr := fileprotocol.Write(stream, fileprotocol.DataIn, buffer[:n], true); writeErr != nil {
				return total, writeErr
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return total, fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")
		}
	}
	return total, fileprotocol.Write(stream, fileprotocol.End, map[string]any{}, true)
}
