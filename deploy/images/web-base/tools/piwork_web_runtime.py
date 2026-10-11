"""Actual loaded NiceGUI version and application-owned browser update adapter."""
import json
import os
from pathlib import Path

from fastapi.responses import FileResponse, JSONResponse
from piwork_web import BASE, version


def mount_runtime(app, root):
    root = Path(root).resolve()
    dev = os.environ.get('PIWORK_WEB_DEV') == '1'
    actual = version(root)
    expected = actual if dev else json.loads(os.environ['PIWORK_WEB_RUNTIME_VERSION'])
    if any(expected.get(key) != value for key, value in actual.items()):
        raise RuntimeError('Application source/environment differs from its checked startup version')
    loaded = {**actual, 'ready': True}

    def runtime():
        try:
            marker = json.loads((root / '.build/runtime.json').read_text())
            ready = dev or marker == loaded
        except (OSError, ValueError):
            ready = dev
        return {**loaded, 'ready': ready, 'mode': 'development' if dev else 'nicegui'}

    @app.get('/api/runtime-version')
    def runtime_version():
        return JSONResponse(runtime(), headers={'Cache-Control': 'no-store'})

    @app.get('/health')
    def health():
        status = runtime()
        return JSONResponse(status, status_code=200 if status['ready'] else 503, headers={'Cache-Control': 'no-store'})

    @app.get('/piwork-assets/page-client.js', include_in_schema=False)
    def page_client():
        return FileResponse(BASE / 'lib/page-client.js', media_type='application/javascript', headers={'Cache-Control': 'no-store'})

    return runtime()


def page_head(ui, loaded):
    # Synchronous head script installs the draft/reconnect guard before NiceGUI
    # creates its Socket.IO client. All resources stay on the protected origin.
    ui.add_head_html('<script>window.piworkRuntime=' + json.dumps(loaded) + ';</script>'
                     '<script src="/piwork-assets/page-client.js?v=' + loaded['frontendVersion'] + '"></script>')
