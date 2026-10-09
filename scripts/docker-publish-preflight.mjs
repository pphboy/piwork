import { createHash } from 'node:crypto';

// Docker's verbose output carries the config identity, not the registry digest.
export function remoteConfigIdentity(value) {
  let entries = Array.isArray(value) ? value : [value];
  if (Array.isArray(value)) entries = entries.filter(item => item.Descriptor?.platform?.os === 'linux' && item.Descriptor?.platform?.architecture === 'amd64');
  if (entries.length !== 1) throw new Error('Remote platform identity is ambiguous.');
  const item = entries[0];
  const manifest = item.SchemaV2Manifest || item.OCIManifest || item;
  const digest = manifest.config?.digest;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest || '')) throw new Error('Remote config identity is unavailable.');
  return digest;
}
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export function renderPublishScript(manifest) {
  const manifestHash = createHash('sha256').update(JSON.stringify(manifest, null, 2) + '\n').digest('hex');
  const parser = remoteConfigIdentity.toString() + ';let text="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>text+=chunk);process.stdin.on("end",()=>{try{process.stdout.write(remoteConfigIdentity(JSON.parse(text)))}catch{process.exitCode=1}});';
  const lines = ['#!/bin/sh', '# Defaults to preflight only. Use --push only after reviewing and authorizing this candidate.', 'set -eu', 'case "${1:---check}" in --check) publish=false ;; --push) publish=true ;; *) exit 2 ;; esac', '[ "$#" -le 1 ] || exit 2', 'cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"', `printf '%s  %s\n' ${quote(manifestHash)} release-manifest.json | sha256sum --check --status || { echo 'Reviewed manifest changed.' >&2; exit 1; }`, 'publish_tmp=$(mktemp -d)', 'trap \'rm -rf "$publish_tmp"\' EXIT', 'trap \'exit 1\' HUP INT TERM'];
  for (const role of ['core', 'cli', 'agent', 'fileHelper', 'snapshotHelper']) {
    const image = manifest.images[role];
    if (!/^sha256:[a-f0-9]{64}$/.test(image?.imageId || '') || !/^[a-z0-9][a-z0-9./:_-]+$/.test(image?.reference || '')) throw new Error('Missing reviewed image identity.');
    const labels = { 'org.opencontainers.image.version': manifest.releaseVersion, 'org.opencontainers.image.revision': manifest.sourceCommit, 'io.piwork.source.modified': String(manifest.sourceModified), 'io.piwork.source.input-sha256': manifest.sourceInputHash, ...image.protocolLabels, ...(role === 'cli' ? { 'io.piwork.desktop.input-sha256': manifest.desktopUIHash } : {}) };
    const format = '{{.Id}}|{{.Os}}/{{.Architecture}}' + Object.keys(labels).map(key => `|{{index .Config.Labels "${key}"}}`).join('');
    const expected = [image.imageId, image.platform, ...Object.values(labels)].join('|');
    lines.push(`# Check ${role} before ANY push.`, `local_identity=$(docker image inspect --format ${quote(format)} ${quote(image.reference)}) || exit 1`, `[ "$local_identity" = ${quote(expected)} ] || { echo '${role}: local candidate changed.' >&2; exit 1; }`, `if docker manifest inspect --verbose ${quote(image.reference)} > "$publish_tmp/manifest" 2> "$publish_tmp/error"; then`, `    remote_identity=$(docker run --rm --interactive --network none node:24-bookworm-slim node -e ${quote(parser)} < "$publish_tmp/manifest") || { echo '${role}: remote identity cannot be verified.' >&2; exit 1; }`, `    [ "$remote_identity" = ${quote(image.imageId)} ] || { echo '${role}: remote release tag conflict.' >&2; exit 1; }`, 'else', `    if ! grep -Fx ${quote('no such manifest: ' + image.reference)} "$publish_tmp/error" >/dev/null; then`, `        echo '${role}: remote query failed; no images pushed.' >&2; exit 1`, '    fi', 'fi');
  }
  lines.push('echo "All reviewed local and remote identities passed preflight."', '[ "$publish" = true ] || exit 0');
  for (const role of ['core', 'cli', 'agent', 'fileHelper', 'snapshotHelper']) lines.push(`docker push ${quote(manifest.images[role].reference)}`);
  return lines.join('\n') + '\n';
}
