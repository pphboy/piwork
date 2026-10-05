#!/usr/bin/env python3
"""Development-only verification against real, isolated Docker volumes."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=120).stdout


def inspect(kind, name):
    return json.loads(command("docker", kind, "inspect", name))[0]


def label(path):
    return os.getxattr(path, "security.selinux", follow_symlinks=False).decode().rstrip("\0")


def set_label(path, level):
    value = "system_u:object_r:container_file_t:" + level
    os.setxattr(path, "security.selinux", (value + "\0").encode(), follow_symlinks=False)


def portable_metadata(path):
    info = os.lstat(path)
    return [info.st_uid, info.st_gid, info.st_mode, info.st_mtime_ns]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper-image", required=True)
    parser.add_argument("--evidence", required=True)
    options = parser.parse_args()
    assert command("getenforce").strip() == "Enforcing", "SELinux Enforcing required"
    image = inspect("image", options.helper_image)
    assert image["Config"]["Labels"]["piwork.snapshot_protocol"] == "1"
    image_id = image["Id"]
    scope = "piwork-test-" + str(uuid.uuid4())
    volumes, containers = [], []
    report = {"installationId": scope, "helperImageId": image_id, "selinux": "Enforcing", "volumeLabelPolicy": "Docker normal shared s0", "checks": []}

    def owned(kind, name):
        item = inspect(kind, name)
        labels = item.get("Labels") if kind == "volume" else item["Config"]["Labels"]
        assert labels.get("piwork.installation_id") == scope, "resource identity mismatch"
        return item

    def volume(suffix, level="s0"):
        name = scope + "-" + suffix
        command("docker", "volume", "create", "--driver", "local", "--label", "piwork.installation_id=" + scope, name)
        volumes.append(name)
        root = Path(owned("volume", name)["Mountpoint"])
        set_label(root, level)
        return name, root

    def helper(name, root, args, read_only=False, expected_code=None):
        container = scope + "-helper-" + str(len(report["checks"])) + "-" + uuid.uuid4().hex[:6]
        mount = "type=volume,source=" + name + ",target=/snapshot/volume,volume-nocopy"
        if read_only:
            mount += ",readonly"
        command("docker", "create", "--name", container, "--label", "piwork.installation_id=" + scope,
                "--network", "none", "--read-only", "--security-opt", "no-new-privileges",
                "--pids-limit", "64", "--memory", "512m",
                "--cpus", "1", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE",
                "--cap-add", "DAC_READ_SEARCH", "--cap-add", "FOWNER",
                "--mount", mount, "--mount", "type=volume,source=" + spool_name + ",target=/snapshot/spool,volume-nocopy",
                image_id, *args)
        containers.append(container)
        before = label(root)
        started = subprocess.run(["docker", "start", "-a", container], capture_output=True, text=True, timeout=120)
        item = owned("container", container)
        assert item["State"]["Status"] == "exited", started.stderr
        output = subprocess.run(["docker", "logs", container], check=True, capture_output=True, text=True, timeout=120)
        logs = output.stdout + output.stderr
        assert label(root) == before, "normal shared-s0 volume label changed"
        if expected_code:
            assert item["State"]["ExitCode"] == 1
            assert json.loads(logs)["code"] == expected_code, logs
            result = {"code": expected_code}
        else:
            assert item["State"]["ExitCode"] == 0, logs
            result = json.loads(logs)
        command("docker", "rm", container)
        containers.remove(container)
        return result

    try:
        spool_name, spool = volume("spool")
        source_name, source = volume("source")
        target_name, target = volume("target")
        control_name, control = volume("control")
        paths = ["", "empty", "directory", "directory/file", "alias", "external-link", "relative-link"]
        for root in [source, control]:
            (root / "empty").mkdir(mode=0o750)
            (root / "directory").mkdir(mode=0o750)
            (root / "directory/file").write_bytes(b"portable test bytes\0\xff")
            os.chmod(root / "directory/file", 0o751)
            os.chown(root / "directory/file", 10001, 10001)
            os.link(root / "directory/file", root / "alias")
            os.symlink("/outside/never-read", root / "external-link")
            os.symlink("directory/file", root / "relative-link")
        for relative in paths:
            set_label(source / relative, "s0")
            set_label(control / relative, "s0")
            stamp = 1727049600123456789
            os.utime(source / relative, ns=(stamp, stamp), follow_symlinks=False)
        before = {relative: label(source / relative) for relative in paths}
        target_label = label(target)
        captured = helper(source_name, source, ["capture"], read_only=True)
        tree = json.loads((spool / captured["tree"]).read_text())
        tree_text = json.dumps(tree)
        assert "security.selinux" not in tree_text and "container_file_t" not in tree_text
        assert before == {relative: label(source / relative) for relative in paths}
        helper(target_name, target, ["restore", captured["tree"]])
        assert label(target) == target_label
        for relative in paths:
            assert portable_metadata(source / relative) == portable_metadata(target / relative), relative
            assert label(target / relative) == label(control / relative), relative
        assert (source / "directory/file").read_bytes() == (target / "directory/file").read_bytes()
        assert os.stat(target / "directory/file").st_ino == os.stat(target / "alias").st_ino
        assert os.readlink(target / "external-link") == "/outside/never-read"
        recap = helper(target_name, target, ["capture"], read_only=True)
        assert captured["tree"] == recap["tree"], "roundtrip changed portable digest"
        report["checks"].append({"name": "complete-volume-roundtrip", "state": "passed", "treeDigest": captured["tree"],
                                 "entries": captured["entries"], "sourceRootLabel": before[""], "targetRootLabel": target_label})

        empty_name, empty = volume("empty-source")
        empty_target_name, empty_target = volume("empty-target")
        empty_capture = helper(empty_name, empty, ["capture"], read_only=True)
        empty_label = label(empty_target)
        helper(empty_target_name, empty_target, ["restore", empty_capture["tree"]])
        assert label(empty_target) == empty_label and list(empty_target.iterdir()) == []
        report["checks"].append({"name": "empty-labeled-volume", "state": "passed"})

        protected_name, protected = volume("protected-target")
        os.setxattr(protected, "user.snapshot-test", b"keep")
        protected_before = portable_metadata(protected)
        helper(protected_name, protected, ["restore", captured["tree"]], expected_code="SNAPSHOT_STORAGE_UNSUPPORTED")
        assert os.getxattr(protected, "user.snapshot-test") == b"keep"
        assert portable_metadata(protected) == protected_before and list(protected.iterdir()) == []
        report["checks"].append({"name": "target-user-attribute-preserved", "state": "passed"})

        nonempty_name, nonempty = volume("nonempty-target")
        (nonempty / "keep").write_bytes(b"keep existing content")
        nonempty_before = portable_metadata(nonempty)
        helper(nonempty_name, nonempty, ["restore", captured["tree"]], expected_code="PACKAGE_INVALID")
        assert (nonempty / "keep").read_bytes() == b"keep existing content"
        assert portable_metadata(nonempty) == nonempty_before
        report["checks"].append({"name": "nonempty-target-preserved", "state": "passed"})

        cases = [("user-attribute", source / "directory/file", "user.snapshot-test", None),
                 ("access-acl", source / "directory/file", "system.posix_acl_access", "setfacl"),
                 ("default-acl", source / "directory", "system.posix_acl_default", "setfacl"),
                 ("file-capability", source / "directory/file", "security.capability", "setcap")]
        for case, path, attr, tool in cases:
            if tool and not shutil.which(tool):
                report["checks"].append({"name": case, "state": "skipped", "reason": tool + " unavailable"})
                continue
            if case == "user-attribute":
                os.setxattr(path, attr, b"keep")
            elif case == "access-acl":
                command("setfacl", "-m", "u:10002:r--", str(path))
            elif case == "default-acl":
                command("setfacl", "-m", "d:u:10002:r-x", str(path))
            else:
                command("setcap", "cap_net_bind_service=ep", str(path))
            attr_before, meta_before = os.getxattr(path, attr), portable_metadata(path)
            bytes_before = hashlib.sha256((source / "directory/file").read_bytes()).hexdigest()
            helper(source_name, source, ["capture"], read_only=True, expected_code="SNAPSHOT_STORAGE_UNSUPPORTED")
            assert os.getxattr(path, attr) == attr_before and portable_metadata(path) == meta_before
            assert hashlib.sha256((source / "directory/file").read_bytes()).hexdigest() == bytes_before
            os.removexattr(path, attr)
            report["checks"].append({"name": case + "-rejected-without-source-change", "state": "passed"})
        report["state"] = "passed" if all(check["state"] == "passed" for check in report["checks"]) else "incomplete"
    except Exception as error:
        report["state"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        cleanup_errors = []
        for container in containers:
            try:
                owned("container", container)
                command("docker", "rm", "-f", container)
            except Exception as error:
                cleanup_errors.append(str(error))
        for name in reversed(volumes):
            try:
                owned("volume", name)
                command("docker", "volume", "rm", name)
            except Exception as error:
                cleanup_errors.append(str(error))
        report["cleanup"] = {"state": "passed" if not cleanup_errors else "failed", "errors": cleanup_errors}
        destination = Path(options.evidence)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2) + "\n")
        if cleanup_errors:
            raise RuntimeError("isolated fixture cleanup failed")
    print(json.dumps({"state": report["state"], "evidence": options.evidence, "checks": len(report["checks"])}))
    if report["state"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
