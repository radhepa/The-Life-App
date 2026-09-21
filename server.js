#!/usr/bin/env node
// Tiny local server for Focus — static files (GET) plus a
// POST-to-save endpoint, so the app can write focus-data.json to disk
// without relying on browser storage. Node fallback for server.py.
// Only ever binds to 127.0.0.1 — never reachable from outside this PC.
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.argv[2], 10) || 8765;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html', '.json': 'application/json', '.md': 'text/markdown',
  '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(url.parse(req.url).pathname);
  const name = pathname.replace(/^\/+/, '');

  if (req.method === 'POST') {
    const okName = name && !name.includes('/') && !name.includes('\\') && !name.includes('..');
    const okExt = name.endsWith('.json') || name.endsWith('.md');
    if (!okName || !okExt) { res.writeHead(400); res.end(); return; }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fs.writeFile(path.join(ROOT, name), Buffer.concat(chunks), err => {
        if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
    });
    return;
  }

  const file = name === '' ? 'radhe-labs-focus.html' : name;
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Focus — serving http://127.0.0.1:${PORT}  (Ctrl+C to stop)`);
});
