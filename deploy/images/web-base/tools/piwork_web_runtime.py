"""Actual loaded NiceGUI version and application-owned browser update adapter."""
import json
import os
import re
from html import escape
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


def browser_context(request):
    """Request-derived browser metadata, never application configuration."""
    prefix = request.headers.get('x-forwarded-prefix', '') if request else ''
    if prefix and not re.fullmatch(r'/services/[A-Za-z0-9][A-Za-z0-9-]{0,127}/[A-Za-z0-9][A-Za-z0-9-]{0,127}/[1-9][0-9]{0,4}', prefix):
        raise ValueError('Invalid Service browser prefix')
    session = request.headers.get('x-piwork-app-session', '') if request else ''
    if session and not re.fullmatch(r'[a-f0-9]{64}', session):
        raise ValueError('Invalid application storage scope')
    return {'basePath': prefix, 'storageScope': session or 'local'}


def browser_url(request, path):
    """For custom HTML/scripts only; NiceGUI components prefix their own URLs."""
    if not path.startswith('/') or path.startswith('//'):
        raise ValueError('Expected an application-root path')
    prefix = browser_context(request)['basePath']
    if prefix and (path == prefix or path.startswith(prefix + '/')):
        return path
    return prefix + path


def page_head(ui, loaded):
    # NiceGUI uses X-Forwarded-Prefix for its links/assets/Socket.IO itself.
    # Custom head resources and fetch calls use the same prefix exactly once.
    request = ui.context.client.request
    runtime = {**loaded, **browser_context(request)}
    source = browser_url(request, '/piwork-assets/page-client.js') + '?v=' + loaded['frontendVersion']
    ui.add_head_html('<script>window.piworkRuntime=' + json.dumps(runtime).replace('<', '\\u003c') + ';</script>'
                     '<script src="' + escape(source, quote=True) + '"></script>')
