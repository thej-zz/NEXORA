/* ============================================================
   server.js — serves this site's static files.
   No dependencies: everything here is Node core (http, fs, path).

   LOCAL:   node server.js            -> http://localhost:3000
   RENDER:  Web Service, start command `npm start` (Render sets
            PORT automatically; this reads it from process.env.PORT).
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

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    '<!doctype html><meta charset="utf-8"><title>404</title>' +
    '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#05070A;color:#C7D0E0;font-family:sans-serif">' +
    '<p>Page not found. <a href="/" style="color:#6FD8FF">Back home</a></p></body>'
  );
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  // Refuse to serve anything outside the site root (blocks ../ path traversal)
  if (!filePath.startsWith(ROOT)) { send404(res); return; }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) { send404(res); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI & DS Association site running at http://localhost:${PORT}`);
});
