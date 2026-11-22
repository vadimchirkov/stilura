import fs   from 'fs';
import path from 'path';
import { gzipSync } from 'node:zlib';
import { MAX_DOCUMENT_BYTES } from './document-store.js';

// ─── Static file serving ───────────────────────────────────────────────────
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.wasm':  'application/wasm',
};

// Static files are kept in memory and compressed once per version: the bundle
// is the size of a small app and gzip takes it to a third, while a reload
// revalidates it with an ETag instead of downloading it again.
const assets = new Map();
export function serveStatic(req, res, filePath) {
  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';
  // Fonts never change under a given name; the bundle and the checker binary
  // change with updates, and a tab holding a stale app.js against a new server
  // is the classic post-upgrade bug. Revalidate those on each load.
  const cache = ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache';
  let asset;
  try {
    const stat = fs.statSync(filePath);
    asset = assets.get(filePath);
    if (!asset || asset.mtimeMs !== stat.mtimeMs || asset.size !== stat.size) {
      const data = fs.readFileSync(filePath);
      const compressible = data.length > 1024 && /^(text\/|application\/(javascript|json)|image\/svg)/.test(mime);
      asset = { mtimeMs: stat.mtimeMs, size: stat.size, data, gzip: compressible ? gzipSync(data) : null };
      assets.set(filePath, asset);
    }
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const etag = `W/"${asset.size.toString(16)}-${Math.floor(asset.mtimeMs).toString(16)}"`;
  const headers = { 'Content-Type': mime, 'Cache-Control': cache, ETag: etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
  if (asset.gzip && acceptsGzip(req)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': asset.gzip.length });
    res.end(asset.gzip);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': asset.data.length });
  res.end(asset.data);
}

// `gzip;q=0` means the client refuses it.
const acceptsGzip = req => /(?:^|,)\s*gzip\s*(?:;\s*q=(?!0(?:\.0*)?\s*(?:,|$))|,|$)/i.test(req?.headers['accept-encoding'] || '');

export function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' };
  if (body.length > 1024 && acceptsGzip(res.req)) {
    const zipped = gzipSync(body);
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': zipped.length });
    res.end(zipped);
    return;
  }
  res.writeHead(status, headers);
  res.end(body);
}

// ─── Request body ──────────────────────────────────────────────────────────
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_DOCUMENT_BYTES * 4) { reject(Object.assign(new Error('Request too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
        for (const key of ['text', 'revision', 'document', 'selected', 'target', 'context', 'brief', 'idea', 'instruction', 'previous', 'selection', 'provider', 'apiKey', 'name', 'to', 'trashed', 'method', 'code']) {
          if (body[key] !== undefined && typeof body[key] !== 'string') throw new Error(`${key} must be a string`);
        }
        if (body.document && Buffer.byteLength(body.document) > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds 1 MB');
        for (const key of ['from', 'cursor']) if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 0 || body[key] > (body.document ?? '').length)) throw new Error(`Invalid ${key}`);
        resolve(body);
      }
      catch (e) { reject(Object.assign(e, { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// macOS gates Documents, Desktop and Downloads behind a per-app consent
// prompt; a past "Don't Allow" surfaces as EPERM on every open, with no
// re-prompt. Name the fix, not the errno.
export function fsErrorMessage(error) {
  if (error?.code === 'EPERM' || error?.code === 'EACCES') {
    return 'Stilura may not open this folder. On macOS allow it under System Settings → Privacy & Security → Files and Folders, or pick a folder outside Documents, Desktop and Downloads.';
  }
  return error?.message || String(error);
}
