#!/usr/bin/env python3
"""Select one new Core boot's safe startup metrics from an exported log ZIP."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = (ROOT / 'dist').resolve()
SHARD = re.compile(r'^core-([a-f0-9]{32})-[0-9]{8}\.jsonl$')
PHASES = {'image-export', 'image-scan', 'environment-probe-execute',
          'agent-image-persistent-hit', 'file-image-persistent-hit',
          'snapshot-image-persistent-hit', 'environment-persistent-hit',
          'startup-docker', 'work-verification'}
MAX_SHARD = 16 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024


def in_dist(value):
    path = pathlib.Path(value).resolve()
    if path == DIST or not path.is_relative_to(DIST):
        raise ValueError('acceptance files must be inside dist')
    return path


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        json.dump(value, output, sort_keys=True)
        output.write('\n')


def read_archive(path):
    boots, events, listening = set(), {}, {}
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or names.count('manifest.json') != 1:
            raise ValueError('duplicate or missing ZIP entries')
        manifest_entry = archive.getinfo('manifest.json')
        if manifest_entry.file_size > 2 * 1024 * 1024:
            raise ValueError('export manifest is too large')
        manifest = json.loads(archive.read(manifest_entry))
        core = manifest.get('core') or {}
        files = core.get('files')
        if not core.get('includeCoreLogs') or core.get('partial') or not isinstance(files, list) or not files:
            raise ValueError('export lacks complete Core logs')
        seen, total = set(), 0
        for entry in files:
            name = entry.get('name', '')
            match = SHARD.fullmatch(name)
            if not match or name in seen or entry.get('partial'):
                raise ValueError('invalid, duplicate or partial Core shard')
            seen.add(name)
            expected_size, expected_hash = entry.get('size'), entry.get('digest')
            if not isinstance(expected_size, int) or not 0 <= expected_size <= MAX_SHARD or not re.fullmatch(r'[a-f0-9]{64}', str(expected_hash)):
                raise ValueError('invalid Core shard identity')
            total += expected_size
            if total > MAX_TOTAL:
                raise ValueError('Core log export is too large')
            info = archive.getinfo('core/' + name)
            if info.file_size != expected_size:
                raise ValueError('Core shard size differs from manifest')
            content = archive.read(info)
            if hashlib.sha256(content).hexdigest() != expected_hash:
                raise ValueError('Core shard digest differs from manifest')
            boot = match.group(1)
            boots.add(boot)
            for line in content.splitlines():
                record = json.loads(line)
                if record.get('bootId') != boot:
                    raise ValueError('Core shard mixes boot identities')
                if record.get('event') == 'app.listening':
                    listening[boot] = listening.get(boot, 0) + 1
                fields = record.get('fields')
                if not isinstance(fields, dict):
                    continue
                phase, outcome = fields.get('phase'), fields.get('outcome')
                if phase in PHASES and record.get('event') == 'performance.' + phase and outcome in ('started', 'succeeded', 'failed', 'cancelled'):
                    events.setdefault(boot, []).append({'event': 'performance', 'phase': phase, 'outcome': outcome})
        if {name for name in names if name.startswith('core/')} != {'core/' + name for name in seen}:
            raise ValueError('Core ZIP entries differ from manifest')
    return boots, events, listening


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    baseline = sub.add_parser('baseline')
    baseline.add_argument('--archive', required=True)
    baseline.add_argument('--index', required=True)
    extract = sub.add_parser('extract')
    extract.add_argument('--archive', required=True)
    extract.add_argument('--baseline', required=True)
    extract.add_argument('--index', required=True)
    extract.add_argument('--output', required=True)
    args = parser.parse_args()
    boots, events, listening = read_archive(in_dist(args.archive))
    index = {'version': 1, 'bootIds': sorted(boots)}
    if args.command == 'baseline':
        write_new(in_dist(args.index), index)
        print('baseline recorded')
        return
    previous = json.loads(in_dist(args.baseline).read_text(encoding='utf-8'))
    ids = previous.get('bootIds')
    if previous.get('version') != 1 or not isinstance(ids, list) or not ids or any(not re.fullmatch(r'[a-f0-9]{32}', str(value)) for value in ids) or len(set(ids)) != len(ids):
        raise ValueError('invalid baseline boot index')
    added = boots.difference(ids)
    if len(added) != 1:
        raise ValueError('expected exactly one new Core boot')
    boot = added.pop()
    if listening.get(boot) != 1 or not events.get(boot):
        raise ValueError('new Core boot lacks listening or performance evidence')
    output = in_dist(args.output)
    if not output.is_file() or output.stat().st_size != 0:
        raise ValueError('observer log must be a new, empty file')
    write_new(in_dist(args.index), index)
    with output.open('a', encoding='utf-8') as stream:
        for event in events[boot]:
            stream.write(json.dumps(event, separators=(',', ':')) + '\n')
        stream.flush()
    print('one new Core boot selected')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print('startup log evidence unavailable: ' + str(error), file=sys.stderr)
        sys.exit(1)
