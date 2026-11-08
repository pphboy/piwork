"""HTML form adapter; mutations remain with Workstation and original Action IDs."""
import json
from fastapi import Request
from fastapi.responses import HTMLResponse
from html import escape
from piwork_protocol import ProtocolError
from starlette.exceptions import HTTPException


def register_ui_actions(app, station, render):
    @app.post('/forms/{name}')
    async def action(name: str, request: Request):
        try:
            form = await request.form()
            if name not in ['todo_add', 'todo_complete', 'export_review']:
                raise ProtocolError('ACTION_NOT_FOUND', 404)
            allowed = {'actionId', 'expectedStateVersion', 'page'} | ({'title'} if name == 'todo_add' else {'id'} if name == 'todo_complete' else set())
            if set(form) - allowed or not form.get('actionId') or not form.get('expectedStateVersion'):
                raise ProtocolError('ACTION_INPUT_INVALID', 400)
            page = form.get('page', '/')
            if page not in ['/', '/review']:
                raise ProtocolError('PAGE_PATH_INVALID', 400)
            value = {'title': form.get('title', '')} if name == 'todo_add' else {'id': form.get('id', '')} if name == 'todo_complete' else {}
            result = station.perform(name, form['actionId'], value, form['expectedStateVersion'], actor='user')
            if result['state'] == 'failed':
                raise ProtocolError(result.get('error', {}).get('code', 'ACTION_FAILED'), 409)
            response = render(request, page)
            response.headers['HX-Trigger'] = json.dumps({'piwork:action': {'actionId': form['actionId']}})
            return response
        except ProtocolError as error:
            return HTMLResponse('<p class="alert alert-danger">' + escape(error.code) + '</p>',
                                status_code=error.status,
                                headers={'HX-Retarget': '#notice', 'HX-Reswap': 'innerHTML', 'Cache-Control': 'no-store'})
        except (HTTPException, ValueError):
            return HTMLResponse('<p class="alert alert-danger">ACTION_INPUT_INVALID</p>', status_code=400,
                                headers={'HX-Retarget': '#notice', 'HX-Reswap': 'innerHTML'})
