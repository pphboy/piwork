package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/filehelper"
	"piwork/internal/fileprotocol"
)

func rawText(raw json.RawMessage) (string, bool) {
	var value string
	if string(raw) == "null" || json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return value, true
}

// Persist each notice before returning the ACK. The caller may send this ACK
// only on the current attempt and only while its cancellation signal is live.
func (a *Application) recordFilePrepared(ctx context.Context, job corestore.FileJob, notice contracts.FileHelperPrepared) (contracts.FileHelperAck, error) {
	ack := contracts.FileHelperAck{Epoch: job.WorkEpoch, Phase: notice.Phase, TemporaryId: notice.TemporaryId}
	protocol := func() (contracts.FileHelperAck, error) {
		return ack, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	if notice.Epoch != job.WorkEpoch || !fileprotocol.Mutation(job.Kind) {
		return protocol()
	}
	if err := filehelper.ValidateSegments(notice.ParentSegments); err != nil {
		return protocol()
	}
	if notice.Phase == "commit" {
		if string(notice.TemporaryId) != "null" || string(notice.Name) != "null" || string(notice.Device) != "null" || string(notice.Inode) != "null" || len(notice.ParentSegments) != 0 {
			return protocol()
		}
	} else if notice.Phase == "temporary" {
		id, ok := rawText(notice.TemporaryId)
		name, named := rawText(notice.Name)
		if !ok || id == "" || !named || !strings.HasPrefix(name, ".piwork-file-"+job.ID+"-") || !strings.HasSuffix(name, ".tmp") {
			return protocol()
		}
		if err := filehelper.ValidateSegments(append(append([]string{}, notice.ParentSegments...), name)); err != nil {
			return protocol()
		}
		if (string(notice.Device) == "null") != (string(notice.Inode) == "null") {
			return protocol()
		}
	} else {
		return protocol()
	}
	if _, _, err := a.validateFileAccess(ctx, fileAccessIdentity{WorkID: job.WorkID, OwnerUserID: job.OwnerUserID, SessionID: job.SessionID, RuntimeGeneration: job.RuntimeGeneration}); err != nil {
		return ack, err
	}
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		current, err := corestore.ReadFileJob(tx, job.ID)
		if err != nil {
			return err
		}
		if current.WorkEpoch != notice.Epoch || current.CoreEpoch != a.fileEpoch || current.State != "running" && current.State != "prepared" && current.State != "committing" {
			return fileprotocol.Failure("FILE_CONFLICT")
		}
		if err := corestore.AssertFileAccess(tx, job.WorkID, job.OwnerUserID, job.SessionID, packageNow()); err != nil {
			return err
		}
		gate, err := corestore.ReadFileGate(tx, job.WorkID)
		if err != nil {
			return err
		}
		if gate.Epoch != job.WorkEpoch || gate.Closed {
			return fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
		}
		if notice.Phase == "commit" {
			return corestore.AuthorizeFileCommit(tx, job.ID, notice.Epoch, packageNow())
		}
		id, _ := rawText(notice.TemporaryId)
		name, _ := rawText(notice.Name)
		if string(notice.Device) == "null" {
			var count int
			if err := tx.QueryRow(`SELECT count(*) FROM work_file_temporaries WHERE job_id=?`, job.ID).Scan(&count); err != nil {
				return err
			}
			if count >= filehelper.MaxEntries {
				return fileprotocol.Failure("FILE_LIMIT_EXCEEDED")
			}
			return corestore.InsertFileTemporary(tx, corestore.FileTemporary{ID: id, JobID: job.ID, ParentSegmentsJSON: string(jsonValue(notice.ParentSegments)), Name: name, State: "planned", CreatedAt: packageNow(), UpdatedAt: packageNow()})
		}
		items, err := corestore.FileTemporaries(tx, job.ID)
		if err != nil {
			return err
		}
		for _, item := range items {
			if item.ID == id {
				if item.Name != name || !bytes.Equal([]byte(item.ParentSegmentsJSON), jsonValue(notice.ParentSegments)) || item.State != "planned" {
					return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
				}
				device, ok := rawText(notice.Device)
				inode, inoded := rawText(notice.Inode)
				if !ok || !inoded {
					return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
				}
				return corestore.ConfirmFileTemporary(tx, id, job.ID, device, inode, packageNow())
			}
		}
		return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	})
	return ack, fileFailure(err)
}
