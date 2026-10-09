#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
piwork_release_root=$PWD
piwork_release_input=$(realpath "${1:-dist/docker/inputs}")
export PIWORK_COMMIT
PIWORK_COMMIT=$(git rev-parse --verify HEAD)
export PIWORK_MODIFIED=false
if [[ -n $(git status --porcelain --untracked-files=normal) ]]; then
    PIWORK_MODIFIED=true
fi
export PIWORK_RELEASE_REGISTRY
PIWORK_RELEASE_REGISTRY=$(cat "$piwork_release_input/registry")

for piwork_release_role in core cli agent fileHelper snapshotHelper; do
    piwork_release_ref=$(cat "$piwork_release_input/$piwork_release_role")
    docker image inspect "$piwork_release_ref" > "$piwork_release_input/$piwork_release_role.image.json"
    case "$piwork_release_role" in
        core) piwork_release_programs=(piwork-serve) ;;
        cli) piwork_release_programs=(piwork-cli) ;;
        agent) piwork_release_programs=(piwork-package-helper piwork-service-mcp) ;;
        fileHelper) piwork_release_programs=(piwork-file-helper) ;;
        snapshotHelper) piwork_release_programs=(piwork-snapshot-helper) ;;
    esac
    for piwork_release_program in "${piwork_release_programs[@]}"; do
        docker run --rm --network none --read-only --cap-drop ALL \
            --security-opt no-new-privileges \
            --entrypoint "/usr/local/bin/$piwork_release_program" \
            "$piwork_release_ref" --version \
            > "$piwork_release_input/$piwork_release_role.$piwork_release_program.json"
    done
    if [[ $piwork_release_role == core || $piwork_release_role == cli ]]; then
        docker run --rm --network none --read-only "$piwork_release_ref" --help >/dev/null
        docker run --rm --network none --read-only --entrypoint /bin/sh "$piwork_release_ref" -ec \
            'command -v curl >/dev/null; test -s /etc/ssl/certs/ca-certificates.crt; for tool in go node npm python python3 docker; do if command -v "$tool" >/dev/null 2>&1; then exit 1; fi; done'
        if [[ $piwork_release_role == cli ]]; then
            docker run --rm --network none --read-only --entrypoint /bin/sh "$piwork_release_ref" -ec \
                'jq --version >/dev/null; test "$(stat -c %a /var/lib/piwork/client)" = 700; test "$(stat -c %u /var/lib/piwork/client)" = 0'
        else
            docker run --rm --network none --read-only --entrypoint cat "$piwork_release_ref" \
                /etc/piwork/docker-release.json > "$piwork_release_input/core.release-config.json"
        fi
        printf 'true\n' > "$piwork_release_input/$piwork_release_role.boundary"
    fi
done

# A stock Node container processes records; the host needs no Node/Go toolchain.
docker run --rm --network none --read-only \
    --user "$(id -u):$(id -g)" \
    --env PIWORK_COMMIT --env PIWORK_MODIFIED --env PIWORK_RELEASE_REGISTRY \
    --volume "$piwork_release_root:/source:ro" \
    --volume "$piwork_release_input:/release-input" \
    --workdir /source node:24-bookworm-slim \
    node scripts/build-docker-release.mjs records /release-input
printf '%s\n' 'Verified local image identities and runtime boundaries.'
