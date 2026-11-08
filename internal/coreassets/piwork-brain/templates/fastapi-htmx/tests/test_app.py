import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app import create_app
from workstation import Workstation


def client(tmp_path):
    code = Path(__file__).resolve().parents[1]
    identity = {'contractVersion': 1, 'workId': 'work-test', 'serviceId': 'service-test',
                'serviceName': 'sample', 'token': 'a' * 64}
    station = Workstation(tmp_path, code, identity)
    station.protocol.start_delivery = lambda: None
    loaded = {'codeVersion': 'a' * 64, 'frontendVersion': 'b' * 64}
    return station, TestClient(create_app(station, code, loaded))


def test_pages_forms_conflicts_and_agent_share_state(tmp_path):
    station, app = client(tmp_path)
    with app:
        headers = {'X-Forwarded-Prefix': '/services/work-test/service-test/8080'}
        response = app.get('/', headers=headers)
        assert response.status_code == 200
        assert '/services/work-test/service-test/8080/forms/todo_add' in response.text
        form = {'actionId': 'user-one', 'expectedStateVersion': '1', 'title': '<script>unsafe</script>', 'page': '/'}
        added = app.post('/forms/todo_add', data=form)
        assert added.status_code == 200
        assert '&lt;script&gt;' in added.text
        assert app.post('/forms/todo_add', data=form).status_code == 200
        assert len(station.query('todos', {})['value']) == 1
        assert app.post('/forms/todo_add', data={**form, 'actionId': 'user-two'}).status_code == 409
        assert app.post('/forms/todo_add', data={**form, 'actionId': 'user-bad', 'expectedStateVersion': '2', 'title': ''}).status_code == 400
        result = app.post('/pi/v1/queries/todos', json={'input': {}}, headers={'Authorization': 'Bearer ' + 'a' * 64})
        assert result.json()['value'][0]['title'] == form['title']
        assert app.get('/fragments/business').text.startswith('<section')
        assert '<!doctype html>' in app.get('/review').text
        assert app.get('/pi/v1/not-found').status_code == 404
        assert app.get('/review/').status_code == 404
        assert app.get('/static/page-client.js').status_code == 200
        assert app.get('/static/style.css').status_code == 200


def test_read_failure_keeps_error_out_of_html_and_export_uses_service_name(tmp_path):
    station, app = client(tmp_path)
    with app:
        (station.data / 'awareness-query-failure').touch()
        assert app.get('/fragments/business').status_code == 503
        (station.data / 'awareness-query-failure').unlink()
        assert app.get('/fragments/business').status_code == 200
        result = station.perform('export_review', 'export-test', {}, '1', export_delay=0.001)
        for _, thread in station.threads:
            thread.join()
        job = station.job(result['jobId'])
        assert job['artifacts'][0].startswith('data/sample/')
        assert app.get('/downloads/' + result['jobId'] + '.json').status_code == 200


def test_standard_environment_can_parse_multipart_upload(tmp_path):
    from fastapi import File, UploadFile
    station, app = client(tmp_path)

    @app.app.post('/fixture-upload')
    async def upload(file: UploadFile = File(...)):
        return {'name': file.filename, 'body': (await file.read()).decode()}

    with app:
        response = app.post('/fixture-upload', files={'file': ('synthetic.txt', b'fixture')})
        assert response.json() == {'name': 'synthetic.txt', 'body': 'fixture'}
