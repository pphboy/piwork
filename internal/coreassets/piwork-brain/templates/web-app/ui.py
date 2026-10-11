"""NiceGUI pages; UI and Agent operations use the same Workstation."""
import functools
import json
from pathlib import Path
from nicegui import ui
from piwork_protocol import ProtocolError
from piwork_web_runtime import page_head

TITLE = 'Personal workstation'
STYLE = (Path(__file__).parent / 'style.css').read_text()


def register_pages(station, loaded):
    def page(path):
        page_head(ui, loaded)
        ui.add_css(STYLE)
        with ui.column().classes('webapp-root').props('data-piwork-app'):
            ui.label('YOUR WORKSPACE').classes('webapp-eyebrow')
            ui.label(TITLE).props('role=heading aria-level=1').classes('webapp-station-title')
            ui.label('Build a little structure around your day.').classes('webapp-description')
            with ui.row().classes('webapp-navigation'):
                ui.link('Todos', '/')
                ui.link('Personal review', '/review')
            ui.label('').props('role=status data-piwork-status').classes('webapp-connection')
            notice = ui.label('').props('role=alert').classes('webapp-notice')
            sync_notice = ui.label('').props('role=status data-piwork-data-status').classes('webapp-data-status')
            seen = [None]
            title = None

            def action(name, value):
                try:
                    version = station.capabilities()['stateVersion']
                    result = station.perform(name, 'user-' + __import__('uuid').uuid4().hex, value, version, actor='user')
                    if result['state'] not in ['accepted', 'running', 'succeeded']:
                        raise ProtocolError(result.get('error', {}).get('code', 'ACTION_FAILED'), 409)
                    if name == 'todo_add':
                        title.value = ''
                        ui.run_javascript('window.piworkClearDraft("todo-title")')
                    if result.get('jobId'):
                        notice.text = 'Export Job ' + result['jobId']
                    else:
                        notice.text = ''
                    refresh(force=True)
                except ProtocolError as error:
                    notice.text = error.code
                    refresh(force=True)

            def report():
                try:
                    event = station.feedback('review_missing', 'The personal review omits completed Todos. Verify and repair the original review.')
                    ui.run_javascript('window.piworkSaveFeedback(' + json.dumps(event) + ')')
                except ProtocolError as error:
                    notice.text = error.code

            if path == '/review':
                ui.label('Personal review').props('role=heading aria-level=2').classes('webapp-section-title')
                content = ui.column().classes('webapp-business-content').props('data-piwork-business-content')
                ui.button('Report missing completed Todos', on_click=report)
                ui.label('No feedback submitted.').props('role=status data-piwork-feedback')
                ui.button('Export review', on_click=lambda: action('export_review', {}))
            else:
                ui.label('Todos').props('role=heading aria-level=2').classes('webapp-section-title')
                with ui.row().classes('webapp-new-todo'):
                    title = ui.input('Todo title').props('maxlength=200 data-piwork-draft=todo-title')
                    ui.button('Add Todo', on_click=lambda: action('todo_add', {'title': title.value}))
                content = ui.column().classes('webapp-business-content').props('data-piwork-business-content')

            def refresh(force=False):
                try:
                    query = station.query('review' if path == '/review' else 'todos', {})
                except Exception:
                    sync_notice.text = 'Unable to refresh data. Displayed data may be outdated; retrying automatically.'
                    return
                sync_notice.text = ''
                if not force and seen[0] == query['stateVersion']:
                    return
                seen[0] = query['stateVersion']
                content.clear()
                with content:
                    if path == '/review':
                        ui.label('Completed Todos: ' + str(len(query['value']['completed'])))
                        for todo in query['value']['completed']:
                            ui.label(todo['title'])
                    else:
                        for todo in query['value']:
                            with ui.row().classes('webapp-todo-row'):
                                ui.label(todo['title'])
                                if todo['completed']:
                                    ui.label('Completed').classes('webapp-completed')
                                else:
                                    ui.button('Complete', on_click=functools.partial(action, 'todo_complete', {'id': todo['id']}))
            refresh(force=True)
            ui.timer(1.0, refresh)
            ui.label('Changes appear automatically. Your work stays in this Work.').classes('webapp-footer')
        station.visit(path)

    @ui.page('/')
    def todos_page():
        page('/')

    @ui.page('/review')
    def review_page():
        page('/review')
