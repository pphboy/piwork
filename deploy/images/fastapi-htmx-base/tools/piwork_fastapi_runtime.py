"""Request-local URLs and the actual checked process identity."""
import json
import os
from pathlib import Path
import re

from fastapi.responses import FileResponse, JSONResponse
from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from piwork_fastapi import BASE, version


def context(request):
    prefix = request.headers.get('x-forwarded-prefix', '')
    if prefix and not re.fullmatch(r'/services/[A-Za-z0-9][A-Za-z0-9-]{0,127}/[A-Za-z0-9][A-Za-z0-9-]{0,127}/[1-9][0-9]{0,4}', prefix):
        raise ValueError('Invalid Service prefix')
    scope = request.headers.get('x-piwork-app-session', 'local')
    if scope != 'local' and not re.fullmatch(r'[a-f0-9]{64}', scope):
        raise ValueError('Invalid application scope')
    return {'basePath': prefix, 'storageScope': scope}


def browser_url(request, path):
    if not path.startswith('/') or path.startswith('//'):
        raise ValueError('Expected an application-root URL')
    prefix = context(request)['basePath']
    return path if prefix and (path == prefix or path.startswith(prefix + '/')) else prefix + path


def templates(root):
    return Environment(loader=FileSystemLoader(root / 'templates'), auto_reload=False,
                       autoescape=select_autoescape(['html', 'xml']), undefined=StrictUndefined)


def mount_runtime(app, root):
    loaded = version(root)
    expected = json.loads(os.environ['PIWORK_FASTAPI_VERSION'])
    if loaded != expected:
        raise RuntimeError('Checked source differs from running source')
    status = {**loaded, 'ready': True, 'mode': 'fastapi-htmx'}

    @app.get('/api/runtime-version')
    def runtime_version():
        return JSONResponse(status, headers={'Cache-Control': 'no-store'})

    @app.get('/health')
    def health():
        return JSONResponse(status, headers={'Cache-Control': 'no-store'})

    @app.get('/piwork-assets/{name}')
    def asset(name: str):
        if name not in ['htmx.min.js', 'bootstrap.min.css']:
            return JSONResponse({'code': 'ASSET_NOT_FOUND'}, status_code=404)
        return FileResponse(BASE / 'vendor' / name, headers={'Cache-Control': 'no-cache'})

    return status
