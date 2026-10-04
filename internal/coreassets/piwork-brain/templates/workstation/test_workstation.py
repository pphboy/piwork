import json
from pathlib import Path
import tempfile
import unittest
from workstation import Workstation
from piwork_protocol import ProtocolError


class StationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'review_config.json').write_text('{"codeVersion":"v1","includeCompleted":false}')
        self.identity = {"contractVersion": 1, "workId": "work-1234567890123456", "serviceId": "service-1234567890123456", "serviceName": "workstation", "token": "a" * 64}
        self.station = Workstation(self.root / 'data', self.root, self.identity)

    def tearDown(self):
        self.station.close(); self.temp.cleanup()

    def perform(self, name, key, value, **kwargs):
        return self.station.perform(name, key, value, self.station.capabilities()['stateVersion'], **kwargs)

    def test_business_transactions_original_identity_conflicts_and_review_fix(self):
        added = self.perform('todo_add', 'add-1', {"title": "private business text"})
        replay = self.station.perform('todo_add', 'add-1', {"title": "private business text"}, added['expectedStateVersion'])
        self.assertEqual(added, replay)
        with self.assertRaises(ProtocolError):
            self.perform('todo_add', 'add-1', {"title": "other content"})
        stale = self.station.perform('todo_complete', 'stale', {"id": added['result']['id']}, '1')
        self.assertEqual(stale['error']['code'], 'ACTION_STATE_CONFLICT')
        self.assertFalse(self.station.query('todos', {})['value'][0]['completed'])
        self.perform('todo_complete', 'complete', {"id": added['result']['id']})
        self.assertFalse(self.station.query('review', {})['checks'][0]['passed'])
        (self.root / 'review_config.json').write_text('{"codeVersion":"v2","includeCompleted":true}')
        self.assertTrue(self.station.query('review', {})['checks'][0]['passed'])
        self.assertEqual(self.station.query('review', {})['codeVersion'], 'v2')
        self.station.visit('/review?token=secret#fragment')
        with self.station.protocol.transaction() as db:
            events = [json.loads(row[0]) for row in db.execute('SELECT event_json FROM pi_outbox')]
        self.assertEqual(len(events), 3)
        self.assertNotIn('private business text', json.dumps(events))
        self.assertEqual(events[-1]['payload'], {"pathname": "/review"})

    def test_export_is_an_original_job_and_writes_real_artifact(self):
        self.perform('todo_add', 'add', {"title": "Persisted Todo"})
        result = self.perform('export_review', 'export', {}, export_delay=0.01)
        self.station.close()
        job = self.station.job(result['jobId'])
        self.assertEqual(job['state'], 'succeeded')
        self.assertEqual(json.loads((self.root / 'data' / Path(job['artifacts'][0]).name).read_text())[0]['title'], 'Persisted Todo')
        self.assertTrue(self.station.query('exports', {})['checks'][0]['passed'])
        self.assertEqual(self.station.protocol.action_get('export')['jobId'], result['jobId'])

    def test_interrupted_executor_and_import_origins_do_not_replay(self):
        with self.station.protocol.transaction() as db:
            db.execute("INSERT INTO ws_jobs VALUES('old-job','old-action','prior-executor','running','2099-01-01T00:00:00Z','[]',NULL,NULL)")
        event = self.station.feedback('review_missing', 'Fix original review')
        before = (self.root / 'data' / 'workstation.sqlite').read_bytes()
        replacement = Workstation(self.root / 'data', self.root, {**self.identity, "workId": "work-9999999999999999", "serviceId": "service-9999999999999999"})
        try:
            self.assertEqual(replacement.job('old-job')['error']['code'], 'JOB_EXECUTOR_INTERRUPTED')
            self.assertEqual(replacement.receipt(event)['delivery'], 'historical')
            self.assertFalse(replacement.protocol.deliver_once(lambda _: self.fail('old origin delivered')))
            new = replacement.feedback('review_missing', 'New independent goal')
            replacement.protocol.deliver_once(lambda e: {"eventId": e['eventId'], "requestId": "request-new"})
            self.assertEqual(replacement.receipt(new)['receipt']['requestId'], 'request-new')
        finally:
            replacement.close()


if __name__ == '__main__':
    unittest.main()
