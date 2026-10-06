package coreapp

import (
	"context"
	"strings"

	"piwork/internal/fileprotocol"
)

// The operator's reference is captured once; neither a Work nor an HTTP
// request can choose an image. Failure degrades file access independently.
func (a *Application) captureFileHelper(ctx context.Context) error {
	a.fileMu.Lock()
	captured := a.fileImageCaptured
	a.fileMu.Unlock()
	if captured {
		return nil
	}
	if strings.TrimSpace(a.options.FileHelperImage) == "" || a.engine == nil || a.inspector == nil {
		return fileprotocol.Failure("FILE_HELPER_UNAVAILABLE")
	}
	image, err := a.preparation.prepareImage(ctx, "file", a.options.FileHelperImage)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.preparation.currentLocked(ctx) {
		return context.Canceled
	}
	a.fileMu.Lock()
	defer a.fileMu.Unlock()
	a.fileImageID, a.fileImageCaptured = image.ID, true
	return nil
}
func (a *Application) requireFileImage() (string, error) {
	a.fileMu.Lock()
	defer a.fileMu.Unlock()
	if a.fileImageID == "" {
		return "", fileprotocol.Failure("FILE_HELPER_UNAVAILABLE")
	}
	return a.fileImageID, nil
}
func (a *Application) fileCapability() any {
	_, err := a.requireFileImage()
	var reason any
	if err != nil {
		reason = "FILE_HELPER_UNAVAILABLE"
	}
	return map[string]any{"version": 1, "protocol": "webdav", "profile": "workspace-transfer-v1", "available": err == nil, "reason": reason, "rootTemplate": "/api/v1/works/{workId}/files/", "limits": map[string]int64{
		"maxHeaderBytes": 32768, "maxXmlBytes": 65536, "maxXmlDepth": 32, "maxProperties": 128, "maxMetadataBytes": 16777216,
		"maxDirectoryEntries": 10000, "maxTreeEntries": 10000, "maxFileBytes": 10737418240, "maxTreeBytes": 10737418240, "maxSegmentBytes": 255, "maxPathBytes": 4096, "maxPathDepth": 128,
		"maxCoreRequests": 16, "maxUserRequests": 8, "maxWorkRequests": 4, "maxWorkMutations": 1, "connectTimeoutMs": 10000, "helperTimeoutMs": 10000, "idleTimeoutMs": 60000, "requestTimeoutMs": 1800000, "authorizationRecheckMs": 2000}}
}
