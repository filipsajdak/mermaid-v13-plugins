#!/usr/bin/env node
// @ts-check
/**
 * Serves `harness/out` (renders and sheets) on http://127.0.0.1:9238, the port this repo's
 * harness has on the maintainer's machine. Exits when the port is taken; it never stops
 * another server. `PORT` overrides the port.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('./out/', import.meta.url)));
const PORT = Number(process.env['PORT'] ?? 9238);
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (path !== ROOT && !path.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const file = (await stat(path)).isDirectory() ? join(path, 'index.html') : path;
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  })();
});

server.on('error', (e) => {
  process.stderr.write(`Cannot listen on 127.0.0.1:${PORT}: ${e.message}\n`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Serving ${ROOT} on http://127.0.0.1:${PORT}/\n`);
});
