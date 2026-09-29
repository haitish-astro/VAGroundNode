// Static file server for local demos. Serves only the app's own files (no dotfiles, tests, server or package files).
//   npm start                 -> http://localhost:8123
//   PORT=9000 HOST=0.0.0.0 npm start   (HOST=0.0.0.0 exposes it to your network; default is this computer only)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8123;
const HOST = process.env.HOST || 'localhost';
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const BLOCKED_FILES = new Set(['serve.js', 'package.json', 'package-lock.json']);

// Map a URL to a file path inside ROOT, or return null when it must not be served.
function resolve(rawUrl) {
  let pathname;
  try { pathname = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]); } catch (e) { return null; }
  if (pathname.includes('\0')) return null;
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  const rel = path.relative(ROOT, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.some(p => p.startsWith('.'))) return null;                         // .git, .claude, .gitignore
  if (parts[0] === 'node_modules' && !(parts[1] === 'three')) return null;     // only the pinned 3D library
  if (parts[0] === 'tests') return null;
  if (parts.length === 1 && (BLOCKED_FILES.has(parts[0]) || /\.test\.js$/.test(parts[0]))) return null;
  if (!TYPES[path.extname(file).toLowerCase()]) return null;
  return file;
}

const server = http.createServer((req, res) => {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); res.end(); return; }
  const file = resolve(req.url || '/');
  if (!file) { res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const type = TYPES[path.extname(file).toLowerCase()];
    const h = { ...headers, 'Content-Type': type, 'Content-Length': stat.size, ETag: etag, 'Cache-Control': 'no-cache' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); res.end(); return; }
    res.writeHead(200, h);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
});

if (require.main === module) {
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Close the other server or run with PORT=<another port>.`);
    else console.error(err.message);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => console.log(`Vahnim is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
}
module.exports = { resolve, server };
