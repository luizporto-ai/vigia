/**
 * Minimal static file server so render probes can point a real browser at a
 * local build directory (dist/, build/, out/). Zero dependencies.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export async function serveDir(dir) {
  const root = path.resolve(dir);

  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let filePath = path.join(root, urlPath);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      let s = await stat(filePath).catch(() => null);
      if (s && s.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        s = await stat(filePath).catch(() => null);
      }
      if (!s) {
        // SPA-style clean-URL fallback: try `${path}.html`, else 404.
        const htmlTry = filePath.replace(/\/$/, '') + '.html';
        s = await stat(htmlTry).catch(() => null);
        if (s) filePath = htmlTry;
      }
      if (!s) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err.message));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}
