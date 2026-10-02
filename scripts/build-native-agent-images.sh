#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
native_commit="$(git rev-parse HEAD)"
native_modified=false
if [[ -n "$(git status --porcelain)" ]]; then
  native_modified=true
fi

for native_variant in production acceptance; do
  docker build -f Dockerfile.agentd --target "$native_variant" \
    --build-arg "PIWORK_COMMIT=$native_commit" \
    --build-arg "PIWORK_MODIFIED=$native_modified" \
    -t "piwork-agentd:go-migration-$native_variant" .
done
