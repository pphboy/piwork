#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export GOTOOLCHAIN=local
export CGO_ENABLED=0
if [[ "$(go env GOVERSION)" != "go1.25.5" ]]; then
  echo "Native builds require Go 1.25.5." >&2
  exit 1
fi

piwork_build_dir="${PIWORK_GO_BUILD_DIR:-dist/go}"
mkdir -p "$piwork_build_dir"
piwork_build_commit="$(git rev-parse --verify HEAD)"
piwork_build_modified=false
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  piwork_build_modified=true
fi
piwork_build_version="${PIWORK_BUILD_VERSION:-0.1.0-dev}"
if [[ ! "$piwork_build_version" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo "Native build version is invalid." >&2
  exit 1
fi
go build -mod=readonly -trimpath -buildvcs=true \
  -ldflags "-X piwork/internal/buildinfo.Version=$piwork_build_version -X piwork/internal/buildinfo.Commit=$piwork_build_commit -X piwork/internal/buildinfo.Modified=$piwork_build_modified" \
  -o "$piwork_build_dir/" ./cmd/...
ln -sfn piwork-serve "$piwork_build_dir/piwork"
