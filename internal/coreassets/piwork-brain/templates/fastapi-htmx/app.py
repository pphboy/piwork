"""One checked application process; HTTP adapters share the business state."""
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from piwork_fastapi_runtime import mount_runtime
from piwork_protocol import ProtocolError
from workstation import Workstation
from agent_api import register_agent_api
from pages import register_pages
from ui_actions import register_ui_actions


def create_app(station, code, loaded=None):
    @asynccontextmanager
    async def lifespan(_app):
        station.protocol.start_delivery()
        try:
            yield
        finally:
            station.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)

    @app.exception_handler(ProtocolError)
    async def protocol_error(_request: Request, error):
        return JSONResponse({'code': error.code}, status_code=error.status)

    app.mount('/static', StaticFiles(directory=code / 'static'), name='static')
    loaded = loaded or mount_runtime(app, code)
    register_agent_api(app, station, code)
    render = register_pages(app, station, code, loaded)
    register_ui_actions(app, station, render)
    return app


if __name__ == '__main__':
    import uvicorn
    code = Path(__file__).resolve().parent
    identity = json.loads(Path('/etc/piwork/interaction/config.json').read_text())
    station = Workstation(Path('/var/data/workspace/data') / identity['serviceName'], code, identity)
    app = create_app(station, code)
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PIWORK_WEB_PORT', '8080')), workers=1)
