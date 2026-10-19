#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
release_commit="$(git rev-parse --verify HEAD)"
release_build_dir="${PIWORK_GO_BUILD_DIR:-dist/go}"
release_name="piwork-linux-amd64-${release_commit:0:12}"
release_root="dist/release"
release_stage="$release_root/$release_name"
mkdir -p "$release_root"
rm -rf "$release_stage"
mkdir -p "$release_stage/bin"

for release_asset in \
  internal/desktopassets/static/browser/app.js \
  internal/desktopassets/static/public/style.css \
  internal/consoleassets/static/browser/app.js \
  internal/consoleassets/static/browser/onboarding.js \
  internal/consoleassets/static/public/setup.html \
  internal/consoleassets/static/browser/browser-crypto.js \
  internal/desktopassets/static/browser/browser-crypto.js \
  internal/consoleassets/static/public/style.css; do
  test -s "$release_asset" || { echo "Missing compiled browser asset: $release_asset" >&2; exit 1; }
done

for release_program in piwork-serve piwork-cli piwork-console; do
  install -m 0555 "$release_build_dir/$release_program" "$release_stage/bin/$release_program"
done
ln -s piwork-serve "$release_stage/bin/piwork"
for release_program in piwork-serve piwork-cli piwork-console piwork-file-helper piwork-snapshot-helper piwork-service-mcp piwork-package-helper; do
  release_binary="$release_build_dir/$release_program"
  test -x "$release_binary"
  test "$(readelf -h "$release_binary" | sed -n 's/^  Machine: *//p')" = "Advanced Micro Devices X86-64"
  if readelf -d "$release_binary" | rg -q 'NEEDED' || readelf -l "$release_binary" | rg -q 'INTERP'; then
    echo "$release_program has a dynamic runtime dependency" >&2
    exit 1
  fi
  "$release_binary" --version | node -e 'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.stringify(JSON.parse(input)) + "\n"));' >> "$release_stage/programs.ndjson"
  go version -m "$release_binary" >> "$release_stage/go-build-info.txt"
done
test "$(wc -l < "$release_stage/programs.ndjson")" -eq 7
test "$(rg -c "$release_commit" "$release_stage/programs.ndjson")" -eq 7
node --input-type=module - "$release_stage" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {desktopInputHash,consoleInputHash} from './scripts/build-cli.mjs';
const stage=process.argv[2], programs=readFileSync(stage+'/programs.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line));
const server=programs.find(program=>program.program==='piwork-serve');
if(server?.desktopUIHash!==desktopInputHash()||server?.consoleUIHash!==consoleInputHash())throw new Error('Native server browser inputs do not match packaged resources.');
writeFileSync(stage+'/server-build.json',JSON.stringify({application:'unified-linux',build:server,binarySHA256:createHash('sha256').update(readFileSync(stage+'/bin/piwork-serve')).digest('hex'),optionalPrograms:['piwork-cli','piwork-console']},null,2)+'\n');
NODE

agent_protocol_sha="$(sha256sum proto/agent.proto | cut -d' ' -f1)"
service_protocol_sha="$(sha256sum proto/work-services.proto | cut -d' ' -f1)"
printf '{"commit":"%s","agentProtoSha256":"%s","workServicesProtoSha256":"%s"}\n' \
  "$release_commit" "$agent_protocol_sha" "$service_protocol_sha" > "$release_stage/build-manifest.json"

release_agent=piwork-agentd:go-migration-production
release_acceptance_agent=piwork-agentd:go-migration-acceptance
release_file_helper=piwork-file-helper:go-migration-acceptance
release_snapshot_helper=piwork-snapshot-helper:go-migration-acceptance
if [[ -n "${PIWORK_RELEASE_METADATA:-}" ]]; then
  # Validate the same reviewed inputs used by build-go before selecting images.
  release_encoded_defaults=$(node scripts/native-server-defaults.mjs "$PIWORK_RELEASE_METADATA")
  # Go's trimpath build metadata omits linker flags. The linked string itself
  # must be present in the binary; do not infer it from an adjacent JSON file.
  LC_ALL=C rg --text --fixed-strings --quiet -- "$release_encoded_defaults" "$release_build_dir/piwork-serve" || {
    echo "Native server does not embed the reviewed dependency set." >&2
    exit 1
  }
  release_agent=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).images.agent' "$PIWORK_RELEASE_METADATA")
  release_acceptance_agent=$release_agent
  release_file_helper=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).images.fileHelper' "$PIWORK_RELEASE_METADATA")
  release_snapshot_helper=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).images.snapshotHelper' "$PIWORK_RELEASE_METADATA")
  install -m 0444 "$PIWORK_RELEASE_METADATA" "$release_stage/release-inputs.json"
fi
for release_image in "$release_agent" "$release_acceptance_agent" "$release_file_helper" "$release_snapshot_helper"; do
  release_id="$(docker image inspect --format '{{.Id}}' "$release_image")"
  release_labels="$(docker image inspect --format '{{json .Config.Labels}}' "$release_image")"
  case "$release_image" in
    "$release_agent"|"$release_acceptance_agent")
      test "$(docker image inspect --format '{{index .Config.Labels "io.piwork.agent.protocol"}}' "$release_image")" = v2
      test "$(docker image inspect --format '{{index .Config.Labels "io.piwork.package-helper.contract"}}' "$release_image")" = 2
      test "$(docker image inspect --format '{{index .Config.Labels "io.piwork.work-history.schema"}}' "$release_image")" = 5
      test "$(docker image inspect --format '{{index .Config.Labels "io.piwork.run-model.contract"}}' "$release_image")" = 1
      test "$(docker image inspect --format '{{index .Config.Labels "io.piwork.work-feedback.contract"}}' "$release_image")" = 1
      test "$(docker image inspect --format '{{index .Config.Labels "io.piwork.service-mcp.contract"}}' "$release_image")" = 1
      ;;
    "$release_file_helper")
      test "$(docker image inspect --format '{{index .Config.Labels "piwork.file_protocol"}}' "$release_image")" = 1
      ;;
    "$release_snapshot_helper")
      test "$(docker image inspect --format '{{index .Config.Labels "piwork.snapshot_protocol"}}' "$release_image")" = 1
      ;;
  esac
  printf '{"reference":"%s","id":"%s","labels":%s}\n' "$release_image" "$release_id" "$release_labels" >> "$release_stage/images.ndjson"
done

for release_probe in \
  "$release_agent piwork-service-mcp" \
  "$release_agent piwork-package-helper" \
  "$release_acceptance_agent piwork-service-mcp" \
  "$release_acceptance_agent piwork-package-helper" \
  "$release_file_helper piwork-file-helper" \
  "$release_snapshot_helper piwork-snapshot-helper"; do
  read -r release_image release_program <<< "$release_probe"
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint "/usr/local/bin/$release_program" "$release_image" --version \
    >> "$release_stage/image-programs.ndjson"
done
test "$(wc -l < "$release_stage/image-programs.ndjson")" -eq 6
test "$(rg -c "$release_commit" "$release_stage/image-programs.ndjson")" -eq 6

node scripts/stage-go-release-materials.mjs "$release_stage" "$release_commit"
(
  cd "$release_stage"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
tar -C "$release_root" -czf "$release_root/$release_name.tar.gz" "$release_name"
(cd "$release_root" && sha256sum "$release_name.tar.gz" > "$release_name.tar.gz.sha256")
printf '%s\n' "$release_root/$release_name.tar.gz"
