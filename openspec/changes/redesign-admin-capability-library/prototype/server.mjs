// Disposable prototype server. Serves only this directory's explicit assets.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([
  ['/prototype.css', ['prototype.css', 'text/css; charset=utf-8']],
  ['/tokens.css', ['tokens.css', 'text/css; charset=utf-8']],
  ['/prototype.mjs', ['prototype.mjs', 'text/javascript; charset=utf-8']],
  ['/piwork-logo.png', ['piwork-logo.png', 'image/png']],
]);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://prototype.local').pathname;
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  if (path === '/') { response.writeHead(302, { Location: '/admin/packages?v=6' }); response.end(); return; }
  const file = files.get(path) || (path === '/admin/packages' || /^\/admin\/operations\/prototype-[a-z0-9-]+$/.test(path) ? ['index.html', 'text/html; charset=utf-8'] : null);
  if (!file) { response.writeHead(404); response.end('Prototype route not found'); return; }
  try {
    const data = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'" });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(500); response.end('Prototype asset unavailable'); }
});
server.listen(18744, '100.64.0.7', () => process.stdout.write('Prototype ready: http://100.64.0.7:18744/admin/packages?v=6\n'));
