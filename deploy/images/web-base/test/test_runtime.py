"""Real Python tools under the image's read-only root and workspace grant."""
import json
import os
from pathlib import Path
import subprocess
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient
import piwork_web
from piwork_web_runtime import mount_runtime


def application(tmp_path):
    root = tmp_path / 'app'
    root.mkdir()
    (root / 'app.py').write_text('print("actual-application-executed")\n')
    (root / 'ui.py').write_text('title = "initial"\n')
    (root / 'workstation.py').write_text('business = 1\n')
    (root / 'requirements.in').write_text('# Only additional Python packages belong here.\n')
    return root


def test_checked_execution_reuses_only_matching_source(tmp_path):
    root = application(tmp_path)
    (root / 'test_application.py').write_text(
        'from pathlib import Path\ndef test_business_check():\n'
        ' p=Path(".cache/check-count"); p.write_text(str(int(p.read_text())+1) if p.exists() else "1")\n'
        ' assert 2 + 2 == 4\n')
    command = ['piwork-web', 'run', '--app', str(root)]
    first = subprocess.run(command, capture_output=True, text=True)
    assert first.returncode == 0, first.stdout + first.stderr
    assert 'actual-application-executed' in first.stdout
    second = subprocess.run(command, capture_output=True, text=True)
    assert second.returncode == 0, second.stdout + second.stderr
    assert (root / '.cache/check-count').read_text() == '1'
    assert not (root / '.deps').exists()
    assert not (root / '.venv').exists()
    assert not (root / 'node_modules').exists()
    (root / 'app.py').write_text('invalid syntax = ;\n')
    failed = subprocess.run(command, capture_output=True, text=True)
    assert failed.returncode != 0
    assert not json.loads((root / '.build/checks.json').read_text())['passed']
    (root / 'app.py').write_text('print("actual-changed-application")\n')
    repaired = subprocess.run(command, capture_output=True, text=True)
    assert repaired.returncode == 0, repaired.stdout + repaired.stderr
    assert 'actual-changed-application' in repaired.stdout
    assert (root / '.cache/check-count').read_text() == '2'


def test_ui_business_environment_and_generated_files_have_distinct_identities(tmp_path, monkeypatch):
    root = application(tmp_path)
    first = piwork_web.version(root)
    assert first == piwork_web.version(root)
    (root / 'workstation.py').write_text('business = 2\n')
    business = piwork_web.version(root)
    assert business['codeVersion'] != first['codeVersion']
    assert business['frontendVersion'] == first['frontendVersion']
    (root / 'ui.py').write_text('title = "changed"\n')
    page = piwork_web.version(root)
    assert page['frontendVersion'] != business['frontendVersion']
    monkeypatch.setattr(piwork_web, 'environment_hash', lambda: 'different-actual-image')
    upgraded = piwork_web.version(root)
    assert upgraded['codeVersion'] != page['codeVersion']
    assert upgraded['frontendVersion'] != page['frontendVersion']
    (root / '.build').mkdir()
    (root / '.build/runtime.json').write_text(json.dumps(upgraded))
    (root / '.cache').mkdir()
    (root / '.cache/temporary').write_text('not source')
    assert piwork_web.version(root) == upgraded


def test_page_helpers_and_resources_are_versioned_and_actually_loaded(tmp_path):
    root = application(tmp_path)
    (root / 'pages').mkdir()
    helper = root / 'pages/header.py'
    helper.write_text('TITLE = "original helper"\n')
    (root / 'assets').mkdir()
    resource = root / 'assets/theme.css'
    resource.write_text('body { color: black; }\n')
    (root / 'ui.py').write_text('from pages.header import TITLE\n')
    (root / 'app.py').write_text('from ui import TITLE\nprint(TITLE)\n')
    manifest = root / 'page-files.json'
    manifest.write_text(json.dumps({'files': ['pages/header.py', 'assets/theme.css']}))
    command = ['piwork-web', 'run', '--app', str(root)]
    first = subprocess.run(command, capture_output=True, text=True)
    assert first.returncode == 0, first.stdout + first.stderr
    assert 'original helper' in first.stdout
    before = piwork_web.version(root)
    helper.write_text('TITLE = "changed helper"\n')
    changed = piwork_web.version(root)
    assert changed['codeVersion'] != before['codeVersion']
    assert changed['frontendVersion'] != before['frontendVersion']
    rejected = subprocess.run(['piwork-web', 'serve', '--app', str(root)], capture_output=True, text=True)
    assert rejected.returncode != 0
    assert 'changed helper' not in rejected.stdout
    checked = subprocess.run(command, capture_output=True, text=True)
    assert checked.returncode == 0, checked.stdout + checked.stderr
    assert 'changed helper' in checked.stdout
    resource.write_text('body { color: blue; }\n')
    styled = piwork_web.version(root)
    assert styled['frontendVersion'] != changed['frontendVersion']
    (root / 'workstation.py').write_text('business = 2\n')
    business = piwork_web.version(root)
    assert business['codeVersion'] != styled['codeVersion']
    assert business['frontendVersion'] == styled['frontendVersion']
    assert business == piwork_web.version(root)


def test_page_file_sets_are_extensible_stable_and_optional(tmp_path):
    root = application(tmp_path)
    original = piwork_web.version(root)
    manifest = root / 'page-files.json'
    manifest.write_text('{"files": []}\n')
    assert piwork_web.version(root)['frontendVersion'] == original['frontendVersion']
    (root / 'first.js').write_text('window.first = true;\n')
    (root / 'second.css').write_text('body { color: blue; }\n')
    manifest.write_text(json.dumps({'files': ['first.js']}))
    one = piwork_web.version(root)
    manifest.write_text(json.dumps({'files': ['first.js', 'second.css']}))
    two = piwork_web.version(root)
    assert two['frontendVersion'] != one['frontendVersion']
    manifest.write_text(json.dumps({'files': ['second.css', './first.js', 'first.js']}))
    assert piwork_web.version(root)['frontendVersion'] == two['frontendVersion']
    manifest.write_text(json.dumps({'files': ['first.js']}))
    assert piwork_web.version(root)['frontendVersion'] == one['frontendVersion']
    manifest.unlink()
    assert piwork_web.version(root)['frontendVersion'] == original['frontendVersion']


@pytest.mark.parametrize('content', [
    '{', '[]', 'null', '{}', '{"files": "ui.py"}', '{"files": [null]}',
    '{"files": [""]}', '{"files": ["."]}', '{"files": ["missing.py"]}',
    '{"files": ["../outside.py"]}', '{"files": ["/etc/passwd"]}',
    '{"files": [".cache/transient.js"]}', '{"files": ["data/business.json"]}',
])
def test_invalid_page_manifests_cannot_reuse_passed_checks(tmp_path, content):
    root = application(tmp_path)
    initial = subprocess.run(['piwork-web', 'run', '--app', str(root)], capture_output=True, text=True)
    assert initial.returncode == 0, initial.stdout + initial.stderr
    old_checks = (root / '.build/checks.json').read_bytes()
    (root / 'page-files.json').write_text(content)
    with pytest.raises(RuntimeError):
        piwork_web.version(root)
    for command in ['run', 'serve', 'check', 'dev']:
        failed = subprocess.run(['piwork-web', command, '--app', str(root)], capture_output=True, text=True)
        assert failed.returncode != 0, command
        assert 'actual-application-executed' not in failed.stdout
    assert (root / 'app.py').read_text() == 'print("actual-application-executed")\n'
    assert (root / '.build/checks.json').read_bytes() == old_checks


def test_page_manifests_reject_symbolic_files_parents_and_manifest(tmp_path):
    root = application(tmp_path)
    (root / 'pages').mkdir()
    (root / 'pages/header.py').write_text('title = "real"\n')
    manifest = root / 'page-files.json'
    for name, target in [('linked.py', root / 'pages/header.py'),
                         ('linked/header.py', root / 'pages'), ('missing.py', root / 'not-present.py')]:
        link = root / name.split('/')[0]
        link.symlink_to(target)
        manifest.write_text(json.dumps({'files': [name]}))
        with pytest.raises(RuntimeError, match='symbolic links'):
            piwork_web.version(root)
        link.unlink()
    manifest.unlink()
    manifest.symlink_to(root / 'absent.json')
    with pytest.raises(RuntimeError, match='symbolic link'):
        piwork_web.version(root)


def test_running_version_does_not_follow_source_or_marker_rewrites(tmp_path, monkeypatch):
    root = application(tmp_path)
    current = {**piwork_web.version(root), 'ready': True}
    (root / '.build').mkdir()
    marker = root / '.build/runtime.json'
    marker.write_text(json.dumps(current))
    monkeypatch.setenv('PIWORK_WEB_RUNTIME_VERSION', json.dumps(current))
    monkeypatch.setenv('PIWORK_WEB_DEV', '0')
    app = FastAPI()
    mount_runtime(app, root)
    with TestClient(app) as client:
        assert client.get('/health').status_code == 200
        assert client.get('/api/missing').status_code == 404
        assert client.get('/pi/v1/missing').status_code == 404
        assert client.get('/api/runtime-version').headers['cache-control'] == 'no-store'
        (root / 'ui.py').write_text('title = "unloaded new source"\n')
        assert client.get('/api/runtime-version').json()['codeVersion'] == current['codeVersion']
        marker.write_text(json.dumps({**current, 'codeVersion': 'fake-disk-version'}))
        observed = client.get('/api/runtime-version').json()
        assert observed['codeVersion'] == current['codeVersion']
        assert not observed['ready']
        assert client.get('/health').status_code == 503


def test_startup_rejects_an_unchecked_version(tmp_path, monkeypatch):
    root = application(tmp_path)
    monkeypatch.setenv('PIWORK_WEB_RUNTIME_VERSION', json.dumps({'codeVersion': 'invented'}))
    monkeypatch.setenv('PIWORK_WEB_DEV', '0')
    import pytest
    with pytest.raises(RuntimeError, match='checked startup version'):
        mount_runtime(FastAPI(), root)
