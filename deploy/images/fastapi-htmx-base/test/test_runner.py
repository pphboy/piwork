import json
from pathlib import Path
import pytest
import subprocess
from piwork_fastapi import prepare, version, verified, page_files, checked_release
import piwork_fastapi
from concurrent.futures import ThreadPoolExecutor


def source(tmp_path):
    root = tmp_path / 'app'
    root.mkdir()
    (root / 'app.py').write_text('print("original")\n')
    (root / 'business.py').write_text('VALUE = 1\n')
    (root / 'templates').mkdir()
    (root / 'static').mkdir()
    (root / 'templates/page.html').write_text('<h1>{{ value }}</h1>')
    (root / 'static/style.css').write_text('body { color: black; }')
    (root / 'page-files.json').write_text(json.dumps({'files': ['app.py'], 'directories': ['templates', 'static']}))
    return root


def test_checked_copy_stays_fixed_and_inputs_change_the_right_identity(tmp_path):
    root = source(tmp_path)
    python, release, first, dependency = prepare(root)
    assert verified(release, first)
    assert prepare(root)[1] == release
    (root / 'business.py').write_text('VALUE = 2\n')
    assert version(root)['codeVersion'] != first['codeVersion']
    assert version(root)['frontendVersion'] == first['frontendVersion']
    assert 'VALUE = 1' in (release / 'business.py').read_text()
    (root / 'templates/late.html').write_text('<p>new</p>')
    assert version(root)['frontendVersion'] != first['frontendVersion']
    assert not (release / 'templates/late.html').exists()
    (release / 'business.py').write_text('damaged')
    assert not verified(release, first)


def test_failed_tests_directory_and_template_block_release(tmp_path):
    root = source(tmp_path)
    (root / 'tests').mkdir()
    (root / 'tests/test_failure.py').write_text('def test_failure(): assert False\n')
    with pytest.raises(subprocess.CalledProcessError):
        prepare(root)
    assert not list((root / '.build/releases').glob('[a-f0-9]' * 64))
    (root / 'tests/test_failure.py').unlink()
    (root / 'templates/page.html').write_text('{% invalid %}')
    with pytest.raises(subprocess.CalledProcessError):
        prepare(root)


def test_page_paths_cannot_escape_or_silently_disappear(tmp_path):
    root = source(tmp_path)
    for value in [{'files': ['../outside']}, {'files': ['missing.html']}, {'directories': ['data']}]:
        (root / 'page-files.json').write_text(json.dumps(value))
        with pytest.raises(RuntimeError):
            page_files(root)


def test_parallel_preparation_publishes_one_copy(tmp_path):
    root = source(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: prepare(root), range(2)))
    assert results[0][1] == results[1][1]
    assert len(list((root / '.build/releases').iterdir())) == 1


def test_working_source_change_during_checks_cannot_activate(tmp_path, monkeypatch):
    root = source(tmp_path)
    original = piwork_fastapi.run_checks

    def check_then_edit(*args):
        original(*args)
        (root / 'business.py').write_text('VALUE = 3\n')

    monkeypatch.setattr(piwork_fastapi, 'run_checks', check_then_edit)
    with pytest.raises(RuntimeError, match='Source changed during preparation'):
        prepare(root)
    assert not (root / '.build/checks.json').exists()
    assert not list((root / '.build/releases').iterdir())


def test_repaired_copy_is_reused_instead_of_rechecking_broken_original(tmp_path, monkeypatch):
    root = source(tmp_path)
    _, broken, current, _ = prepare(root)
    (broken / 'business.py').write_text('damaged\n')
    _, repaired, second_version, _ = prepare(root)
    assert repaired != broken
    assert second_version == current
    assert checked_release(root, current) == repaired

    def unexpected_check(*_args):
        pytest.fail('Identical checked inputs must reuse the repaired copy')

    monkeypatch.setattr(piwork_fastapi, 'run_checks', unexpected_check)
    assert prepare(root)[1] == repaired
    assert len(list((root / '.build/releases').iterdir())) == 2
    assert (broken / 'business.py').read_text() == 'damaged\n'


def test_bad_release_pointer_is_not_trusted(tmp_path):
    root = source(tmp_path)
    _, original, current, _ = prepare(root)
    record = root / '.build/checks.json'
    for name in ['../outside', '/outside', current['codeVersion'] + '/nested']:
        record.write_text(json.dumps({**current, 'passed': True, 'release': name}))
        assert checked_release(root, current) == original
    target = root / '.build/releases' / (current['codeVersion'] + '-link')
    target.symlink_to(original, target_is_directory=True)
    record.write_text(json.dumps({**current, 'passed': True, 'release': target.name}))
    assert checked_release(root, current) == original
    record.write_text('[]')
    assert checked_release(root, current) == original
