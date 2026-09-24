"""Trusted byte-path volume copier. Never loads or executes code from a Work."""
import base64
import hashlib
import json
import os
import re
import stat
import sys
import uuid

MAX_BYTES = 100 * 1024 ** 3
MAX_METADATA = 64 * 1024 ** 2
MAX_ENTRIES = 1000000
CHUNK = 1024 ** 2
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


class SnapshotError(Exception):
    def __init__(self, code):
        self.code = code


def fail(code="SNAPSHOT_STORAGE_UNSUPPORTED"):
    raise SnapshotError(code)


def b64(value):
    return base64.b64encode(value).decode("ascii")


def unb64(value):
    try:
        result = base64.b64decode(value, validate=True)
        if b64(result) != value:
            fail("PACKAGE_INVALID")
        return result
    except (ValueError, TypeError):
        fail("PACKAGE_INVALID")


def segments(values):
    if not isinstance(values, list) or len(values) > 128:
        fail("PACKAGE_INVALID")
    parts = [unb64(value) for value in values]
    if any(not part or b"/" in part or b"\0" in part or part in (b".", b"..") for part in parts):
        fail("PACKAGE_INVALID")
    if len(b"/".join(parts)) > 4096:
        fail("PACKAGE_LIMIT_EXCEEDED")
    return parts


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_size, info.st_nlink, info.st_mtime_ns, info.st_ctime_ns)


def metadata(info, parts, kind):
    return dict(type=kind, segmentsBase64=[b64(part) for part in parts], uid=info.st_uid,
                gid=info.st_gid, mode=stat.S_IMODE(info.st_mode), mtimeNs=str(info.st_mtime_ns))


def write_all(fd, data):
    view = memoryview(data)
    while view:
        count = os.write(fd, view)
        if count <= 0:
            fail("SNAPSHOT_STORAGE_UNREADABLE")
        view = view[count:]


def no_xattrs(path):
    if os.listxattr(path, **({} if isinstance(path, int) else {"follow_symlinks": False})):
        fail()


def spool_blob(spool, chunks):
    temporary = ("partial-" + uuid.uuid4().hex).encode()
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=spool)
    digest = hashlib.sha256()
    size = 0
    try:
        for chunk in chunks:
            size += len(chunk)
            if size > MAX_BYTES:
                fail("PACKAGE_LIMIT_EXCEEDED")
            digest.update(chunk)
            write_all(fd, chunk)
        # The helper runs as root for volume metadata, but Core owns its private spool.
        # Keep sealed blobs 0600 and readable by that Core account, not by other users.
        owner = os.fstat(spool)
        os.fchown(fd, owner.st_uid, owner.st_gid)
        os.fsync(fd)
    finally:
        os.close(fd)
    name = digest.hexdigest().encode()
    try:
        os.link(temporary, name, src_dir_fd=spool, dst_dir_fd=spool, follow_symlinks=False)
    except FileExistsError:
        existing = os.open(name, FILE, dir_fd=spool)
        try:
            if not stat.S_ISREG(os.fstat(existing).st_mode):
                fail("PACKAGE_INVALID")
            check = hashlib.sha256()
            while chunk := os.read(existing, CHUNK):
                check.update(chunk)
            if check.digest() != digest.digest():
                fail("PACKAGE_INVALID")
        finally:
            os.close(existing)
    os.unlink(temporary, dir_fd=spool)
    os.fsync(spool)
    return name.decode(), size


def capture(root, spool):
    entries = []
    inodes = {}
    logical_bytes = 0

    def add(entry):
        entries.append(entry)
        if len(entries) > MAX_ENTRIES:
            fail("PACKAGE_LIMIT_EXCEEDED")

    def walk(fd, parts):
        nonlocal logical_bytes
        before = os.fstat(fd)
        no_xattrs(fd)
        add(metadata(before, parts, "directory"))
        for name in sorted(os.fsencode(name) for name in os.listdir(fd)):
            path = parts + [name]
            if len(path) > 128 or len(b"/".join(path)) > 4096:
                fail("PACKAGE_LIMIT_EXCEEDED")
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            no_xattrs(b"/proc/self/fd/" + str(fd).encode() + b"/" + name)
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, DIRECTORY, dir_fd=fd)
                try:
                    if identity(info) != identity(os.fstat(child)):
                        fail("SNAPSHOT_STORAGE_UNREADABLE")
                    walk(child, path)
                finally:
                    os.close(child)
            elif stat.S_ISLNK(info.st_mode):
                target = os.readlink(name, dir_fd=fd)
                if len(target) > 4096:
                    fail("PACKAGE_LIMIT_EXCEEDED")
                add(dict(metadata(info, path, "symlink"), targetBase64=b64(target)))
            elif stat.S_ISREG(info.st_mode):
                inode = (info.st_dev, info.st_ino)
                if inode in inodes:
                    prior_path, prior_identity = inodes[inode]
                    if identity(info) != prior_identity:
                        fail("SNAPSHOT_STORAGE_UNREADABLE")
                    add(dict(metadata(info, path, "hardlink"), targetSegmentsBase64=[b64(part) for part in prior_path]))
                else:
                    source = os.open(name, FILE, dir_fd=fd)
                    try:
                        if identity(info) != identity(os.fstat(source)):
                            fail("SNAPSHOT_STORAGE_UNREADABLE")
                        def chunks():
                            while chunk := os.read(source, CHUNK):
                                yield chunk
                        digest, size = spool_blob(spool, chunks())
                        if size != info.st_size or identity(info) != identity(os.fstat(source)):
                            fail("SNAPSHOT_STORAGE_UNREADABLE")
                    finally:
                        os.close(source)
                    logical_bytes += size
                    if logical_bytes > MAX_BYTES:
                        fail("PACKAGE_LIMIT_EXCEEDED")
                    inodes[inode] = (path, identity(info))
                    add(dict(metadata(info, path, "file"), blob=digest, size=size))
            else:
                fail()
            if identity(info) != identity(os.stat(name, dir_fd=fd, follow_symlinks=False)):
                fail("SNAPSHOT_STORAGE_UNREADABLE")
        if identity(before) != identity(os.fstat(fd)):
            fail("SNAPSHOT_STORAGE_UNREADABLE")

    walk(root, [])
    entries.sort(key=lambda entry: b"/".join(segments(entry["segmentsBase64"])))
    encoded = json.dumps(dict(version=1, entries=entries), sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > MAX_METADATA:
        fail("PACKAGE_LIMIT_EXCEEDED")
    digest, size = spool_blob(spool, [encoded])
    return dict(tree=digest, size=size, entries=len(entries), logicalBytes=logical_bytes)


def read_blob(spool, digest):
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        fail("PACKAGE_INVALID")
    fd = os.open(digest.encode(), FILE, dir_fd=spool)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        fail("PACKAGE_INVALID")
    return fd


def parent_fd(root, parts):
    fd = os.dup(root)
    try:
        for part in parts[:-1]:
            child = os.open(part, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def restore(root, spool, digest):
    tree_fd = read_blob(spool, digest)
    try:
        data = b""
        while chunk := os.read(tree_fd, CHUNK):
            data += chunk
            if len(data) > MAX_METADATA:
                fail("PACKAGE_LIMIT_EXCEEDED")
    finally:
        os.close(tree_fd)
    if hashlib.sha256(data).hexdigest() != digest:
        fail("PACKAGE_INVALID")
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail("PACKAGE_INVALID")
            result[key] = value
        return result
    tree = json.loads(data, object_pairs_hook=unique_object)
    if set(tree) != {"version", "entries"} or tree["version"] != 1 or not isinstance(tree["entries"], list):
        fail("PACKAGE_INVALID")
    entries = tree["entries"]
    if not entries or len(entries) > MAX_ENTRIES or os.listdir(root):
        fail("PACKAGE_INVALID")
    paths = {}
    previous = None
    logical_bytes = 0
    for entry in entries:
        parts = segments(entry["segmentsBase64"])
        path = b"/".join(parts)
        kind = entry["type"]
        fields = {"type", "segmentsBase64", "uid", "gid", "mode", "mtimeNs"}
        fields |= {"file": {"blob", "size"}, "symlink": {"targetBase64"}, "hardlink": {"targetSegmentsBase64"}, "directory": set()}.get(kind, {"invalid"})
        if set(entry) != fields or (previous is not None and previous >= path):
            fail("PACKAGE_INVALID")
        if previous is None and (parts or kind != "directory"):
            fail("PACKAGE_INVALID")
        if parts and paths.get(b"/".join(parts[:-1]), {}).get("type") != "directory":
            fail("PACKAGE_INVALID")
        if any(type(entry[key]) is not int or not 0 <= entry[key] <= maximum for key, maximum in (("uid", 4294967295), ("gid", 4294967295), ("mode", 4095))):
            fail("PACKAGE_INVALID")
        if not isinstance(entry["mtimeNs"], str) or not re.fullmatch(r"-?(0|[1-9][0-9]{0,30})", entry["mtimeNs"]):
            fail("PACKAGE_INVALID")
        if kind == "file":
            if type(entry["size"]) is not int or not 0 <= entry["size"] <= MAX_BYTES:
                fail("PACKAGE_INVALID")
            logical_bytes += entry["size"]
        elif kind == "symlink":
            target = unb64(entry["targetBase64"])
            if not target or b"\0" in target or len(target) > 4096:
                fail("PACKAGE_INVALID")
        if logical_bytes > MAX_BYTES:
            fail("PACKAGE_LIMIT_EXCEEDED")
        paths[path] = entry
        previous = path
    for entry in entries:
        if entry["type"] == "hardlink":
            target = paths.get(b"/".join(segments(entry["targetSegmentsBase64"])))
            if target is None or target["type"] != "file" or any(entry[key] != target[key] for key in ("uid", "gid", "mode", "mtimeNs")):
                fail("PACKAGE_INVALID")
    # No links exist during directory/file creation. All traversal is dirfd + NOFOLLOW.
    for entry in entries[1:]:
        parts = segments(entry["segmentsBase64"])
        fd = parent_fd(root, parts)
        try:
            if entry["type"] == "directory":
                os.mkdir(parts[-1], 0o700, dir_fd=fd)
            elif entry["type"] == "file":
                source = read_blob(spool, entry["blob"])
                target = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                try:
                    check = hashlib.sha256()
                    size = 0
                    while chunk := os.read(source, CHUNK):
                        size += len(chunk)
                        if size > entry["size"]:
                            fail("PACKAGE_INVALID")
                        check.update(chunk)
                        write_all(target, chunk)
                    if size != entry["size"] or check.hexdigest() != entry["blob"]:
                        fail("PACKAGE_INVALID")
                    os.fsync(target)
                finally:
                    os.close(source)
                    os.close(target)
        finally:
            os.close(fd)
    for kind in ("hardlink", "symlink"):
        for entry in entries:
            if entry["type"] != kind:
                continue
            parts = segments(entry["segmentsBase64"])
            fd = parent_fd(root, parts)
            try:
                if kind == "hardlink":
                    source_parts = segments(entry["targetSegmentsBase64"])
                    source_fd = parent_fd(root, source_parts)
                    try:
                        os.link(source_parts[-1], parts[-1], src_dir_fd=source_fd, dst_dir_fd=fd, follow_symlinks=False)
                    finally:
                        os.close(source_fd)
                else:
                    os.symlink(unb64(entry["targetBase64"]), parts[-1], dir_fd=fd)
            finally:
                os.close(fd)
    for entry in reversed(entries):
        if entry["type"] == "hardlink":
            continue
        parts = segments(entry["segmentsBase64"])
        fd = parent_fd(root, parts)
        name = parts[-1] if parts else b"."
        try:
            os.chown(name, entry["uid"], entry["gid"], dir_fd=fd, follow_symlinks=False)
            if entry["type"] != "symlink":
                os.chmod(name, entry["mode"], dir_fd=fd, follow_symlinks=False)
            ns = int(entry["mtimeNs"])
            os.utime(name, ns=(ns, ns), dir_fd=fd, follow_symlinks=False)
            observed = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if observed.st_uid != entry["uid"] or observed.st_gid != entry["gid"] or observed.st_mtime_ns != ns or (entry["type"] != "symlink" and stat.S_IMODE(observed.st_mode) != entry["mode"]):
                fail("SNAPSHOT_STORAGE_UNSUPPORTED")
            if entry["type"] != "symlink":
                target = os.open(name, FILE, dir_fd=fd)
                try:
                    os.fsync(target)
                finally:
                    os.close(target)
        finally:
            os.close(fd)
    os.fsync(root)
    return dict(tree=digest, entries=len(entries), logicalBytes=logical_bytes)


def main():
    if len(sys.argv) not in (4, 5):
        fail("SNAPSHOT_HELPER_ARGUMENT")
    action, root_path, spool_path = sys.argv[1:4]
    root = os.open(os.fsencode(root_path), DIRECTORY)
    spool = os.open(os.fsencode(spool_path), DIRECTORY)
    try:
        if action == "capture" and len(sys.argv) == 4:
            result = capture(root, spool)
        elif action in ("restore", "restore-context") and len(sys.argv) == 5:
            result = restore(root, spool, sys.argv[4])
            if action == "restore-context":
                owner = os.fstat(spool)
                for directory, dirs, files, fd in os.fwalk(root_path, topdown=False, follow_symlinks=False):
                    for name in files + dirs:
                        os.chown(name, owner.st_uid, owner.st_gid, dir_fd=fd, follow_symlinks=False)
                os.fchown(root, owner.st_uid, owner.st_gid)
        else:
            fail("SNAPSHOT_HELPER_ARGUMENT")
        print(json.dumps(result, separators=(",", ":")))
    finally:
        os.close(root)
        os.close(spool)


if __name__ == "__main__":
    try:
        main()
    except (SnapshotError, OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError) as error:
        code = error.code if isinstance(error, SnapshotError) else "SNAPSHOT_STORAGE_UNREADABLE"
        print(json.dumps(dict(code=code)), file=sys.stderr)
        sys.exit(1)
