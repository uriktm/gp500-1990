import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoomHandler } from './api/room.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = __dirname;

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/**
 * Creates a zero-dependency Node HTTP server serving the GP500 '90 directory
 * and the /api/room WebRTC signaling endpoint.
 * @param {string} [rootDir=ROOT_DIR]
 * @param {object} [options]
 * @returns {import('node:http').Server}
 */
export function createServer(rootDir = ROOT_DIR, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const roomHandler = options.roomHandler || createRoomHandler();

  return http.createServer(async (req, res) => {
    try {
      const method = (req.method || 'GET').toUpperCase();
      const rawUrl = req.url || '/';
      let cleanUrl;
      try {
        cleanUrl = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('400 Bad Request');
        return;
      }

      if (cleanUrl === '/api/room' || cleanUrl === '/api/room/') {
        await roomHandler(req, res);
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('405 Method Not Allowed');
        return;
      }

      const relativePath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
      const safePath = path.resolve(resolvedRoot, relativePath);

      // Prevent directory traversal outside rootDir
      const isInsideRoot = safePath === resolvedRoot || safePath.startsWith(resolvedRoot + path.sep);
      if (!isInsideRoot) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
      }

      fs.stat(safePath, (statErr, stats) => {
        if (statErr || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`404 Not Found: ${cleanUrl}`);
          return;
        }

        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stats.size,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        });

        if (method === 'HEAD') {
          res.end();
          return;
        }

        const stream = fs.createReadStream(safePath);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          }
          res.end('500 Internal Server Error');
        });
        stream.pipe(res);
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('500 Internal Server Error');
    }
  });
}

/**
 * Helper to start listening on a given port.
 * @param {number} [port]
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string }>}
 */
export function startServer(port = Number(process.env.PORT) || 8090) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://127.0.0.1:${actualPort}`;
      resolve({ server, port: actualPort, url });
    });
  });
}

// Start server if invoked directly via `node server.js`
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const defaultPort = Number(process.env.PORT) || 8090;
  const server = createServer();
  // Localhost only by default; set HOST=0.0.0.0 to test from a phone on the same Wi-Fi
  const host = process.env.HOST || '127.0.0.1';
  server.listen(defaultPort, host, () => {
    console.log(`500cc Grand Prix '90 HTTP Server running at http://${host === '127.0.0.1' ? 'localhost' : host}:${defaultPort}/`);
  });
}
