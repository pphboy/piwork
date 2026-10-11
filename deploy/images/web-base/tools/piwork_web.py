"""Checked NiceGUI execution with immutable standard and local extra dependencies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from piwork_web_dependencies import atomic, prepare as prepare_dependencies

BASE = Path('/opt/piwork-web-base')
IGNORED = {'.git', '.venv', '.deps', '.cache', '.build', '.tmp', '.pytest_cache', '__pycache__', 'node_modules', 'dist', 'wheels'}


def digest_tree(root, names=None, strict=False):
    digest = hashlib.sha256()
    if names is not None:
        paths = [root / name for name in sorted(names) if strict or (root / name).is_file()]
    else:
        paths = []
        for directory, dirs, files in os.walk(root):
            dirs[:] = sorted(name for name in dirs if name not in IGNORED)
            for name in sorted(files):
                if name.startswith('.env') or '.checkpoint.' in name or name.endswith(('.pyc', '.log', '.sqlite', '.db', '.pem', '.key')):
                    continue
                paths.append(Path(directory) / name)
    for path in sorted(paths):
        if path.is_symlink():
            raise RuntimeError('Source files must not be symbolic links')
        digest.update(path.relative_to(root).as_posix().encode() + b'\0')
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        digest.update(b'\0')
    return digest.hexdigest()


def environment_hash():
    return hashlib.sha256((BASE / 'environment.json').read_bytes()).hexdigest()


def page_files(root):
    names = {name for name in ['app.py', 'ui.py', 'page-client.js', 'style.css']
             if (root / name).exists() or (root / name).is_symlink()}
    manifest = root / 'page-files.json'
    if manifest.is_symlink():
        raise RuntimeError('Page file manifest must not be a symbolic link')
    if manifest.exists():
        try:
            value = json.loads(manifest.read_text())
        except (OSError, ValueError) as error:
            raise RuntimeError('Invalid page-files.json: expected an object with a files array') from error
        if not isinstance(value, dict) or not isinstance(value.get('files'), list):
            raise RuntimeError('Invalid page-files.json: expected an object with a files array')
        for name in value['files']:
            if not isinstance(name, str) or not name or '\x00' in name:
                raise RuntimeError('Page files must be nonempty relative file paths')
            path = Path(name)
            if path.is_absolute() or '..' in path.parts or not path.parts:
                raise RuntimeError('Page files must stay inside the application: ' + name)
            if any(part in IGNORED or part == 'data' or part.startswith('.env') for part in path.parts):
                raise RuntimeError('Page files must not include data, caches or dependency environments: ' + name)
            if path.name.endswith(('.pyc', '.log', '.sqlite', '.db', '.pem', '.key')) or '.checkpoint.' in path.name:
                raise RuntimeError('Page files must be source or browser resources: ' + name)
            names.add(path.as_posix())
    for name in names:
        path = root
        for part in Path(name).parts:
            path = path / part
            if path.is_symlink():
                raise RuntimeError('Page files must not be symbolic links: ' + name)
        if not path.is_file():
            raise RuntimeError('Declared page file is missing or not a regular file: ' + name)
    return sorted(names)


def version(root):
    root = Path(root).resolve()
    environment = environment_hash()
    locks = digest_tree(root, ['requirements.in', 'requirements.lock'])
    def identity(source):
        return hashlib.sha256(('piwork-nicegui-version-v1\0' + source + '\0' + locks + '\0' + environment).encode()).hexdigest()
    return {'codeVersion': identity(digest_tree(root)),
            'frontendVersion': identity(digest_tree(root, page_files(root), strict=True)),
            'environmentHash': environment}


def write_json(path, value):
    atomic(path, json.dumps(value, sort_keys=True) + '\n')


def workspace(root):
    root = root.resolve()
    if not root.is_relative_to(Path('/var/data/workspace').resolve()):
        raise RuntimeError('Application must be below the granted /var/data/workspace')
    if not (root / 'app.py').is_file():
        raise RuntimeError('Application requires app.py')
    for name in ['.cache/home', '.build', '.tmp']:
        (root / name).mkdir(parents=True, exist_ok=True)
    os.environ.update(HOME=str(root / '.cache/home'), TMPDIR=str(root / '.tmp'),
                      PIP_CACHE_DIR=str(root / '.cache/pip'), PYTHONDONTWRITEBYTECODE='1',
                      PYTHONNOUSERSITE='1', PIWORK_WEB_APP=str(root))
    return root


def prepare(root, install_deps=False):
    started = time.monotonic()
    python, identity = prepare_dependencies(root, environment_hash(), install_deps)
    print('piwork-web: prepare ' + json.dumps({'elapsedMs': round((time.monotonic() - started) * 1000), 'dependencyIdentity': identity}), flush=True)
    return python, identity


def checks_match(root, current):
    path = root / '.build/checks.json'
    try:
        previous = json.loads(path.read_text())
        return previous.get('passed') is True and all(previous.get(k) == v for k, v in current.items())
    except (OSError, ValueError):
        return False


def check(root, python=None):
    python = python or prepare(root)[0]
    before = version(root)
    report = {**before, 'checks': [], 'passed': False}
    target = root / '.build/checks.json'
    write_json(target, report)
    started = time.monotonic()
    try:
        # Compile source without writing bytecode into the app or image.
        for directory, dirs, files in os.walk(root):
            dirs[:] = [name for name in dirs if name not in IGNORED]
            for name in files:
                if name.endswith('.py'):
                    path = Path(directory) / name
                    compile(path.read_bytes(), str(path), 'exec')
        report['checks'].append({'name': 'python-source', 'passed': True})
        tests = list(root.glob('test_*.py')) or list(root.glob('test/**/*.py'))
        if tests:
            subprocess.run([str(python), '-m', 'pytest', '-q'], cwd=root, check=True)
            report['checks'].append({'name': 'application-tests', 'passed': True})
        if before != version(root):
            raise RuntimeError('Source changed during checks; run checks again')
        report['passed'] = True
    finally:
        report['elapsedMs'] = round((time.monotonic() - started) * 1000)
        write_json(target, report)


def serve(root, port, python=None, dev=False):
    python = python or prepare(root)[0]
    current = version(root)
    if not dev and not checks_match(root, current):
        raise RuntimeError('Source or environment differs from the passed checks; run piwork-web run')
    manifest = {**current, 'ready': True}
    write_json(root / '.build/runtime.json', manifest)
    os.environ.update(PIWORK_WEB_RUNTIME_VERSION=json.dumps(manifest), PIWORK_WEB_CODE_VERSION=current['codeVersion'],
                      PIWORK_WEB_PORT=str(port), PIWORK_WEB_DEV='1' if dev else '0',
                      PATH=str(python.parent) + os.pathsep + os.environ.get('PATH', ''))
    os.execv(str(python), [str(python), str(root / 'app.py')])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'check', 'serve', 'run', 'dev'])
    parser.add_argument('--app', default=os.getcwd())
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--install-deps', action='store_true', help='Explicitly acquire missing declared Python dependencies')
    args = parser.parse_args()
    try:
        root = workspace(Path(args.app))
        os.chdir(root)
        python, _ = prepare(root, args.install_deps)
        if args.command == 'prepare':
            return 0
        if args.command == 'check':
            check(root, python)
        elif args.command == 'run':
            if not checks_match(root, version(root)):
                check(root, python)
            serve(root, args.port, python)
        elif args.command == 'serve':
            serve(root, args.port, python)
        elif args.command == 'dev':
            serve(root, args.port, python, dev=True)
    except subprocess.CalledProcessError as error:
        print(f'piwork-web: dependency/check command failed (exit {error.returncode})', file=sys.stderr)
        return 1
    except (OSError, RuntimeError, ValueError, SyntaxError, KeyError) as error:
        print('piwork-web: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
