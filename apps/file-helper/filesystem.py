"""Safe fd-relative access to one already mounted Work workspace."""

import errno
import ctypes
import os
import secrets
import stat

from protocol import ProtocolError

MAX_SEGMENT_BYTES = 255
MAX_PATH_BYTES = 4096
MAX_PATH_DEPTH = 128
MAX_FILE_BYTES = 10 * 1024 ** 3
MAX_DIRECTORY_ENTRIES = 10000
MAX_TREE_ENTRIES = 10000
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC


def validate_segments(parts):
    if not isinstance(parts, list) or len(parts) > MAX_PATH_DEPTH:
        raise ProtocolError("FILE_PATH_INVALID")
    encoded = []
    for part in parts:
        if not isinstance(part, str) or part in ("", ".", "..") or "/" in part or "\\" in part:
            raise ProtocolError("FILE_PATH_INVALID")
        if any(not (codepoint in (9, 10, 13) or 0x20 <= codepoint <= 0xD7FF
                    or 0xE000 <= codepoint <= 0xFFFD or 0x10000 <= codepoint <= 0x10FFFF)
               for codepoint in map(ord, part)):
            raise ProtocolError("FILE_PATH_INVALID")
        try:
            raw = part.encode("utf-8", errors="strict")
        except UnicodeError as error:
            raise ProtocolError("FILE_PATH_INVALID") from error
        if len(raw) > MAX_SEGMENT_BYTES:
            raise ProtocolError("FILE_PATH_TOO_LONG")
        encoded.append(raw)
    if len(b"/".join(encoded)) > MAX_PATH_BYTES:
        raise ProtocolError("FILE_PATH_TOO_LONG")
    return parts


def _kind(mode):
    if stat.S_ISDIR(mode):
        return "directory"
    if stat.S_ISREG(mode):
        return "file"
    if stat.S_ISLNK(mode):
        return "symlink"
    return "unsupported"


def _metadata(parts, info):
    kind = _kind(info.st_mode)
    return {"pathSegments": list(parts), "kind": kind,
            "size": info.st_size if kind == "file" else None,
            "modifiedMs": max(0, info.st_mtime_ns // 1_000_000)}


def _file_error(error):
    if error.errno in (errno.ENOENT,):
        return ProtocolError("FILE_NOT_FOUND")
    if error.errno in (errno.EACCES, errno.EPERM):
        return ProtocolError("FILE_PERMISSION_DENIED")
    if error.errno in (errno.ELOOP, errno.ENOTDIR):
        return ProtocolError("FILE_TYPE_UNSUPPORTED")
    if error.errno == errno.EEXIST:
        return ProtocolError("FILE_PRECONDITION_FAILED")
    if error.errno == errno.ENOTEMPTY:
        return ProtocolError("FILE_CONFLICT")
    if error.errno in (errno.ENOSPC, errno.EDQUOT):
        return ProtocolError("FILE_STORAGE_FULL")
    return ProtocolError("FILE_RUNTIME_UNAVAILABLE")


def rename_no_replace(source_fd, source_name, dest_fd, dest_name):
    """Linux renameat2 keeps Overwrite:F moves atomic under direct service races."""
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "renameat2", None)
    if function is None:
        raise ProtocolError("FILE_RUNTIME_UNAVAILABLE")
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p,
                         ctypes.c_uint]
    function.restype = ctypes.c_int
    result = function(source_fd, os.fsencode(source_name), dest_fd, os.fsencode(dest_name), 1)
    if result != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


class Workspace:
    def __init__(self, root="/workspace"):
        try:
            self.root = os.open(root, DIRECTORY_FLAGS)
        except OSError as error:
            raise _file_error(error) from error

    def close(self):
        if self.root is not None:
            os.close(self.root)
            self.root = None

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()

    def open_directory(self, parts):
        validate_segments(parts)
        current = os.dup(self.root)
        try:
            for part in parts:
                next_fd = os.open(part, DIRECTORY_FLAGS, dir_fd=current)
                os.close(current)
                current = next_fd
            return current
        except OSError as error:
            os.close(current)
            raise _file_error(error) from error
        except BaseException:
            os.close(current)
            raise

    def open_parent(self, parts):
        validate_segments(parts)
        if not parts:
            raise ProtocolError("FILE_ROOT_PROTECTED")
        return self.open_directory(parts[:-1])

    def open_parent_for_create(self, parts):
        try:
            return self.open_parent(parts)
        except ProtocolError as error:
            if error.code == "FILE_NOT_FOUND":
                raise ProtocolError("FILE_CONFLICT") from error
            raise

    def verify_parent(self, held_fd, parent_parts):
        fresh = self.open_directory(parent_parts)
        try:
            held, current = os.fstat(held_fd), os.fstat(fresh)
            if (held.st_dev, held.st_ino) != (current.st_dev, current.st_ino):
                raise ProtocolError("FILE_CONFLICT")
        finally:
            os.close(fresh)

    def stat_entry(self, parts):
        validate_segments(parts)
        if not parts:
            return _metadata([], os.fstat(self.root))
        parent = self.open_parent(parts)
        try:
            self.verify_parent(parent, parts[:-1])
            info = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            return _metadata(parts, info)
        except OSError as error:
            raise _file_error(error) from error
        finally:
            os.close(parent)

    def stat_optional(self, parts):
        try:
            return self.stat_entry(parts)
        except ProtocolError as error:
            if error.code == "FILE_NOT_FOUND":
                return None
            raise

    def list_children(self, parts):
        validate_segments(parts)
        directory = self.open_directory(parts)
        try:
            self.verify_parent(directory, parts)
            names = os.listdir(directory)
            if len(names) > MAX_DIRECTORY_ENTRIES:
                raise ProtocolError("FILE_LIMIT_EXCEEDED")
            for name in names:
                try:
                    validate_segments([name])
                except ProtocolError as error:
                    raise ProtocolError("FILE_NAME_UNSUPPORTED") from error
            entries = []
            for name in sorted(names, key=lambda item: item.encode("utf-8")):
                try:
                    info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                except OSError as error:
                    raise _file_error(error) from error
                entries.append(_metadata(parts + [name], info))
            self.verify_parent(directory, parts)
            return entries
        finally:
            os.close(directory)

    def read_chunks(self, parts, start=0, end=None):
        validate_segments(parts)
        if not parts:
            raise ProtocolError("FILE_TYPE_UNSUPPORTED")
        parent = self.open_parent(parts)
        try:
            self.verify_parent(parent, parts[:-1])
            try:
                descriptor = os.open(parts[-1], FILE_FLAGS, dir_fd=parent)
            except OSError as error:
                raise _file_error(error) from error
            try:
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode):
                    raise ProtocolError("FILE_TYPE_UNSUPPORTED")
                if info.st_size > MAX_FILE_BYTES:
                    raise ProtocolError("FILE_LIMIT_EXCEEDED")
                self.verify_parent(parent, parts[:-1])
                if end is None:
                    end = info.st_size - 1
                if start < 0 or end < start or start >= info.st_size:
                    if info.st_size == 0 and start == 0 and end == -1:
                        return
                    raise ProtocolError("FILE_RANGE_UNSATISFIABLE")
                os.lseek(descriptor, start, os.SEEK_SET)
                remaining = end - start + 1
                while remaining:
                    chunk = os.read(descriptor, min(65536, remaining))
                    if not chunk:
                        raise ProtocolError("FILE_CONFLICT")
                    remaining -= len(chunk)
                    yield chunk
                after = os.fstat(descriptor)
                if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
                    raise ProtocolError("FILE_CONFLICT")
            finally:
                os.close(descriptor)
        finally:
            os.close(parent)

    def _target_info(self, parent, name):
        try:
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return None
        except OSError as error:
            raise _file_error(error) from error
        kind = _kind(info.st_mode)
        if kind == "directory":
            raise ProtocolError("FILE_METHOD_NOT_ALLOWED")
        if kind != "file":
            raise ProtocolError("FILE_TYPE_UNSUPPORTED")
        return info

    def _remove_owned_temporary(self, parent, name, identity):
        if identity is None:
            return
        try:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return
        except OSError as error:
            raise _file_error(error) from error
        if (current.st_dev, current.st_ino) != identity or not stat.S_ISREG(current.st_mode):
            raise ProtocolError("FILE_CLEANUP_REQUIRED")
        try:
            os.unlink(name, dir_fd=parent)
            os.fsync(parent)
        except OSError as error:
            raise _file_error(error) from error

    def publish_file(self, parts, chunks, session, mode=None, overwrite=True, check_condition=None,
                     commit=True, before_commit=None):
        """Stage complete bytes, await Core journal ACKs, then publish one directory entry."""
        validate_segments(parts)
        if not parts:
            raise ProtocolError("FILE_ROOT_PROTECTED")
        parent = self.open_parent_for_create(parts)
        temporary_name = None
        temporary_identity = None
        published = False
        try:
            self.verify_parent(parent, parts[:-1])
            original = self._target_info(parent, parts[-1])
            if original is not None and not overwrite:
                raise ProtocolError("FILE_PRECONDITION_FAILED")
            if check_condition is not None:
                check_condition(original)
            target_mode = mode if mode is not None else (stat.S_IMODE(original.st_mode) if original else 0o644)
            target_mode &= 0o777
            temporary_id = "filetemp-" + secrets.token_hex(16)
            temporary_name = ".piwork-file-" + session.job_id + "-" + secrets.token_hex(16) + ".tmp"
            if len(temporary_name.encode()) > MAX_SEGMENT_BYTES:
                raise ProtocolError("FILE_PATH_TOO_LONG")
            session.prepare("temporary", temporary_id, parts[:-1], temporary_name)
            try:
                descriptor = os.open(temporary_name,
                                     os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                                     0o600, dir_fd=parent)
            except OSError as error:
                raise _file_error(error) from error
            count = 0
            try:
                info = os.fstat(descriptor)
                temporary_identity = (info.st_dev, info.st_ino)
                session.prepare("temporary", temporary_id, parts[:-1], temporary_name,
                                str(info.st_dev), str(info.st_ino))
                for chunk in chunks:
                    count += len(chunk)
                    if count > MAX_FILE_BYTES:
                        raise ProtocolError("FILE_LIMIT_EXCEEDED")
                    view = memoryview(chunk)
                    while view:
                        try:
                            written = os.write(descriptor, view)
                        except OSError as error:
                            raise _file_error(error) from error
                        if written <= 0:
                            raise ProtocolError("FILE_STORAGE_FULL")
                        view = view[written:]
                os.fchmod(descriptor, target_mode)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            self.verify_parent(parent, parts[:-1])
            current = self._target_info(parent, parts[-1])
            if (original is None) != (current is None):
                raise ProtocolError("FILE_CONFLICT")
            if check_condition is not None:
                check_condition(current)
            if before_commit is not None:
                before_commit()
            if commit:
                session.prepare("commit")
            self.verify_parent(parent, parts[:-1])
            current = self._target_info(parent, parts[-1])
            if (original is None) != (current is None):
                raise ProtocolError("FILE_CONFLICT")
            if check_condition is not None:
                check_condition(current)
            if before_commit is not None:
                before_commit()
            existing_temp = os.stat(temporary_name, dir_fd=parent, follow_symlinks=False)
            if (existing_temp.st_dev, existing_temp.st_ino) != temporary_identity:
                raise ProtocolError("FILE_CLEANUP_REQUIRED")
            try:
                if current is None:
                    os.link(temporary_name, parts[-1], src_dir_fd=parent, dst_dir_fd=parent,
                            follow_symlinks=False)
                    os.unlink(temporary_name, dir_fd=parent)
                else:
                    os.replace(temporary_name, parts[-1], src_dir_fd=parent, dst_dir_fd=parent)
                published = True
                os.fsync(parent)
            except FileExistsError as error:
                raise ProtocolError("FILE_PRECONDITION_FAILED") from error
            except OSError as error:
                raise _file_error(error) from error
            return (204 if original else 201), count
        finally:
            try:
                if not published and temporary_name is not None:
                    self._remove_owned_temporary(parent, temporary_name, temporary_identity)
            finally:
                os.close(parent)

    def put_file(self, parts, session, check_condition=None):
        return self.publish_file(parts, session.upload_chunks(), session, check_condition=check_condition)

    def copy_file(self, source, destination, session, overwrite=True, check_condition=None,
                  commit=True, source_condition=None):
        validate_segments(source)
        validate_segments(destination)
        if source == destination or not source:
            raise ProtocolError("FILE_CONFLICT")
        parent = self.open_parent(source)
        try:
            info = self._target_info(parent, source[-1])
            if info is None:
                raise ProtocolError("FILE_NOT_FOUND")
            source_mode = stat.S_IMODE(info.st_mode)
        finally:
            os.close(parent)
        return self.publish_file(destination, self.read_chunks(source), session,
                                 mode=source_mode, overwrite=overwrite, check_condition=check_condition,
                                 commit=commit, before_commit=(lambda: source_condition(self.stat_optional(source)))
                                 if source_condition is not None else None)

    def preflight_tree(self, parts):
        """Reject unsupported entries and oversized trees before any user target changes."""
        validate_segments(parts)
        entries = 0
        logical_bytes = 0

        def walk(path):
            nonlocal entries, logical_bytes
            item = self.stat_entry(path)
            if item["kind"] not in ("file", "directory"):
                raise ProtocolError("FILE_TYPE_UNSUPPORTED")
            entries += 1
            if entries > MAX_TREE_ENTRIES:
                raise ProtocolError("FILE_LIMIT_EXCEEDED")
            if item["kind"] == "file":
                logical_bytes += item["size"]
                if logical_bytes > MAX_FILE_BYTES:
                    raise ProtocolError("FILE_LIMIT_EXCEEDED")
            else:
                for child in self.list_children(path):
                    walk(child["pathSegments"])

        walk(parts)
        return {"entries": entries, "bytes": logical_bytes}

    def _mkdir(self, parts):
        parent = self.open_parent_for_create(parts)
        try:
            self.verify_parent(parent, parts[:-1])
            os.mkdir(parts[-1], 0o755, dir_fd=parent)
            os.fsync(parent)
        except FileExistsError as error:
            raise ProtocolError("FILE_METHOD_NOT_ALLOWED") from error
        except OSError as error:
            raise _file_error(error) from error
        finally:
            os.close(parent)

    def mkcol(self, parts, session, check_condition=None):
        validate_segments(parts)
        if not parts:
            raise ProtocolError("FILE_ROOT_PROTECTED")
        parent = self.open_parent_for_create(parts)
        try:
            self.verify_parent(parent, parts[:-1])
            try:
                os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise ProtocolError("FILE_METHOD_NOT_ALLOWED")
        finally:
            os.close(parent)
        if check_condition is not None:
            check_condition(None)
        session.prepare("commit")
        if check_condition is not None:
            check_condition(self.stat_optional(parts))
        self._mkdir(parts)
        return 201

    def _delete_recursive(self, parts, failures):
        try:
            item = self.stat_entry(parts)
            if item["kind"] not in ("file", "directory"):
                raise ProtocolError("FILE_TYPE_UNSUPPORTED")
            if item["kind"] == "directory":
                prior_failures = len(failures)
                for child in self.list_children(parts):
                    self._delete_recursive(child["pathSegments"], failures)
                if len(failures) != prior_failures:
                    return
            parent = self.open_parent(parts)
            try:
                self.verify_parent(parent, parts[:-1])
                if item["kind"] == "directory":
                    os.rmdir(parts[-1], dir_fd=parent)
                else:
                    os.unlink(parts[-1], dir_fd=parent)
                os.fsync(parent)
            finally:
                os.close(parent)
        except ProtocolError as error:
            failures.append({"pathSegments": list(parts), "code": error.code})
        except OSError as error:
            failures.append({"pathSegments": list(parts), "code": _file_error(error).code})

    def delete(self, parts, session, depth="infinity", check_condition=None):
        validate_segments(parts)
        if depth != "infinity":
            raise ProtocolError("FILE_REQUEST_INVALID")
        if not parts:
            raise ProtocolError("FILE_ROOT_PROTECTED")
        self.preflight_tree(parts)
        if check_condition is not None:
            check_condition(self.stat_entry(parts))
        session.prepare("commit")
        if check_condition is not None:
            check_condition(self.stat_optional(parts))
        failures = []
        self._delete_recursive(parts, failures)
        return (207 if failures else 204), failures

    @staticmethod
    def _check_destination_relation(source, destination):
        validate_segments(source)
        validate_segments(destination)
        if not source or not destination:
            raise ProtocolError("FILE_ROOT_PROTECTED")
        if source == destination or source == destination[:len(source)] or destination == source[:len(destination)]:
            raise ProtocolError("FILE_CONFLICT")

    def _existing_destination(self, destination, overwrite):
        try:
            item = self.stat_entry(destination)
        except ProtocolError as error:
            if error.code == "FILE_NOT_FOUND":
                return None
            raise
        if item["kind"] not in ("file", "directory"):
            raise ProtocolError("FILE_TYPE_UNSUPPORTED")
        if not overwrite:
            raise ProtocolError("FILE_PRECONDITION_FAILED")
        self.preflight_tree(destination)
        return item

    def _copy_recursive(self, source, destination, session, depth, failures):
        try:
            item = self.stat_entry(source)
            if item["kind"] == "file":
                self.copy_file(source, destination, session, commit=False)
                return
            if item["kind"] != "directory":
                raise ProtocolError("FILE_TYPE_UNSUPPORTED")
            self._mkdir(destination)
            if depth == 0:
                return
            for child in self.list_children(source):
                self._copy_recursive(child["pathSegments"], destination + [child["pathSegments"][-1]],
                                     session, depth, failures)
        except ProtocolError as error:
            failures.append({"pathSegments": list(destination), "code": error.code})
        except OSError as error:
            failures.append({"pathSegments": list(destination), "code": _file_error(error).code})

    def copy(self, source, destination, session, overwrite=True, depth="infinity", check_condition=None):
        self._check_destination_relation(source, destination)
        if depth not in (0, "infinity"):
            raise ProtocolError("FILE_REQUEST_INVALID")
        source_item = self.stat_entry(source)
        if check_condition is not None:
            check_condition(source_item)
        self.preflight_tree(source)
        existing = self._existing_destination(destination, overwrite)
        parent = self.open_parent_for_create(destination)
        os.close(parent)
        if source_item["kind"] == "file":
            if check_condition is not None:
                check_condition(self.stat_optional(source))
            status, _ = self.copy_file(source, destination, session, overwrite=overwrite,
                                       source_condition=check_condition)
            return status, []
        session.prepare("commit")
        if check_condition is not None:
            check_condition(self.stat_optional(source))
        failures = []
        if existing is not None:
            self._delete_recursive(destination, failures)
            if failures:
                return 207, failures
        self._copy_recursive(source, destination, session, depth, failures)
        return (207 if failures else (204 if existing else 201)), failures

    def move(self, source, destination, session, overwrite=True, depth="infinity", check_condition=None):
        if depth != "infinity":
            raise ProtocolError("FILE_REQUEST_INVALID")
        self._check_destination_relation(source, destination)
        self.preflight_tree(source)
        if check_condition is not None:
            check_condition(self.stat_entry(source))
        existing = self._existing_destination(destination, overwrite)
        parent = self.open_parent_for_create(destination)
        os.close(parent)
        session.prepare("commit")
        if check_condition is not None:
            check_condition(self.stat_optional(source))
        failures = []
        removed_existing = False
        if existing is not None:
            self._delete_recursive(destination, failures)
            if failures:
                return 207, failures
            removed_existing = True
        source_parent = None
        dest_parent = None
        try:
            source_parent = self.open_parent(source)
            dest_parent = self.open_parent_for_create(destination)
            self.verify_parent(source_parent, source[:-1])
            self.verify_parent(dest_parent, destination[:-1])
            current = os.stat(source[-1], dir_fd=source_parent, follow_symlinks=False)
            if _kind(current.st_mode) not in ("file", "directory"):
                raise ProtocolError("FILE_TYPE_UNSUPPORTED")
            if overwrite:
                os.rename(source[-1], destination[-1], src_dir_fd=source_parent, dst_dir_fd=dest_parent)
            else:
                rename_no_replace(source_parent, source[-1], dest_parent, destination[-1])
            os.fsync(source_parent)
            os.fsync(dest_parent)
        except (OSError, ProtocolError) as error:
            mapped = _file_error(error) if isinstance(error, OSError) else error
            if removed_existing:
                return 207, [{"pathSegments": list(destination), "code": mapped.code}]
            raise mapped from error
        finally:
            if source_parent is not None:
                os.close(source_parent)
            if dest_parent is not None:
                os.close(dest_parent)
        return (204 if existing else 201), failures

    def cleanup_temporaries(self, items):
        count = 0
        for item in items:
            parts = item["parentSegments"]
            name = item["name"]
            validate_segments(parts + [name])
            parent = self.open_directory(parts)
            try:
                self.verify_parent(parent, parts)
                try:
                    current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if (str(current.st_dev), str(current.st_ino)) != (item["device"], item["inode"]) \
                        or not stat.S_ISREG(current.st_mode):
                    raise ProtocolError("FILE_CLEANUP_REQUIRED")
                os.unlink(name, dir_fd=parent)
                os.fsync(parent)
                count += 1
            except OSError as error:
                raise _file_error(error) from error
            finally:
                os.close(parent)
        return count
