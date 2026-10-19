// Package distribution supplies nonsecret, embedded release dependencies.
package distribution

import (
	"bytes"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
)

// EncodedImages is set to the candidate's dependency references by release
// builders. Development builds use the last published matching defaults.
var EncodedImages string
var imageReference = regexp.MustCompile(`^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$`)

//go:embed images.json
var embeddedImages []byte

type Images struct {
	Agent          string `json:"agent"`
	PackageHelper  string `json:"packageHelper"`
	FileHelper     string `json:"fileHelper"`
	SnapshotHelper string `json:"snapshotHelper"`
}

func Defaults() (Images, error) {
	data := embeddedImages
	if EncodedImages != "" {
		var err error
		data, err = base64.RawStdEncoding.DecodeString(EncodedImages)
		if err != nil {
			return Images{}, errors.New("invalid embedded release dependencies")
		}
	}
	var images Images
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var extra any
	if len(data) > 64<<10 || decoder.Decode(&images) != nil || decoder.Decode(&extra) != io.EOF {
		return images, errors.New("invalid embedded release dependencies")
	}
	for _, reference := range []string{images.Agent, images.PackageHelper, images.FileHelper, images.SnapshotHelper} {
		if len(reference) > 255 || !imageReference.MatchString(reference) || strings.HasSuffix(reference, ":latest") {
			return Images{}, errors.New("invalid embedded release dependencies")
		}
	}
	return images, nil
}
