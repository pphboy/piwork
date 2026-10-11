"""Template version contracts use isolated files, never live application data."""
import json
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from piwork_web import page_files, version
from piwork_web_runtime import mount_runtime


def copied_source(tmp_path):
    source = Path(__file__).parent
    names = {'workstation.py', 'requirements.in', 'requirements.lock', *page_files(source)}
    if (source / 'page-files.json').exists():
        names.add('page-files.json')
    for name in sorted(names):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((source / name).read_bytes())
    return tmp_path


def test_business_and_page_source_have_distinct_versions(tmp_path):
    root = copied_source(tmp_path)
    before = version(root)
    business = root / 'workstation.py'
    business.write_text(business.read_text() + '\n# A changed business implementation.\n')
    after = version(root)
    assert after['codeVersion'] != before['codeVersion']
    assert after['frontendVersion'] == before['frontendVersion']
    page = root / 'ui.py'
    page.write_text(page.read_text() + '\n# A changed page implementation.\n')
    assert version(root)['frontendVersion'] != after['frontendVersion']
    locked = version(root)
    (root / 'requirements.lock').write_text('# A changed extra dependency identity\n')
    assert version(root)['codeVersion'] != locked['codeVersion']
    assert version(root)['frontendVersion'] != locked['frontendVersion']


def test_loaded_version_is_not_a_writable_marker(tmp_path, monkeypatch):
    root = copied_source(tmp_path)
    loaded = {**version(root), 'ready': True}
    (root / '.build').mkdir()
    marker = root / '.build/runtime.json'
    marker.write_text(json.dumps(loaded))
    monkeypatch.setenv('PIWORK_WEB_RUNTIME_VERSION', json.dumps(loaded))
    monkeypatch.setenv('PIWORK_WEB_DEV', '0')
    app = FastAPI()
    mount_runtime(app, root)
    with TestClient(app) as client:
        assert client.get('/health').status_code == 200
        marker.write_text(json.dumps({**loaded, 'codeVersion': 'unloaded'}))
        actual = client.get('/api/runtime-version').json()
        assert actual['codeVersion'] == loaded['codeVersion']
        assert not actual['ready']
        assert client.get('/health').status_code == 503
