"""Small application-side static and actual loaded-version adapter."""
import json
import os
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse
from piwork_web import version


def mount_frontend(app, root):
    root = Path(root).resolve()
    dev = os.environ.get('PIWORK_WEB_DEV') == '1'
    loaded = version(root) if dev else json.loads(os.environ['PIWORK_WEB_RUNTIME_VERSION'])
    loaded = {**loaded, 'ready': True}
    dist = root / 'frontend/dist'

    def runtime():
        ready = dev
        if not dev:
            try:
                disk = json.loads((root / '.build/runtime.json').read_text())
                ready = disk == loaded and (dist / 'index.html').is_file()
            except (OSError, ValueError):
                ready = False
        return {**loaded, 'ready': ready, 'mode': 'development' if dev else 'static'}

    @app.get('/api/runtime-version')
    def runtime_version():
        return JSONResponse(runtime(), headers={'Cache-Control': 'no-store'})

    @app.get('/health')
    def health():
        status = runtime()
        return JSONResponse(status, status_code=200 if status['ready'] else 503, headers={'Cache-Control': 'no-store'})

    @app.get('/{path:path}', include_in_schema=False)
    def frontend(path: str):
        if path.split('/')[0] in {'api', 'pi', 'ui', 'health', 'assets'} and not path.startswith('assets/'):
            raise HTTPException(404)
        requested = (dist / path).resolve()
        if not requested.is_relative_to(dist.resolve()):
            raise HTTPException(404)
        if path.startswith('assets/'):
            if not requested.is_file():
                raise HTTPException(404)
            return FileResponse(requested, headers={'Cache-Control': 'public, max-age=31536000, immutable'})
        if requested.is_file() and requested.name != 'index.html':
            return FileResponse(requested)
        if not runtime()['ready']:
            raise HTTPException(503, 'Checked frontend is not ready')
        return FileResponse(dist / 'index.html', headers={'Cache-Control': 'no-store'})

    return loaded
