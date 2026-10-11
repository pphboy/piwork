"""Application-local Python additions to the immutable NiceGUI environment."""
from contextlib import contextmanager
from email.parser import BytesParser
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid
import zipfile

BASE = Path('/opt/piwork-web-base')


def sha(value):
    return hashlib.sha256(value).hexdigest()


def atomic(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(value)
    temporary.replace(path)


def canonical(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def request(root):
    from packaging.requirements import Requirement
    path = root / 'requirements.in'
    lines = [line.strip() for line in path.read_text().splitlines()
             if line.strip() and not line.lstrip().startswith('#')] if path.exists() else []
    inputs = []
    for line in lines:
        wheel = (root / line).resolve()
        if line.endswith('.whl') and wheel.is_file() and wheel.is_relative_to(root):
            inputs.append(line + '\0' + sha(wheel.read_bytes()))
            continue
        try:
            requirement = Requirement(line)
        except Exception as error:
            raise RuntimeError('Extra requirements must be exact package pins or local wheels') from error
        if requirement.url or not re.fullmatch(r'==[^*,\s]+', str(requirement.specifier)):
            raise RuntimeError('Extra requirements must pin an exact version: ' + requirement.name)
        inputs.append(line)
    return lines, sha('\n'.join(inputs).encode())


def pip(python, root, *arguments, offline=False):
    environment = os.environ.copy()
    if offline:
        # A retained lock must not inherit a registry from pip's environment/config.
        for name in ['PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'PIP_FIND_LINKS', 'PIP_TRUSTED_HOST']:
            environment.pop(name, None)
        environment['PIP_NO_INDEX'] = '1'
        environment['PIP_CONFIG_FILE'] = os.devnull
    subprocess.run([str(python), '-m', 'pip', '--disable-pip-version-check', '--retries', '1',
                    '--timeout', '15', *arguments], cwd=root, env=environment, check=True)


def probe(python, packages):
    if not python.is_file():
        return False
    program = ('import importlib.metadata as m,json,sys; expected=json.loads(sys.argv[1]);'
               'sys.exit(0 if all(m.version(k)==v for k,v in expected.items()) else 1)')
    result = subprocess.run([str(python), '-I', '-c', program, json.dumps(packages)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def local_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to((root / '.deps').resolve()):
        raise RuntimeError('Dependency record points outside the application environment')
    return path


def verify_wheels(directory, files):
    for name, digest in files.items():
        if Path(name).name != name or not name.endswith('.whl'):
            raise RuntimeError('Invalid retained wheel identity')
        path = directory / name
        if not path.is_file() or sha(path.read_bytes()) != digest:
            raise RuntimeError('Retained dependency is missing or damaged: ' + name)


def create_environment(root, record, environment_hash, packages):
    if not record['packages']:
        return Path(sys.executable), None
    wheels = local_path(root, record['wheelDirectory'])
    verify_wheels(wheels, record['wheels'])
    identity = sha((environment_hash + '\0' + record['lock']).encode())
    target = root / '.deps/envs' / (identity + '-' + uuid.uuid4().hex)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run([sys.executable, '-m', 'venv', '--without-pip', '--system-site-packages', str(target)],
                       cwd=root, check=True)
        python = target / 'bin/python'
        # Inherit the pinned pip itself. ensurepip would introduce a different
        # local pip version, and global console scripts use the base interpreter.
        for distribution in importlib.metadata.distributions():
            for entry in distribution.entry_points:
                if entry.group != 'console_scripts' or not re.fullmatch(r'[\w.-]+', entry.name):
                    continue
                script = target / 'bin' / entry.name
                script.write_text(f'#!{python}\nfrom importlib.metadata import distribution\nimport sys\n'
                                  f'sys.exit(next(e for e in distribution({distribution.metadata["Name"]!r}).entry_points '
                                  f'if e.group == "console_scripts" and e.name == {entry.name!r}).load()())\n')
                script.chmod(0o755)
        lock = target / 'requirements.lock'
        lock.write_text(record['lock'])
        pip(python, root, 'install', '--no-index', '--require-hashes', '--find-links', str(wheels),
            '--constraint', str(BASE / 'constraints.txt'), '-r', str(lock), offline=True)
        pip(python, root, 'check', offline=True)
        if not probe(python, {**packages, **record['packages']}):
            raise RuntimeError('Installed Python environment does not match its fixed dependencies')
        return python, target.relative_to(root).as_posix()
    except BaseException:
        shutil.rmtree(target, ignore_errors=True)
        raise


def installed(root, record, environment_hash, packages):
    expected = {**packages, **record['packages']}
    if record.get('environmentHash') == environment_hash and record.get('applicationPath') == str(root):
        if record.get('environmentDirectory'):
            python = local_path(root, record['environmentDirectory']) / 'bin/python'
        else:
            python = Path(sys.executable)
        if probe(python, expected):
            return python, record
    python, directory = create_environment(root, record, environment_hash, packages)
    return python, {**record, 'environmentHash': environment_hash, 'environmentDirectory': directory,
                    'applicationPath': str(root)}


def resolve(root, environment_hash, packages, requested_hash):
    artifact = root / '.deps/artifacts' / uuid.uuid4().hex
    wheels = artifact / 'wheels'
    wheels.mkdir(parents=True)
    report = artifact / 'report.json'
    try:
        pip(sys.executable, root, 'install', '--dry-run', '--report', str(report),
            '--constraint', str(BASE / 'constraints.txt'), '-r', str(root / 'requirements.in'))
        planned = json.loads(report.read_text())['install']
        expected = {}
        for item in planned:
            name, version = canonical(item['metadata']['name']), item['metadata']['version']
            if name in packages:
                if version != packages[name]:
                    raise RuntimeError('Extra dependencies conflict with the fixed base: ' + name)
                continue
            expected[name] = version
            source = item['download_info']['url']
            pip(sys.executable, root, 'wheel', '--no-deps', '--wheel-dir', str(wheels), source)
            if source.split('?', 1)[0].endswith('.whl'):
                hashes = item['download_info'].get('archive_info', {}).get('hashes', {})
                if hashes.get('sha256') and not any(sha(p.read_bytes()) == hashes['sha256'] for p in wheels.glob('*.whl')):
                    raise RuntimeError('Downloaded wheel differs from the resolved package identity')
        records, locked = {}, {}
        for wheel in sorted(wheels.glob('*.whl')):
            with zipfile.ZipFile(wheel) as archive:
                names = [name for name in archive.namelist() if name.endswith('.dist-info/METADATA')]
                if len(names) != 1:
                    raise RuntimeError('Invalid wheel metadata')
                metadata = BytesParser().parsebytes(archive.read(names[0]))
            name, version = canonical(metadata['Name']), metadata['Version']
            if expected.get(name) != version or name in locked:
                raise RuntimeError('Wheel does not match the resolved dependencies: ' + name)
            digest = sha(wheel.read_bytes())
            locked[name] = version
            records[wheel.name] = digest
        if locked != expected:
            raise RuntimeError('Resolved dependencies are not fully retained')
        lines = ['# Exact extra dependencies; standard packages are inherited from the fixed base.']
        for wheel_name, digest in records.items():
            with zipfile.ZipFile(wheels / wheel_name) as archive:
                metadata = BytesParser().parsebytes(archive.read(next(n for n in archive.namelist() if n.endswith('.dist-info/METADATA'))))
            lines.append(f"{canonical(metadata['Name'])}=={metadata['Version']} --hash=sha256:{digest}")
        record = {'contractVersion': 1, 'requestedHash': requested_hash, 'environmentHash': environment_hash,
                  'applicationPath': str(root),
                  'packages': locked, 'wheels': records, 'wheelDirectory': wheels.relative_to(root).as_posix(),
                  'lock': '\n'.join(lines) + '\n'}
        python, directory = create_environment(root, record, environment_hash, packages)
        record['environmentDirectory'] = directory
        if request(root)[1] != requested_hash:
            if directory:
                shutil.rmtree(root / directory, ignore_errors=True)
            raise RuntimeError('Dependency declaration changed during preparation; retry the current input')
        (artifact / 'environment.json').write_text(json.dumps(record, sort_keys=True) + '\n')
        return python, record
    except BaseException:
        shutil.rmtree(artifact, ignore_errors=True)
        raise
    finally:
        report.unlink(missing_ok=True)


@contextmanager
def preparation_lock(root):
    (root / '.deps').mkdir(exist_ok=True)
    with (root / '.deps/prepare.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def prepare(root, environment_hash, allow_install=False):
    lines, requested_hash = request(root)
    if not lines:
        # Empty standard applications never copy the base or create a venv.
        return Path(sys.executable), sha(('base\0' + environment_hash).encode())
    packages = json.loads((BASE / 'environment.json').read_text())['packages']
    with preparation_lock(root):
        lines, requested_hash = request(root)
        if not lines:
            return Path(sys.executable), sha(('base\0' + environment_hash).encode())
        state = root / '.deps/active.json'
        record = json.loads(state.read_text()) if state.exists() else None
        lock = root / 'requirements.lock'
        matches = (record and record['requestedHash'] == requested_hash and lock.is_file()
                   and lock.read_text() == record['lock'])
        if matches:
            python, updated = installed(root, record, environment_hash, packages)
            if request(root)[1] != requested_hash or not lock.is_file() or lock.read_text() != record['lock']:
                raise RuntimeError('Dependency input changed during offline preparation; retry the current input')
            if updated != record:
                atomic(state, json.dumps(updated, sort_keys=True) + '\n')
            record = updated
        else:
            if not allow_install:
                raise RuntimeError('Extra dependencies are not prepared for this input; explicitly use --install-deps')
            python, record = resolve(root, environment_hash, packages, requested_hash)
            if request(root)[1] != requested_hash:
                raise RuntimeError('Dependency declaration changed before activation')
            atomic(lock, record['lock'])
            atomic(state, json.dumps(record, sort_keys=True) + '\n')
        identity = sha((environment_hash + '\0' + requested_hash + '\0' + record['lock']).encode())
        return python, identity
