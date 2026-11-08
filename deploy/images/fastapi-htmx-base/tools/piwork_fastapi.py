"""Check a stable application copy and execute exactly that copy."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

from piwork_web_dependencies import atomic, prepare as prepare_dependencies

BASE = Path('/opt/piwork-web-base')
IGNORED = {'.git', '.deps', '.venv', '.cache', '.build', '.tmp', '.pytest_cache',
           '__pycache__', 'node_modules', 'dist', 'wheels', 'data'}


def files(root):
    result = []
    for directory, dirs, names in os.walk(root, followlinks=False):
        for name in [*dirs, *names]:
            path = Path(directory) / name
            if path.is_symlink():
                raise RuntimeError('Application source must not contain links')
        dirs[:] = sorted(name for name in dirs if name not in IGNORED)
        for name in sorted(names):
            if name.startswith('.env') or '.checkpoint.' in name or name.endswith(('.pyc', '.log', '.sqlite', '.db', '.pem', '.key')):
                continue
            path = Path(directory) / name
            if not path.is_file():
                raise RuntimeError('Source must contain regular files')
            result.append(path.relative_to(root).as_posix())
    return sorted(result)


def digest(root, names):
    value = hashlib.sha256()
    for name in sorted(names):
        value.update(name.encode() + b'\0' + (root / name).read_bytes() + b'\0')
    return value.hexdigest()


def page_files(root):
    manifest = root / 'page-files.json'
    value = json.loads(manifest.read_text()) if manifest.exists() else {
        'files': ['app.py'], 'directories': [name for name in ['templates', 'static'] if (root / name).is_dir()]}
    if not isinstance(value, dict) or not isinstance(value.get('files', []), list) or not isinstance(value.get('directories', []), list):
        raise RuntimeError('Invalid page-files.json')
    names = set()
    for name in [*value.get('files', []), *value.get('directories', [])]:
        if not isinstance(name, str) or not name or Path(name).is_absolute() or '..' in Path(name).parts:
            raise RuntimeError('Page inputs must remain inside the application')
        if any(part in IGNORED or part.startswith('.env') for part in Path(name).parts):
            raise RuntimeError('Page inputs cannot include data or generated material')
        path = root
        for part in Path(name).parts:
            path = path / part
            if path.is_symlink():
                raise RuntimeError('Page inputs cannot be links')
        if name in value.get('directories', []):
            if not path.is_dir():
                raise RuntimeError('Missing page input directory: ' + name)
            names.update((Path(name) / item).as_posix() for item in files(path))
        else:
            if not path.is_file():
                raise RuntimeError('Missing page input: ' + name)
            names.add(Path(name).as_posix())
    return sorted(names)


def version(root):
    root = Path(root).resolve()
    environment = hashlib.sha256((BASE / 'environment.json').read_bytes()).hexdigest()
    locks = digest(root, [name for name in ['requirements.in', 'requirements.lock'] if (root / name).exists()])
    def identity(value):
        return hashlib.sha256(('piwork-fastapi-version-v1\0' + value + '\0' + locks + '\0' + environment).encode()).hexdigest()
    return {'codeVersion': identity(digest(root, files(root))),
            'frontendVersion': identity(digest(root, page_files(root))), 'environmentHash': environment}


def workspace(root):
    root = root.resolve()
    if not root.is_relative_to(Path('/var/data/workspace').resolve()) or not (root / 'app.py').is_file():
        raise RuntimeError('Application requires app.py below the granted workspace')
    for name in ['.cache/home', '.build/releases', '.tmp']:
        (root / name).mkdir(parents=True, exist_ok=True)
    os.environ.update(HOME=str(root / '.cache/home'), TMPDIR=str(root / '.tmp'),
                      PIP_CACHE_DIR=str(root / '.cache/pip'), PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1')
    return root


@contextmanager
def application_lock(root):
    (root / '.build').mkdir(exist_ok=True)
    with (root / '.build/prepare.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def verified(release, current):
    try:
        if release.is_symlink():
            return False
        record = json.loads((release / '.build/checks.json').read_text())
        if not isinstance(record, dict):
            return False
        return record.get('passed') is True and record.get('version') == current and version(release) == current
    except (OSError, ValueError, RuntimeError):
        return False


def checked_release(root, current):
    releases = root / '.build/releases'
    try:
        record = json.loads((root / '.build/checks.json').read_text())
        if not isinstance(record, dict):
            record = {}
        name = record.get('release')
        if (record.get('passed') is True and all(record.get(key) == value for key, value in current.items())
                and isinstance(name, str) and Path(name).name == name and name.startswith(current['codeVersion'])
                and verified(releases / name, current)):
            return releases / name
    except (OSError, ValueError, TypeError):
        pass
    original = releases / current['codeVersion']
    return original if verified(original, current) else None


def run_checks(release, python, current):
    report = {'version': current, 'passed': False}
    (release / '.build').mkdir(exist_ok=True)
    try:
        for name in files(release):
            if name.endswith('.py'):
                compile((release / name).read_bytes(), name, 'exec')
        # Parse all templates, including includes not yet requested by a browser.
        subprocess.run([str(python), '-c',
                        'from jinja2 import Environment,FileSystemLoader;from pathlib import Path;'
                        'p=Path("templates");e=Environment(loader=FileSystemLoader(p));'
                        '[e.get_template(n) for n in e.list_templates()] if p.exists() else None'], cwd=release, check=True)
        targets = sorted(release.glob('test_*.py'))
        targets += [release / name for name in ['test', 'tests'] if (release / name).is_dir()]
        if targets:
            subprocess.run([str(python), '-m', 'pytest', '-q', '-p', 'no:cacheprovider', *map(str, targets)],
                           cwd=release, check=True)
        if version(release) != current:
            raise RuntimeError('Application changed during checks')
        report['passed'] = True
    finally:
        atomic(release / '.build/checks.json', json.dumps(report) + '\n')


def prepare(root, install=False, checks=True):
    with application_lock(root):
        environment = hashlib.sha256((BASE / 'environment.json').read_bytes()).hexdigest()
        python, dependency = prepare_dependencies(root, environment, install)
        current = version(root)
        target = root / '.build/releases' / current['codeVersion']
        existing = checked_release(root, current) if checks else None
        if existing is not None:
            atomic(root / '.build/checks.json', json.dumps({**current, 'passed': True, 'release': existing.name}) + '\n')
            return python, existing, current, dependency
        if not checks:
            return python, None, current, dependency
        candidate = root / '.build/releases' / ('candidate-' + uuid.uuid4().hex)
        candidate.mkdir(parents=True)
        try:
            for name in files(root):
                destination = candidate / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(root / name, destination)
            if version(candidate) != current or version(root) != current:
                raise RuntimeError('Source changed while preparing the checked copy')
            run_checks(candidate, python, current)
            if version(root) != current:
                raise RuntimeError('Source changed during preparation; retry current input')
            if target.exists():
                # A damaged published copy may still be in use. Never overwrite it.
                target = target.with_name(target.name + '-' + uuid.uuid4().hex)
            candidate.rename(target)
            atomic(root / '.build/checks.json', json.dumps({**current, 'passed': True, 'release': target.name}) + '\n')
            return python, target, current, dependency
        finally:
            if candidate.exists():
                shutil.rmtree(candidate)


def serve(root, python, release, current, dependency, port):
    with application_lock(root):
        if version(root) != current or not verified(release, current):
            raise RuntimeError('Source differs from its checked startup version')
        record = {**current, 'release': release.name, 'dependencyIdentity': dependency,
                  'python': str(python), 'applicationPath': str(root)}
        path = root / '.build/runtime.json'
        if path.exists():
            atomic(root / '.build/previous.json', path.read_text())
        atomic(path, json.dumps(record) + '\n')
        os.environ.update(PIWORK_FASTAPI_VERSION=json.dumps(current), PIWORK_FASTAPI_APP=str(root),
                          PIWORK_WEB_CODE_VERSION=current['codeVersion'], PIWORK_WEB_PORT=str(port),
                          PATH=str(python.parent) + os.pathsep + os.environ.get('PATH', ''))
    os.chdir(release)
    os.execv(str(python), [str(python), str(release / 'app.py')])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'check', 'run', 'serve'])
    parser.add_argument('--app', default=os.getcwd())
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--install-deps', action='store_true')
    args = parser.parse_args()
    try:
        root = workspace(Path(args.app))
        python, release, current, dependency = prepare(root, args.install_deps, args.command not in ['prepare', 'serve'])
        if args.command == 'serve':
            release = checked_release(root, current)
            if release is None:
                raise RuntimeError('No passed checks for this input; use run or check first')
        if args.command in ['run', 'serve']:
            serve(root, python, release, current, dependency, args.port)
        print(json.dumps({'passed': True, **current, 'release': str(release) if release else None}))
    except (OSError, ValueError, RuntimeError, SyntaxError, subprocess.CalledProcessError) as error:
        print('piwork-fastapi: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
