package coreapp

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
	"piwork/internal/workpackage"
)

func (a *Application) validateSnapshotPlatform(ctx context.Context, spec contracts.PortableWorkSpec) error {
	if a.engine == nil {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	os, arch, err := a.engine.HostPlatform(ctx)
	if err != nil {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	if spec.Compatibility.Os != os || spec.Compatibility.Architecture != arch || string(spec.Compatibility.Variant) != "null" {
		return contracts.NewError("PACKAGE_INCOMPATIBLE", "platform")
	}
	return nil
}

func (a *Application) loadSnapshotImage(ctx context.Context, image contracts.PortableWorkImage, blobs *workpackage.BlobDirectory, spec contracts.PortableWorkSpec) error {
	actual, err := a.engine.InspectImage(ctx, string(image.ImageId))
	if err == nil {
		if actual.ID != string(image.ImageId) || actual.OS != image.Platform.Os || actual.Architecture != image.Platform.Architecture {
			return contracts.NewError("PACKAGE_INCOMPATIBLE", "image")
		}
		return nil
	}
	if !errors.Is(err, dockerengine.ErrResourceMissing) {
		return err
	}
	descriptors := map[string]contracts.WorkBlob{}
	for _, blob := range spec.Blobs {
		descriptors[string(blob.Digest)] = blob
	}
	input, output := io.Pipe()
	done := make(chan error, 1)
	go func() {
		writer := tar.NewWriter(output)
		write := func(name string, size int64, source io.Reader) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0644, Size: size}); err != nil {
				return err
			}
			n, err := io.CopyBuffer(writer, source, make([]byte, 1<<20))
			if err == nil && n != size {
				return io.ErrUnexpectedEOF
			}
			return err
		}
		blob := func(name, digest string) error {
			file, err := blobs.Read(digest)
			if err != nil {
				return err
			}
			defer file.Close()
			return write(name, int64(descriptors[digest].Size), file)
		}
		run := func() error {
			configName := strings.TrimPrefix(string(image.ImageId), "sha256:") + ".json"
			if err := blob(configName, string(image.Config)); err != nil {
				return err
			}
			layers := make([]string, 0, len(image.Layers))
			for i, digest := range image.Layers {
				name := fmt.Sprintf("layer-%06d/layer.tar", i)
				layers = append(layers, name)
				if err := blob(name, string(digest)); err != nil {
					return err
				}
			}
			manifest, _ := json.Marshal([]struct {
				Config   string
				RepoTags []string
				Layers   []string
			}{{configName, []string{}, layers}})
			if err := write("manifest.json", int64(len(manifest)), bytes.NewReader(manifest)); err != nil {
				return err
			}
			return writer.Close()
		}
		err := run()
		output.CloseWithError(err)
		done <- err
	}()
	err = a.engine.LoadImage(ctx, input, workpackage.DefaultLimits.PackageBytes+(64<<20))
	input.CloseWithError(err)
	producer := <-done
	if err != nil {
		return err
	}
	if producer != nil {
		return producer
	}
	actual, err = a.engine.InspectImage(ctx, string(image.ImageId))
	if err != nil {
		return err
	}
	if actual.ID != string(image.ImageId) || actual.OS != image.Platform.Os || actual.Architecture != image.Platform.Architecture {
		return contracts.NewError("PACKAGE_INCOMPATIBLE", "image")
	}
	return nil
}
