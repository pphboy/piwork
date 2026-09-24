# Portable Work package v1

A `.work` file is a complete cold snapshot of the product's durable Work boundary. Users do not author its manifest: Core creates it from a stopped Work, and both offline inspect and recipient Core verify it before use. The MIME type is `application/vnd.piwork.work-package`.

## Framing and integrity

The bytes are, in order: the eight ASCII bytes `PIWORK1\n`, an unsigned 64-bit big-endian manifest length, that many UTF-8 JSON bytes, then every raw blob in `manifest.blobs` order, each with its declared size. There is no blob header, compression, or trailing data. The package SHA-256 covers all framing bytes; each blob also has a SHA-256 digest. The manifest is strict JSON: duplicate keys, unknown schema fields, unsafe integers, malformed UTF-8, dangling references, and unsupported versions fail validation. Blobs are uniquely listed in digest order, and a reused digest carries the union of its declared kinds.

The manifest describes `formatVersion: 1`, `snapshotKind: "cold-full"`, source name and creation time, Linux/platform compatibility, active and desired context keys, all context and service revisions, persistent quota reservations, the two managed volume trees and their service references, fixed container images, model/secret binding requirements, and control-history and source-identity-map blobs. Logical keys are relationships inside the package, not transferable platform IDs. History request/result/error JSON strings and user file bytes remain unchanged. The recipient assigns new Work, context, service, Operation, volume, network, and TLS identities; it preserves local Session/Run IDs within the newly isolated Work database.

Each volume and retained Skill directory is represented by a tree blob. Entries encode POSIX filename bytes as base64 path segments and retain file data, empty directories, symlinks, hard links, uid/gid, mode, and nanosecond mtime. The separate `agent-private` and `workspace` trees preserve private-volume files hidden beneath the workspace mount. Unsupported special files or nonempty xattrs/ACLs cause the whole export to fail rather than disappear. The package contains the selected image config and uncompressed layers by immutable digest, not a mutable registry tag. Import reconstructs a tagless verified image archive and never executes package code during validation.

V1 limits are 100 GiB package bytes and 100 GiB logical restored bytes, 64 MiB for each JSON metadata blob, 256 MiB total metadata, one million tree entries, 4096 bytes per path, and depth 128. Reused blobs do not bypass the logical restore limit. A valid hash proves byte integrity, not that the sender or embedded code is trustworthy. Inspect neither opens the embedded SQLite database nor installs the Work; recipient Core validates history in its isolated helper before the package becomes importable.

## What is and is not copied

The portable boundary includes the Work's two managed volumes, Work-owned contexts and Skills, AGENTS.md, configuration and service revisions, desired resource reservations and volume references (including disabled/tombstoned leftovers), terminal control history, private conversation history, and fixed image content. No user-content filter is applied, so `.env`, source code, databases, dependencies, and user-stored credentials travel intact.

The boundary does not include the Docker container's temporary layer, anonymous volumes, tmpfs, live processes, external services, global users/catalog/secrets, or platform-managed credentials. Import requires explicit recipient bindings for referenced model and secret IDs, remains stopped, and creates runtime network/certificates only on explicit start. V1 is Linux and protocol/layout-specific; a package is not a generic backup of its host.
