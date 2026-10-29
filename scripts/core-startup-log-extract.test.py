import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/core-startup-log-extract.py'
OLD = 'a' * 32
NEW = 'b' * 32
OTHER = 'c' * 32


def make_export(path, boot_ids, *, partial=False, corrupt=False, mixed=False):
    files = []
    with zipfile.ZipFile(path, 'w') as archive:
        for boot in boot_ids:
            name = 'core-' + boot + '-00000001.jsonl'
            content = b''.join((json.dumps(value) + '\n').encode() for value in [
                {'bootId': OTHER if mixed else boot, 'event': 'app.listening'},
                {'bootId': boot, 'event': 'performance.startup-docker',
                 'fields': {'phase': 'startup-docker', 'outcome': 'succeeded', 'secret': 'not-exported'}},
            ])
            files.append({'name': name, 'size': len(content),
                          'digest': '0' * 64 if corrupt else hashlib.sha256(content).hexdigest(),
                          'partial': partial})
            archive.writestr('core/' + name, content)
        archive.writestr('manifest.json', json.dumps({'core': {'includeCoreLogs': True, 'partial': False, 'files': files}}))


class StartupLogEvidenceTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'dist').mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix='startup-log-test-', dir=ROOT / 'dist')
        self.root = pathlib.Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)

    def test_selects_only_the_one_new_boot_and_safe_fields(self):
        first, second = self.root / 'first.zip', self.root / 'second.zip'
        baseline, index, output = self.root / 'before.json', self.root / 'after.json', self.root / 'console.log'
        make_export(first, [OLD])
        make_export(second, [OLD, NEW])
        self.assertEqual(self.run_tool('baseline', '--archive', first, '--index', baseline).returncode, 0)
        output.write_text('')
        result = self.run_tool('extract', '--archive', second, '--baseline', baseline, '--index', index, '--output', output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(index.read_text())['bootIds'], [OLD, NEW])
        lines = output.read_text().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0]), {'event': 'performance', 'phase': 'startup-docker', 'outcome': 'succeeded'})
        self.assertNotIn('not-exported', output.read_text())
        self.assertNotEqual(self.run_tool('extract', '--archive', second, '--baseline', baseline, '--index', index, '--output', output).returncode, 0)

    def test_rejects_ambiguous_boots_and_unverified_shards(self):
        first, baseline = self.root / 'first.zip', self.root / 'before.json'
        make_export(first, [OLD])
        self.assertEqual(self.run_tool('baseline', '--archive', first, '--index', baseline).returncode, 0)
        for case in ('multiple', 'partial', 'corrupt', 'mixed'):
            archive, output, index = self.root / (case + '.zip'), self.root / (case + '.log'), self.root / (case + '.json')
            make_export(archive, [OLD, NEW, OTHER] if case == 'multiple' else [OLD, NEW],
                        partial=case == 'partial', corrupt=case == 'corrupt', mixed=case == 'mixed')
            output.write_text('')
            result = self.run_tool('extract', '--archive', archive, '--baseline', baseline, '--index', index, '--output', output)
            self.assertNotEqual(result.returncode, 0, case)
            self.assertEqual(output.read_text(), '')
            self.assertFalse(index.exists())


if __name__ == '__main__':
    unittest.main()
