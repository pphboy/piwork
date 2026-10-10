"""Locked, workspace-local preparation and execution for Piwork Web applications."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

BASE = Path('/opt/piwork-web-base')
IGNORED = {'.git', '.venv', '.cache', '.build', '.tmp', '.pytest_cache', '__pycache__', 'node_modules', 'dist', 'wheels'}


def digest_tree(root):
    digest = hashlib.sha256()
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(name for name in dirs if name not in IGNORED)
        for name in sorted(files):
            if name.startswith('.env') or '.checkpoint.' in name or name.endswith(('.pyc', '.log', '.sqlite', '.db', '.pem', '.key')):
                continue
            path = Path(directory) / name
            if path.is_symlink():
                raise RuntimeError('Source files must not be symbolic links')
            digest.update(str(path.relative_to(root)).encode() + b'\0')
            with path.open('rb') as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            digest.update(b'\0')
    return digest.hexdigest()


def environment_hash():
    return hashlib.sha256((BASE / 'environment.json').read_bytes()).hexdigest()


def version(root):
    environment = environment_hash()
    def identity(source):
        return hashlib.sha256(('piwork-web-version-v2\0' + source + '\0' + environment).encode()).hexdigest()
    return {'codeVersion': identity(digest_tree(root)), 'frontendVersion': identity(digest_tree(root / 'frontend')),
            'environmentHash': environment}


def write_json(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, sort_keys=True) + '\n')
    temporary.replace(path)


def workspace(root):
    root = root.resolve()
    if not root.is_relative_to(Path('/var/data/workspace').resolve()):
        raise RuntimeError('Application must be below the granted /var/data/workspace')
    if not (root / 'frontend/package-lock.json').is_file():
        raise RuntimeError('Application requires frontend/package-lock.json')
    for name in ['.cache', '.build', '.tmp', '.cache/home']:
        (root / name).mkdir(parents=True, exist_ok=True)
    os.environ.update(HOME=str(root / '.cache/home'), TMPDIR=str(root / '.tmp'),
                      npm_config_cache=str(root / '.cache/npm'), PYTHONDONTWRITEBYTECODE='1',
                      PYTHONPYCACHEPREFIX=str(root / '.cache/python'), PIWORK_WEB_APP=str(root))
    return root


def execute(root, arguments, cwd=None):
    subprocess.run(arguments, cwd=cwd or root, check=True)


def prepare(root):
    lock = root / 'requirements.lock'
    if not lock.exists():
        raise RuntimeError('Application requires a hash-locked requirements.lock')
    fingerprint = hashlib.sha256(lock.read_bytes() + (root / 'frontend/package-lock.json').read_bytes()
                                 + environment_hash().encode()).hexdigest()
    stamp = root / '.build/dependencies.json'
    if stamp.exists() and json.loads(stamp.read_text()).get('fingerprint') == fingerprint and (root / '.venv/bin/python').exists() and (root / 'frontend/node_modules').is_dir():
        return
    backup = root / '.build' / ('dependencies-' + uuid.uuid4().hex)
    backup.mkdir()
    targets = [(root / '.venv', backup / 'venv'), (root / 'frontend/node_modules', backup / 'node_modules')]
    for target, saved in targets:
        if target.exists():
            target.rename(saved)
    try:
        execute(root, [sys.executable, '-m', 'venv', '.venv'])
        execute(root, [str(root / '.venv/bin/python'), '-m', 'pip', 'install', '--no-index',
                       '--find-links', str(BASE / 'wheels'), '--require-hashes', '-r', str(lock)])
        cache = root / '.cache/npm'
        shutil.copytree(BASE / 'npm-cache', cache, dirs_exist_ok=True)
        execute(root, ['npm', 'ci', '--offline', '--no-audit', '--no-fund'], root / 'frontend')
        write_json(stamp, {'fingerprint': fingerprint})
    except BaseException:
        for target, saved in targets:
            shutil.rmtree(target, ignore_errors=True)
            if saved.exists():
                saved.rename(target)
        raise
    finally:
        shutil.rmtree(backup, ignore_errors=True)


def check(root):
    prepare(root)
    before = version(root)
    report = {**before, 'checks': [], 'passed': False}
    target = root / '.build/checks.json'
    write_json(target, report)
    commands = [('backend', [str(root / '.venv/bin/python'), '-m', 'pytest', '-q'], root),
                ('frontend', ['npm', 'run', 'check'], root / 'frontend')]
    try:
        for name, command, directory in commands:
            execute(root, command, directory)
            report['checks'].append({'name': name, 'passed': True})
        if before != version(root):
            raise RuntimeError('Source changed during checks; run checks again')
        report['passed'] = True
    finally:
        write_json(target, report)


def build(root):
    prepare(root)
    current = version(root)
    checks = root / '.build/checks.json'
    if not checks.exists() or not json.loads(checks.read_text()).get('passed') or any(json.loads(checks.read_text()).get(k) != v for k, v in current.items()):
        check(root)
    current = version(root)
    output = root / '.build' / ('frontend-' + uuid.uuid4().hex)
    os.environ['PIWORK_WEB_FRONTEND_VERSION'] = current['frontendVersion']
    execute(root, ['npm', 'run', 'build', '--', '--outDir', str(output)], root / 'frontend')
    if not (output / 'index.html').exists() or current != version(root):
        raise RuntimeError('Build incomplete or source changed during build')
    destination = root / 'frontend/dist'
    previous = root / '.build/previous-dist'
    shutil.rmtree(previous, ignore_errors=True)
    if destination.exists():
        destination.rename(previous)
    output.rename(destination)
    write_json(root / '.build/runtime.json', {**current, 'ready': True})
    shutil.rmtree(previous, ignore_errors=True)


def serve(root, port):
    manifest = json.loads((root / '.build/runtime.json').read_text())
    if any(manifest.get(k) != v for k, v in version(root).items()) or not manifest.get('ready'):
        raise RuntimeError('Source differs from the checked build; run piwork-web run')
    os.environ['PIWORK_WEB_RUNTIME_VERSION'] = json.dumps(manifest)
    os.environ['PIWORK_WEB_CODE_VERSION'] = manifest['codeVersion']
    os.execv(str(root / '.venv/bin/python'), [str(root / '.venv/bin/python'), '-m', 'uvicorn',
               'app:app', '--host', '0.0.0.0', '--port', str(port), '--no-server-header'])


def dev(root, port):
    prepare(root)
    identity = json.loads(Path('/etc/piwork/interaction/config.json').read_text())
    service_host = 'svc-' + identity['serviceName']
    os.environ.update(PIWORK_WEB_DEV='1', PIWORK_WEB_BACKEND='http://127.0.0.1:8000',
                      PIWORK_WEB_FRONTEND_VERSION=version(root)['frontendVersion'],
                      PIWORK_WEB_ALLOWED_HOSTS=service_host)
    processes = []
    def stop(_signal=None, _frame=None):
        for process in processes:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        processes.append(subprocess.Popen([str(root / '.venv/bin/python'), '-m', 'uvicorn', 'app:app',
              '--host', '127.0.0.1', '--port', '8000', '--reload', '--reload-dir', str(root),
              '--reload-exclude', '.venv/*', '--reload-exclude', 'frontend/*',
              '--reload-exclude', '.cache/*', '--reload-exclude', '.build/*'], cwd=root, start_new_session=True))
        processes.append(subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(port)], cwd=root / 'frontend', start_new_session=True))
        while all(p.poll() is None for p in processes):
            time.sleep(.2)
    finally:
        stop()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    return max((p.returncode or 0) for p in processes)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'check', 'build', 'serve', 'run', 'dev'])
    parser.add_argument('--app', default=os.getcwd())
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    try:
        root = workspace(Path(args.app))
        os.chdir(root)
        if args.command == 'run':
            check(root)
            build(root)
            serve(root, args.port)
        elif args.command in ['serve', 'dev']:
            return globals()[args.command](root, args.port)
        else:
            globals()[args.command](root)
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print('piwork-web: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
