"""FastAPI backend: React and Agent actions share the same business logic."""
import os
import json
from pathlib import Path
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from piwork_protocol import ProtocolError
from workstation import Workstation

code = Path(__file__).resolve().parent.parent
if os.environ.get("PIWORK_WEB_DEV") == "1":
    from piwork_web import version
    os.environ["PIWORK_WEB_CODE_VERSION"] = version(code)["codeVersion"]
service_name = json.loads(Path("/etc/piwork/interaction/config.json").read_text())["serviceName"]
station = Workstation(os.environ.get("WORKSTATION_DATA", f"/var/data/workspace/data/{service_name}"), code)


@asynccontextmanager
async def lifespan(_app):
    station.protocol.start_delivery()
    try:
        yield
    finally:
        station.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(ProtocolError)
async def protocol_error(_request, error):
    return JSONResponse({"code": error.code}, status_code=error.status)


def require_agent(request):
    if not station.protocol.authorized(request.headers.get("authorization")):
        raise ProtocolError("SERVICE_AUTH_REQUIRED", 401)



@app.get("/pi/v1/capabilities")
def capabilities(request: Request):
    require_agent(request)
    return station.capabilities()


@app.post("/pi/v1/queries/{name}")
async def query(name: str, request: Request):
    require_agent(request)
    body = await request.json()
    if set(body) != {"input"}:
        raise ProtocolError("QUERY_INPUT_INVALID", 400)
    return station.query(name, body["input"])


@app.post("/pi/v1/actions/{name}")
async def action(name: str, request: Request):
    require_agent(request)
    body = await request.json()
    if set(body) - {"actionId", "input", "expectedStateVersion", "causationRequestId"}:
        raise ProtocolError("ACTION_INPUT_INVALID", 400)
    config = json.loads((code / "review_config.json").read_text())
    delay = config.get("exportDelayMs", 8000)
    if not isinstance(delay, int) or not 1 <= delay <= 60000:
        raise ProtocolError("WAIT_CONFIGURATION_INVALID", 400)
    return station.perform(name, body["actionId"], body["input"], body.get("expectedStateVersion"), request_id=body.get("causationRequestId"), export_delay=delay / 1000)


@app.get("/pi/v1/actions/{action_id}")
def original_action(action_id: str, request: Request):
    require_agent(request)
    if json.loads((code / "review_config.json").read_text()).get("unavailableOriginalAction", False):
        raise ProtocolError("ACTION_NOT_FOUND", 404)
    return station.protocol.action_get(action_id)


@app.get("/pi/v1/jobs/{job_id}")
def job(job_id: str, request: Request):
    require_agent(request)
    return station.job(job_id)


@app.get("/ui/receipts/{event_id}")
def receipt(event_id: str):
    return station.receipt(event_id)


@app.get("/ui/exports")
def exports():
    return station.query("exports", {})


@app.post("/ui/feedback")
async def feedback(request: Request):
    body = await request.json()
    return {"eventId": station.feedback(body["reason"], body["goal"])}


@app.post("/ui/receipts/{event_id}/retry")
def retry_receipt(event_id: str):
    return station.protocol.retry_event(event_id)


@app.get("/ui/requests/{request_id}")
def request_status(request_id: str):
    try:
        return station.protocol.request_get(request_id)
    except OSError:
        return JSONResponse({"code": "PI_UNAVAILABLE"}, status_code=503)


@app.post("/ui/requests/{request_id}/cancel")
def request_cancel(request_id: str):
    return station.protocol.request_cancel(request_id)


def user_action(name, value):
    version = station.capabilities()["stateVersion"]
    return station.perform(name, "user-" + uuid.uuid4().hex, value, version, actor="user")




@app.get("/ui/queries/{name}")
def user_query(name: str):
    return station.query(name, {})


@app.post("/ui/actions/{name}")
async def user_action_endpoint(name: str, request: Request):
    body = await request.json()
    if set(body) != {"actionId", "input", "expectedStateVersion"}:
        raise ProtocolError("ACTION_INPUT_INVALID", 400)
    return station.perform(name, body["actionId"], body["input"], body["expectedStateVersion"], actor="user")


@app.get("/ui/actions/{action_id}")
def user_original_action(action_id: str):
    return station.protocol.action_get(action_id)


@app.post("/ui/visits")
async def user_visit(request: Request):
    body = await request.json()
    if set(body) != {"pathname"} or not isinstance(body["pathname"], str) or not body["pathname"].startswith("/"):
        raise ProtocolError("PAGE_PATH_INVALID", 400)
    station.visit(body["pathname"])
    return {"recorded": True}


from piwork_web_runtime import mount_frontend
loaded_version = mount_frontend(app, code)
