"""Bind the installed base environment to its exact build inputs."""
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys

root = Path('/opt/piwork-web-base')
value = json.loads((root / 'environment.json').read_text())
value.update(inputHash=os.environ['PIWORK_WEB_INPUT_HASH'],
             pythonVersion='.'.join(map(str, sys.version_info[:3])),
             packages={re.sub(r'[-_.]+', '-', item.metadata['Name']).lower(): item.version
                       for item in importlib.metadata.distributions()})
for name in ['nicegui', 'pip']:
    if value[name + 'Version'] != value['packages'][name]:
        raise RuntimeError('Installed ' + name + ' does not match the declared environment')
(root / 'constraints.txt').write_text(''.join(name + '==' + version + '\n'
                                            for name, version in sorted(value['packages'].items())))
(root / 'environment.json').write_text(json.dumps(value, sort_keys=True) + '\n')
