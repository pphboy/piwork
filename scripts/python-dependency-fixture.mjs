// Controlled package registry for real Core/Service dependency-install acceptance.
export const pythonDependencyRegistryProgram = `from pathlib import Path
from http.server import HTTPServer,SimpleHTTPRequestHandler
import hashlib,json,os,zipfile
root=Path('/var/data/workspace/data/python-registry');root.mkdir(parents=True,exist_ok=True)
prefix='piwork_extra_fixture-1.0.0.dist-info/'
files={'piwork_extra_fixture.py':'VERSION="1.0.0"\\ndef main(): print("console-extra:"+VERSION)\\n',prefix+'METADATA':'Metadata-Version: 2.1\\nName: piwork-extra-fixture\\nVersion: 1.0.0\\n',prefix+'WHEEL':'Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n',prefix+'entry_points.txt':'[console_scripts]\\npiwork-extra-probe = piwork_extra_fixture:main\\n'}
files[prefix+'RECORD']=''.join(name+',,\\n' for name in [*files,prefix+'RECORD'])
wheel=root/'piwork_extra_fixture-1.0.0-py3-none-any.whl'
with zipfile.ZipFile(wheel,'w') as archive:
 for name,value in files.items():archive.writestr(name,value)
simple=root/'simple/piwork-extra-fixture';simple.mkdir(parents=True,exist_ok=True)
digest=hashlib.sha256(wheel.read_bytes()).hexdigest()
(simple/'index.html').write_text('<a href="../../'+wheel.name+'#sha256='+digest+'">'+wheel.name+'</a>')
os.chdir(root)
class Handler(SimpleHTTPRequestHandler):
 def do_GET(self):
  if self.path=='/health':
   self.send_response(200);self.end_headers();self.wfile.write(b'{"ready":true}')
  else:super().do_GET()
HTTPServer(('0.0.0.0',8095),Handler).serve_forever()
`;
