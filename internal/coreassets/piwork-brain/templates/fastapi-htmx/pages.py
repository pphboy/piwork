"""Full pages and independent read-only HTML fragments."""
from pathlib import Path
from fastapi import Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from piwork_fastapi_runtime import browser_url, context, templates
from piwork_protocol import ProtocolError


def register_pages(app, station, code, loaded):
    environment = templates(code)

    def render(request, page, full=False, error='', status=200):
        query = station.query('review' if page == '/review' else 'todos', {})
        exports = station.query('exports', {})['value'] if page == '/review' else []
        runtime = {**loaded, **context(request)}
        value = environment.get_template('page.html' if full else 'partials/business.html').render(
            query=query, page=page, exports=exports, error=error,
            runtime=runtime, url=lambda path: browser_url(request, path))
        return HTMLResponse(value, status_code=status, headers={
            'Cache-Control': 'no-store', 'X-Piwork-State-Version': query['stateVersion']})

    @app.get('/')
    def todos(request: Request):
        station.visit('/')
        return render(request, '/', full=True)

    @app.get('/review')
    def review(request: Request):
        station.visit('/review')
        return render(request, '/review', full=True)

    @app.get('/fragments/business')
    def business(request: Request, page: str = '/'):
        if page not in ['/', '/review']:
            raise ProtocolError('PAGE_PATH_INVALID', 400)
        if (station.data / 'awareness-query-failure').exists():
            return JSONResponse({'code': 'QUERY_UNAVAILABLE'}, status_code=503)
        return render(request, page)

    @app.get('/downloads/{name}')
    def download(name: str):
        if Path(name).name != name or not name.startswith('job-') or not name.endswith('.json'):
            raise ProtocolError('EXPORT_NOT_FOUND', 404)
        path = station.data / name
        if not path.is_file():
            raise ProtocolError('EXPORT_NOT_FOUND', 404)
        return FileResponse(path, filename=name, media_type='application/json')

    return render
