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
go run ./scripts/releaseinfo-check
if [[ "${GOOS:-linux}/${GOARCH:-amd64}" != "linux/amd64" ]]; then
  echo "Native builds support only linux/amd64." >&2
  exit 1
fi
export GOOS=linux GOARCH=amd64
piwork_build_dir=$(node scripts/managed-output.mjs prepare "$piwork_build_dir")
piwork_build_stage=$(mktemp -d "${piwork_build_dir}.stage-XXXXXXXX")
trap 'rm -rf -- "$piwork_build_stage"' EXIT
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
piwork_desktop_hash=$(node --input-type=module -e "import {desktopInputHash} from './scripts/build-cli.mjs'; console.log(desktopInputHash())")
piwork_console_hash=$(node --input-type=module -e "import {consoleInputHash} from './scripts/build-cli.mjs'; console.log(consoleInputHash())")
piwork_server_defaults=""
if [[ -n "${PIWORK_RELEASE_METADATA:-}" ]]; then
  piwork_server_defaults="$(node scripts/native-server-defaults.mjs "$PIWORK_RELEASE_METADATA")"
  piwork_release_version=$(node -p "require('./package.json').version")
  if [[ -n "${PIWORK_BUILD_VERSION:-}" && "$PIWORK_BUILD_VERSION" != "$piwork_release_version" ]]; then
    echo "Native release version differs from reviewed metadata." >&2
    exit 1
  fi
  piwork_build_version=$piwork_release_version
  piwork_server_defaults="-X piwork/internal/distribution.EncodedImages=$piwork_server_defaults"
fi
go build -mod=readonly -trimpath -buildvcs=true \
  -ldflags "-X piwork/internal/buildinfo.Version=$piwork_build_version -X piwork/internal/buildinfo.Commit=$piwork_build_commit -X piwork/internal/buildinfo.Modified=$piwork_build_modified -X piwork/internal/buildinfo.DesktopUIHash=$piwork_desktop_hash -X piwork/internal/buildinfo.ConsoleUIHash=$piwork_console_hash $piwork_server_defaults" \
  -o "$piwork_build_stage/" ./cmd/piwork-core ./cmd/piwork-cli
node scripts/managed-output.mjs commit "$piwork_build_dir" "$piwork_build_stage"
