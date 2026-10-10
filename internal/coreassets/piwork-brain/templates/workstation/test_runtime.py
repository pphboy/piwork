"""Application adapter tests use isolated files, never live business/identity data."""
import json
from fastapi import FastAPI
from fastapi.testclient import TestClient
from piwork_web_runtime import mount_frontend


def test_versions_bind_environment_without_backend_or_generated_frontend_churn(tmp_path, monkeypatch):
    import piwork_web
    (tmp_path / 'frontend').mkdir()
    (tmp_path / 'frontend/app.tsx').write_text('const app = 1;')
    (tmp_path / 'app.py').write_text('value = 1')
    monkeypatch.setattr(piwork_web, 'environment_hash', lambda: 'environment-A')
    first = piwork_web.version(tmp_path)
    assert first == piwork_web.version(tmp_path)
    (tmp_path / 'app.py').write_text('value = 2')
    backend = piwork_web.version(tmp_path)
    assert backend['codeVersion'] != first['codeVersion']
    assert backend['frontendVersion'] == first['frontendVersion']
    monkeypatch.setattr(piwork_web, 'environment_hash', lambda: 'environment-B')
    upgraded = piwork_web.version(tmp_path)
    assert upgraded['codeVersion'] != backend['codeVersion']
    assert upgraded['frontendVersion'] != backend['frontendVersion']
    (tmp_path / '.build').mkdir()
    (tmp_path / '.build/runtime.json').write_text(json.dumps(upgraded))
    (tmp_path / 'frontend/dist').mkdir()
    (tmp_path / 'frontend/dist/index.html').write_text('generated with version')
    assert upgraded == piwork_web.version(tmp_path)


def test_loaded_version_does_not_follow_a_changed_disk_marker(tmp_path, monkeypatch):
    manifest = {'codeVersion': 'old-code', 'frontendVersion': 'old-ui', 'environmentHash': 'fixture', 'ready': True}
    (tmp_path / 'frontend/dist/assets').mkdir(parents=True)
    (tmp_path / 'frontend/dist/index.html').write_text('<html>actual page</html>')
    (tmp_path / 'frontend/dist/assets/app.js').write_text('console.log("app")')
    (tmp_path / '.build').mkdir()
    marker = tmp_path / '.build/runtime.json'
    marker.write_text(json.dumps(manifest))
    monkeypatch.setenv('PIWORK_WEB_RUNTIME_VERSION', json.dumps(manifest))
    monkeypatch.delenv('PIWORK_WEB_DEV', raising=False)
    app = FastAPI()
    mount_frontend(app, tmp_path)
    with TestClient(app) as client:
        assert client.get('/health').status_code == 200
        assert client.get('/api/runtime-version').json()['mode'] == 'static'
        assert client.get('/review').text == '<html>actual page</html>'
        assert client.get('/review').headers['cache-control'] == 'no-store'
        assert client.get('/api/missing').status_code == 404
        assert client.get('/pi/v1/missing').status_code == 404
        assert client.get('/assets/missing.js').status_code == 404
        assert 'immutable' in client.get('/assets/app.js').headers['cache-control']
        marker.write_text(json.dumps({**manifest, 'codeVersion': 'new-code'}))
        observed = client.get('/api/runtime-version').json()
        assert observed['codeVersion'] == 'old-code'
        assert observed['ready'] is False
        assert client.get('/health').status_code == 503
        assert client.get('/review').status_code == 503
