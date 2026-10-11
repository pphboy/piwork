"""A restored environment must not publish after its requested input changes."""
import json
from pathlib import Path
import shutil
import zipfile

import pytest
import piwork_web
import piwork_web_dependencies as dependencies


def test_offline_reconstruction_keeps_original_selection_when_input_changes(tmp_path, monkeypatch):
    root = tmp_path / 'app'
    root.mkdir()
    (root / 'app.py').write_text('print("application")\n')
    wheel = root / 'piwork_race_fixture-1.0.0-py3-none-any.whl'
    prefix = 'piwork_race_fixture-1.0.0.dist-info/'
    files = {'piwork_race_fixture.py': 'VERSION="1.0.0"\n',
             prefix + 'METADATA': 'Metadata-Version: 2.1\nName: piwork-race-fixture\nVersion: 1.0.0\n',
             prefix + 'WHEEL': 'Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n'}
    files[prefix + 'RECORD'] = ''.join(name + ',,\n' for name in [*files, prefix + 'RECORD'])
    with zipfile.ZipFile(wheel, 'w') as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    declaration = root / 'requirements.in'
    declaration.write_text(wheel.name + '\n')
    monkeypatch.setenv('PIP_NO_INDEX', '1')
    for name in ['HOME', 'TMPDIR', 'PIP_CACHE_DIR', 'PYTHONNOUSERSITE', 'PIWORK_WEB_APP']:
        monkeypatch.setenv(name, __import__('os').environ.get(name, ''))
    piwork_web.workspace(root)
    dependencies.prepare(root, piwork_web.environment_hash(), allow_install=True)
    state = root / '.deps/active.json'
    previous = state.read_bytes()
    record = json.loads(previous)
    shutil.rmtree(root / record['environmentDirectory'])
    restore = dependencies.installed

    def restore_then_change_input(*args):
        result = restore(*args)
        declaration.write_text('piwork-race-fixture==2.0.0\n')
        return result

    monkeypatch.setattr(dependencies, 'installed', restore_then_change_input)
    with pytest.raises(RuntimeError, match='input changed during offline preparation'):
        dependencies.prepare(root, piwork_web.environment_hash())
    assert state.read_bytes() == previous
    assert (root / 'requirements.lock').read_text() == record['lock']
