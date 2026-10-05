import contextlib, json, os, pathlib, selectors, socket, subprocess, sys, tempfile, threading
REPO = '/home/p/Projects/piwork__worktrees/windows-support'
def relay(a, b):
    with contextlib.closing(a), contextlib.closing(b), selectors.DefaultSelector() as sel:
        a.setblocking(False); b.setblocking(False)
        sel.register(a, selectors.EVENT_READ, b); sel.register(b, selectors.EVENT_READ, a)
        while True:
            ready = sel.select(30)
            if not ready: return
            for key, _ in ready:
                try:
                    data = key.fileobj.recv(65536)
                    if not data: return
                    target = key.data; target.setblocking(True); target.settimeout(10)
                    target.sendall(data); target.setblocking(False)
                except OSError: return

def serve(listener, upstream):
    while True:
        try: a, _ = listener.accept()
        except OSError: return
        try: b = upstream()
        except OSError: a.close(); continue
        threading.Thread(target=relay, args=(a,b), daemon=True).start()

def unix_client(path):
    b=socket.socket(socket.AF_UNIX); b.connect(path); return b

if len(sys.argv) > 1 and sys.argv[1] == '--inner':
    subprocess.run(['/usr/sbin/ip','link','set','lo','up'], check=True)
    listener = socket.socket(); listener.bind(('127.0.0.1',7171)); listener.listen()
    threading.Thread(target=serve, args=(listener, lambda: unix_client(sys.argv[2])), daemon=True).start()
    p = subprocess.run(['/tmp/piwork-http-native-check-20261006','--build',REPO+'/dist/cli/linux-amd64','--root',REPO,'--http-core','http://127.0.0.1:7171'], cwd='/tmp', capture_output=True, text=True, timeout=100)
    sys.stdout.write(p.stdout); sys.stderr.write(p.stderr); sys.exit(p.returncode)
else:
    with tempfile.TemporaryDirectory(prefix='piwork-http-netns-') as directory:
        path = directory+'/core.sock'
        with socket.socket(socket.AF_UNIX) as listener:
            listener.bind(path); listener.listen()
            threading.Thread(target=serve, args=(listener, lambda: socket.create_connection(('127.0.0.1',7171),10)), daemon=True).start()
            p = subprocess.run(['unshare','-Urn',sys.executable,__file__,'--inner',path], capture_output=True,text=True,timeout=110)
            if p.returncode:
                sys.stderr.write(p.stderr); sys.stdout.write(p.stdout); sys.exit(p.returncode)
            result = json.loads(p.stdout)
            result['executionContext'] = {'date':'2026-10-06','os':'Linux WSL2','networkIsolation':'unshare -Urn; loopback enabled','coreTransport':'temporary raw TCP relay through a private Unix socket to the existing host Core at 127.0.0.1:7171; no Core deployment or protocol rewriting','candidate':'dist/cli/linux-amd64/piwork-cli','originalDesktopPreserved':True}
            print(json.dumps(result,ensure_ascii=False,indent=2))
