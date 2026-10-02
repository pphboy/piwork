package filehelper

import (
	"encoding/json"

	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
)

func Handle(session *fileprotocol.Session, request contracts.FileHelperRequest, workspace string) error {
	work, err := OpenWorkspace(workspace)
	if err != nil {
		return err
	}
	defer work.Close()
	check := func(info *contracts.FileHelperMeta) error { _, err := evaluateConditions(request, info); return err }
	path := request.PathSegments
	var status, count int64
	var failures []TreeFailure
	switch request.Action {
	case "CLEANUP":
		count, err = work.Cleanup(request)
		if err == nil {
			return session.SendResult(204, 0, count)
		}
	case "PROPFIND":
		var depth *int64
		if string(request.Depth) != "null" {
			if json.Unmarshal(request.Depth, &depth) != nil {
				return pathError("FILE_DEPTH_UNSUPPORTED")
			}
		}
		if depth == nil || *depth != 0 && *depth != 1 {
			return pathError("FILE_DEPTH_UNSUPPORTED")
		}
		own, err := work.Stat(path)
		if err != nil {
			return err
		}
		if err := session.SendMeta(own); err != nil {
			return err
		}
		entries := int64(1)
		if own.Kind == "directory" && *depth == 1 {
			children, err := work.List(path)
			if err != nil {
				return err
			}
			for _, item := range children {
				if err := session.SendMeta(item); err != nil {
					return err
				}
				entries++
			}
		}
		return session.SendResult(207, 0, entries)
	case "GET", "HEAD":
		info, err := work.StatOptional(path)
		if err != nil {
			return err
		}
		conditional, err := evaluateConditions(request, info)
		if err != nil {
			return err
		}
		if info == nil {
			return pathError("FILE_NOT_FOUND")
		}
		if err := session.SendMeta(*info); err != nil {
			return err
		}
		if conditional == 304 {
			return session.SendResult(304, 0, 0)
		}
		if info.Kind == "directory" {
			if request.Action == "GET" {
				return pathError("FILE_METHOD_NOT_ALLOWED")
			}
			return session.SendResult(200, 0, 0)
		}
		if info.Kind != "file" {
			return pathError("FILE_TYPE_UNSUPPORTED")
		}
		if request.Action == "HEAD" {
			return session.SendResult(200, 0, 0)
		}
		var size int64
		if json.Unmarshal(info.Size, &size) != nil {
			return pathError("FILE_RUNTIME_UNAVAILABLE")
		}
		start, end, err := normalizeRange(request.Range, size)
		if err != nil {
			return err
		}
		count, err = work.Read(path, start, end, session.SendData)
		if err != nil {
			return err
		}
		status = 200
		if end != nil {
			status = 206
		}
		return session.SendResult(status, count, 0)
	case "PUT":
		status, count, err = work.Put(path, session, check)
	case "MKCOL":
		status, err = work.Mkcol(path, session, check)
	case "DELETE":
		if string(request.Depth) != "null" && string(request.Depth) != `"infinity"` {
			return pathError("FILE_REQUEST_INVALID")
		}
		status, failures, err = work.Delete(path, session, check)
	case "COPY", "MOVE":
		if string(request.DestinationSegments) == "null" {
			return pathError("FILE_REQUEST_INVALID")
		}
		var destination []string
		if json.Unmarshal(request.DestinationSegments, &destination) != nil {
			return pathError("FILE_REQUEST_INVALID")
		}
		overwrite := string(request.Overwrite) != "false"
		shallow := string(request.Depth) == "0"
		if request.Action == "MOVE" && shallow || string(request.Depth) != "null" && string(request.Depth) != `"infinity"` && !shallow {
			return pathError("FILE_REQUEST_INVALID")
		}
		if request.Action == "COPY" {
			status, failures, err = work.Copy(path, destination, session, overwrite, shallow, check)
		} else {
			status, failures, err = work.Move(path, destination, session, overwrite, check)
		}
	default:
		return pathError("FILE_REQUEST_INVALID")
	}
	if err != nil {
		return err
	}
	for _, failure := range failures {
		if err := session.SendError(failure.Code, failure.PathSegments, false); err != nil {
			return err
		}
	}
	return session.SendResult(status, count, int64(len(failures)))
}
