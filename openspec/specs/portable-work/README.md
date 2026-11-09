# Work Specification

**English** | [简体中文](README.zh-CN.md)

Work joins an Agent harness, Services and a persistent workspace. A **manifest** (the versioned Work Spec value) describes one complete cold snapshot. A **Work Package** is the manifest plus all referenced bytes in a `.work` file. An imported **Work Instance** has independent recipient ownership and mutable storage.

This page describes V1 and the V2 format implemented in this source tree. V2 has not yet been released. Current behavior requirements, including V2, are defined in [portable-work](spec.md) and [work-snapshots](../work-snapshots/spec.md). Design and verification records are preserved in the archived [compress-work-packages](../../changes/archive/2026-11-09-compress-work-packages/) change.

## Manifest and relationships


| Field | Meaning |
| --- | --- |
| `formatVersion`, `snapshotKind` | Package encoding version (1/2), always `cold-full` |
| `createdAt`, `sourceName` | Snapshot generation time and source name |
| `compatibility` | Linux platform, agent protocol, history schema, storage layout and Pi package contract |
| `contexts`, `activeContext`, `desiredContext` | Retained execution configurations; active may be null |
| `piPackageArtifacts` | Complete prepared package trees and dependencies, keyed by content |
| `services` | Service definitions, revisions, heads and retained tombstones |
| `quotaReservations` | Captured persistent agent/service reservations |
| `volumes` | Exactly agent-private and workspace trees and their logical references |
| `images` | Fixed image configs and original layer digests, including offline bytes |
| `bindings` | Nonsecret model requirements and external MCP secret dependencies |
| `history` | Control history and declared source identity map blob references |
| `blobs` | Digest-sorted unique content and its storage representation |

Read the complete strict [V1 schema](../../../internal/workpackage/schema/manifest-v1.schema.json) or [V2 schema](../../../internal/workpackage/schema/manifest-v2.schema.json) for nested fields, enums and required keys. References use logical keys or original content SHA-256, never recipient authority. Every reference must resolve; unknown fields, duplicate keys, unsafe integers, missing data and unreferenced blob kinds are rejected. Empty collections are explicit. `kinds` can merge multiple uses of the same original bytes.

## Byte layout

```text
8 bytes magic | uint64 big-endian manifest length | UTF-8 JSON | ordered blobs
```

The magic is ASCII `PIWORK1` plus LF for V1, or `PIWORK2` plus LF for V2 (eight bytes). JSON is uncompressed; there are no per-blob headers, offsets or trailing bytes. Blob order follows the manifest's ascending digest order. The first blob starts at byte `16 + manifestLength`.

V1 blobs have exactly `digest`, `size`, `kinds` and store raw content. V2 blobs require two additional fields:

```json
{"digest":"<64 lowercase SHA-256 hex digits>","size":1000000,"kinds":["file"],"encoding":"zstd","storedSize":280000}
```

This fragment illustrates fields; it is not a complete valid package. `size` and `digest` always describe original decoded bytes. `storedSize` describes bytes in the package. `raw` requires both sizes equal; empty content uses raw and zero sizes. Each successful compression is retained only when smaller than the source. Encoding errors fail export.

A `zstd` item is exactly one ordinary [Zstandard frame](https://www.rfc-editor.org/rfc/rfc8878.html), with no dictionary, skippable frame, concatenated frame or trailing bytes. Maximum decode window is 8 MiB, including single-segment semantics. Optional declared content size must match `size`; optional checksums are verified. Readers enforce the output length while decoding and verify the original SHA-256. Different encoders may produce different physical package bytes for the same original content.

The next offset adds `storedSize` (V1: `size`). Physical package length is `16 + manifestLength + sum(storedSize)`. The physical package SHA-256 covers all bytes, including the header and encoded bodies. Image config identities and layer diff_ids continue to use original content digests. Compression level is an internal balanced policy, not a manifest field or setting.

## Trees, history and completeness

A tree blob lists entries and original file blob digests. POSIX byte paths are encoded as base64 segments. Files, empty directories, permissions, uid/gid, nanosecond mtime, symlink targets and within-tree hardlinks follow [storage rules](../work-storage/spec.md#requirement-preserve-complete-cold-snapshot-storage-without-dereferencing-user-links). Links are saved as data and never followed during capture/restore. Unsupported special entries or metadata fail the whole snapshot; `security.selinux` belongs to the target host policy.

All retained contexts, prepared packages, fixed images, configuration revisions, user files, caches, dependencies, business data, sessions and retained history remain included. Control-history payload strings are opaque historical text; managed identity fields follow the declared map. Private history must satisfy the exact supported [history schemas](../../../internal/workhistory/) and [Memory rules](../work-memory/spec.md); imported historical requests do not regain execution authority. [Synthetic V1 packages and cases](../../../internal/workpackage/testdata/) provide complete examples; V2 tests exercise mixed encodings and standard Zstd interoperability.

### Exact tree JSON

Tree blobs use the same structure in V1 and V2. The top-level object has exactly `version` (integer `1`) and `entries` (a nonempty array). Unknown, missing or duplicate fields are rejected. Every entry has all six common fields:

| Field | Type and constraints |
| --- | --- |
| `segmentsBase64` | Array of canonical standard Base64 strings, one per raw POSIX path segment; `[]` denotes the tree root. |
| `uid`, `gid` | Integers from 0 through 4294967295. |
| `mode` | Integer from 0 through 4095 (`07777` octal): permission and special bits only, without file-type bits. |
| `mtimeNs` | Unix epoch nanoseconds as a **JSON string**, at most 32 characters matching `^-?(?:0|[1-9][0-9]*)$`; restoration also requires a timestamp representable by the target filesystem. |
| `type` | Exactly `directory`, `file`, `symlink` or `hardlink`. |

In addition to those six fields, the following exact variants apply; fields from other variants are not allowed:

| `type` | Additional required fields |
| --- | --- |
| `directory` | None. |
| `file` | `blob`: original file SHA-256 referencing a manifest blob whose kinds include `file`; `size`: nonnegative safe integer equal to that blob's original `size`, including explicit zero. |
| `symlink` | `targetBase64`: canonical standard Base64 of the complete original link-target bytes, not an array of segments. The decoded target is nonempty, has no NUL and is at most 4096 bytes; absolute and dangling targets are preserved as data. |
| `hardlink` | `targetSegmentsBase64`: a path-segment array using the same encoding as `segmentsBase64`; it must name a `file` entry in this same tree, including a later entry, and have identical uid/gid/mode/mtimeNs. It cannot target another hardlink, symlink, directory or tree. |

Decode Base64 with the standard alphabet and canonical padding, not URL-safe Base64. A path segment may contain arbitrary non-UTF-8 bytes, but cannot be empty, contain NUL or `/`, or equal `.` or `..`. Join decoded segments with byte `/`; the path is at most 4096 bytes and 128 segments. Sort entries strictly by the **decoded joined path bytes**, using unsigned byte order, not the Base64 text. Paths are unique. The first entry is the root directory (`[]`); every non-root parent must already be a directory entry. File contents are referenced, not embedded in this JSON; hardlinks add no separate file bytes.

These are the general tree rules; prepared Pi Package trees also obey the existing [package compatibility rules](../online-pi-package-compatibility/spec.md), including their stricter dependency and link constraints. A valid generic tree alone does not prove a valid prepared package.

This complete tree example contains the root, an empty `a.txt`, its hardlink `b.txt`, and a symlink `link` pointing to `a.txt`. The manifest must separately declare the empty file blob with the SHA-256 below, original size 0 and kind `file`. Hash the tree's own UTF-8 JSON bytes as a separate blob of kind `tree`.

```json
{
  "version": 1,
  "entries": [
    {
      "segmentsBase64": [],
      "uid": 10001,
      "gid": 10001,
      "mode": 493,
      "mtimeNs": "0",
      "type": "directory"
    },
    {
      "segmentsBase64": [
        "YS50eHQ="
      ],
      "uid": 10001,
      "gid": 10001,
      "mode": 420,
      "mtimeNs": "0",
      "type": "file",
      "blob": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size": 0
    },
    {
      "segmentsBase64": [
        "Yi50eHQ="
      ],
      "uid": 10001,
      "gid": 10001,
      "mode": 420,
      "mtimeNs": "0",
      "type": "hardlink",
      "targetSegmentsBase64": [
        "YS50eHQ="
      ]
    },
    {
      "segmentsBase64": [
        "bGluaw=="
      ],
      "uid": 10001,
      "gid": 10001,
      "mode": 511,
      "mtimeNs": "0",
      "type": "symlink",
      "targetBase64": "YS50eHQ="
    }
  ]
}
```

The other structured history blobs use the existing named definitions `WorkControlHistorySchema` and `WorkSourceIdentityMapSchema` in the [native schema catalog](../../../internal/contracts/schemas.json). `history.control` references the former; `history.sourceIdentityMap` references the latter. Their context/service/operation maps must match the manifest's complete logical keys and source scopes; ordinary archived payload strings remain opaque, while managed identity fields are remapped. These definitions are shared with V1 and are not a new V2 data model.

## Limits and validation

Physical package bytes, decoded package bytes (`16 + manifestLength + sum(size)`) and logical restore bytes are each bounded at 100 GiB. Logical restore counts repeated file references across trees and unique image layers; within-tree hardlinks count once. Each metadata JSON and the manifest are at most 64 MiB; cumulative metadata is at most 256 MiB. Limits include 1,000,000 file entries, 4096 path bytes and depth 128. All length arithmetic is checked. Compression does not bypass raw metadata or restore limits.

Validate framing/version agreement, exact schemas, all storage boundaries, original hashes and complete reference closure before publication. Invalid bytes/structure return `PACKAGE_INVALID`, unsupported versions/encodings `PACKAGE_FORMAT_UNSUPPORTED`, and resource excess `PACKAGE_LIMIT_EXCEEDED`. Offline inspect is side-effect-free: integrity is verified, installation compatibility is not. The target additionally checks static history semantics, models, platform, permissions and quota; neither inspection nor import executes package code.

## Moving and compatibility

Export requires a verified stopped Work. Import publishes a new stopped Work; explicit Start establishes new runtime identities. Active/desired differences are preserved. Registry access or dependency reinstallation is not required to restore captured content; matching target models and external services remain external requirements. Platform credentials are excluded, while user secrets stored in files/history are included unchanged.

New readers accept strict V1 and V2, and new exports use V2. Old software cannot read V2. Existing V1 files and ready snapshot downloads are never rewritten; retries use the original package bytes/hash. Same content does not imply the same package digest across encodings. Compression reduces the transfer file; installed content size and application behavior follow the original contract.

[V2 synthetic package / V2 合成包](../../../internal/workpackage/testdata/golden-v2.work) · [V2 boundary and interoperability cases / V2 边界与互操作用例](../../../internal/workpackage/compression_test.go)
