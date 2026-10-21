import { createServer, request } from 'node:http';
import { connect } from 'node:net';

// Application fixture only. Production routing is exercised by Core/CLI tests
// and the unified-installation acceptance driver, not this synthetic proxy.
export async function prefixFixture(upstream) {
  const target = new URL(upstream);
  const prefix = '/services/work-prefix-fixture/service-template/8080';
  const sockets = new Set();
  const parse = req => req.url.startsWith(prefix + '/') ? req.url.slice(prefix.length) : null;
  const headers = req => ({ ...req.headers, host: target.host, 'x-forwarded-prefix': prefix, 'x-piwork-app-session': 'a'.repeat(64) });
  const server = createServer((req, res) => {
    const path = parse(req);
    if (!path) { res.writeHead(404); res.end(); return; }
    const proxy = request({ hostname: target.hostname, port: target.port, path, method: req.method, headers: headers(req) }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(proxy);
    res.on('close', () => proxy.destroy());
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    const path = parse(req);
    if (!path) { socket.destroy(); return; }
    const remote = connect(Number(target.port), target.hostname, () => {
      remote.write(`${req.method} ${path} HTTP/1.1\r\n${Object.entries(headers(req)).map(([name,value])=>`${name}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
    });
    sockets.add(remote);
    remote.on('error', () => socket.destroy());
    remote.on('close', () => { sockets.delete(remote); socket.destroy(); });
    socket.on('close', () => remote.destroy());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, prefix, url: origin + prefix + '/', close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  } };
}
