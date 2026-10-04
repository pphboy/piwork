"""NiceGUI example. Browser feedback uses this backend; private identity stays here."""
import os
import json
from pathlib import Path
import uuid
from fastapi import Request
from fastapi.responses import JSONResponse
from nicegui import app, ui
from piwork_protocol import ProtocolError
from workstation import Workstation

code = Path(__file__).resolve().parent
station = Workstation(os.environ.get("WORKSTATION_DATA", "/var/data/workspace/data/workstation"), code)


@app.exception_handler(ProtocolError)
async def protocol_error(_request, error):
    return JSONResponse({"code": error.code}, status_code=error.status)


def require_agent(request):
    if not station.protocol.authorized(request.headers.get("authorization")):
        raise ProtocolError("SERVICE_AUTH_REQUIRED", 401)


@app.get("/health")
def health():
    return {"ready": True}


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


@ui.page("/")
def home():
    station.visit("/")
    ui.label("Personal workstation").classes("text-h4")
    ui.label("Todos, review and a portable export")
    title = ui.input("Todo title").props("maxlength=200")
    add_notice = ui.label("")
    @ui.refreshable
    def todos():
        for row in station.query("todos", {})["value"]:
            with ui.row().classes("items-center"):
                ui.label(row["title"])
                if not row["completed"]:
                    ui.button("Complete", on_click=lambda _, item=row: (user_action("todo_complete", {"id": item["id"]}), todos.refresh()))
                else:
                    ui.label("Completed")
    def add(event):
        # Capture the field in the submit event; its earlier value-change event
        # may still be in flight when the user clicks immediately after typing.
        value = event.args
        if not isinstance(value, str) or not 0 < len(value) <= 200:
            add_notice.text = "Enter a Todo title (up to 200 characters)."
            return
        title.value = value
        result = user_action("todo_add", {"title": value})
        if result["state"] != "succeeded":
            add_notice.text = "Todo was not added. Refresh and try again."
            return
        add_notice.text = ""
        title.value = ""
        todos.refresh()
    ui.button("Add Todo").on("click", add,
        js_handler=f"() => emit(getElement({title.id}).$refs.qRef.$el.querySelector('input').value)")
    todos()
    ui.link("Personal review", "/review")


@ui.page("/review")
def review():
    station.visit("/review")
    ui.label("Personal review").classes("text-h4")
    @ui.refreshable
    def completed():
        rows = station.query("review", {})["value"]["completed"]
        ui.label(f"Completed Todos: {len(rows)}")
        for row in rows:
            ui.label(row["title"])
    completed()
    ui.button("Refresh review", on_click=completed.refresh)
    event_id = None
    notice = ui.label("No feedback submitted.")
    def submit():
        nonlocal event_id
        event_id = station.feedback("review_missing", "The personal review omits completed Todos. Fix this Service, verify the actual review query and confirm what was learned.")
        notice.text = "Feedback saved. Checking its durable Pi receipt…"
    def poll():
        if not event_id:
            return
        record = station.receipt(event_id)
        receipt = record["receipt"]
        notice.text = f"Feedback {record['delivery']} · event {event_id}"
        if record.get("error"):
            notice.text += " · " + record["error"]
        if receipt and receipt.get("requestId"):
            try:
                current = station.protocol.request_get(receipt["requestId"])
                goal = current["request"]
                notice.text += f" · Pi request {goal['requestId']} · {goal['state']}"
                if goal.get("result"):
                    notice.text += " · " + goal["result"]
            except OSError:
                notice.text += " · Pi status unavailable; check again"
    ui.button("Report missing completed Todos", on_click=submit)
    ui.button("Check feedback", on_click=poll)
    ui.timer(2, poll)
    export_notice = ui.label("No export requested.")
    def export():
        result = user_action("export_review", {})
        export_notice.text = "Export Job " + str(result.get("jobId"))
    ui.button("Export review", on_click=export)
    ui.link("Todos", "/")


app.on_startup(station.protocol.start_delivery)
app.on_shutdown(station.close)
ui.run(host="0.0.0.0", port=8080, reload=False, show=False, title="Personal workstation", tailwind=False)
