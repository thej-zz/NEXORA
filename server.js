/* ============================================================
   server.js — serves this site's static files.
   No dependencies: everything here is Node core (http, fs, path).

   LOCAL:   node server.js            -> http://localhost:3000
   RENDER:  Web Service, start command `npm start` (Render sets
            PORT automatically; this reads it from process.env.PORT).

   OPTIONAL HARDENING (Phase 1) — behaviour is otherwise unchanged:
   [a] A malformed URL such as /%E0%A4%A used to throw inside
       decodeURIComponent and crash the whole process. It now returns 400.
   [b] The "stay inside the site root" check compared plain string
       prefixes, so a sibling folder whose name starts with the root's
       name could be read. It now requires a real path boundary.
   [c] Dot-files / dot-folders (.git, .env, ...) are no longer served.
       /.well-known/ is still allowed.
   [d] server.js, package.json, package-lock.json and render.yaml are no
       longer downloadable (nothing on the site requests them).
   [e] A read error on a file can no longer crash the process.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

// [d] project/config files that are not part of the public site
const PRIVATE_FILES = new Set(['/server.js', '/package.json', '/package-lock.json', '/render.yaml']);

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    '<!doctype html><meta charset="utf-8"><title>404</title>' +
    '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0A0C0F;color:#CFCBC3;font-family:sans-serif">' +
    '<p>Page not found. <a href="/" style="color:#8DB8F6">Back home</a></p></body>'
  );
}

const server = http.createServer((req, res) => {
  // [a] never let a bad URL throw
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  // [b] Refuse to serve anything outside the site root (blocks ../ path traversal)
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) { send404(res); return; }

  // [c][d] no hidden files/folders (except /.well-known) and no project/config files
  const rel = '/' + path.relative(ROOT, filePath).split(path.sep).join('/');
  const hidden = rel.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known');
  if (hidden || PRIVATE_FILES.has(rel)) { send404(res); return; }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) { send404(res); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    // [e] a failed read must not become an uncaught exception
    fs.createReadStream(filePath)
      .on('error', () => res.destroy())
      .pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI & DS Association site running at http://localhost:${PORT}`);
});