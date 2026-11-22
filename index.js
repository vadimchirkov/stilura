#!/usr/bin/env node
/**
 * Stilura — local AI-assisted writing editor
 * Split-pane editor with LLM assistance via Pi
 *
 * Usage:
 *   npx stilura        (in the folder holding your draft)
 *   node index.js
 */

import http  from 'http';
import fs    from 'fs';
import path  from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cancelOAuth, getAgentStatus, getOAuthStatus, removeProviderApiKey, saveProviderApiKey, startOAuth, submitOAuthCode } from './pi.js';
import { STYLE_FILE } from './tasks.js';
import { documentStore, MAX_DOCUMENT_BYTES } from './document-store.js';
import { fsErrorMessage, readBody, sendJson, serveStatic } from './http-util.js';
import { documentSessions } from './live-session.js';
import { renameDocument, trashDocument, restoreDocument, resolveWorkspaceFile, listWorkspaceFiles } from './workspace-files.js';
import { desktopBridge } from './desktop.js';
import { aiRoutes } from './ai-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In the npm package the server sits next to its own assets. In the desktop
// build it is a single bundled file and the assets are Tauri resources, so the
// shell says where they are.
const ROOT = process.env.STILURA_ROOT || __dirname;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = MANIFEST.version;

// Ask npm what it publishes. `null` means the package is not published at all
// — a local build asking about itself — which is not the same as a failure.
async function latestPublished(name = MANIFEST.name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`registry returned ${response.status}`);
  return (await response.json()).version;
}

// ─── CLI ───────────────────────────────────────────────────────────────────
// Both flags run before the bundler and the server: they answer and exit.
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

// Stilura opens no connection of its own — every request it makes belongs to a
// model call the writer asked for. So the update check is a command you run,
// not something that happens quietly at startup.
if (process.argv.includes('--check-update')) {
  const name = MANIFEST.name;
  const latest = await latestPublished(name).catch(error => {
    console.error(`[update] npm registry unreachable — ${error.message}`);
    process.exit(1);
  });
  if (latest === null) {
    console.log(`Stilura ${VERSION} — ${name} is not published; nothing to compare against.`);
    process.exit(0);
  }
  // Stated, not judged: a local build can legitimately run ahead of the
  // registry, and ranking two versions correctly is a semver dependency.
  console.log(latest === VERSION
    ? `Stilura ${VERSION} — same as the published release.`
    : `Published: ${name}@${latest}. Running: ${VERSION}.\n` +
      `  npx ${name}       — always runs the published release\n` +
      `  npm i -g ${name}  — if you installed it globally`);
  process.exit(0);
}

// ─── Bundle frontend (CodeMirror 6 → public/app.js) ────────────────────────
// Only in a source checkout. The published package ships public/app.js already
// built and has no esbuild, so src/ missing is the signal to skip.
if (fs.existsSync(path.join(ROOT, 'src/app.js'))) {
  try {
    const { build } = await import('esbuild');
    await build({
      entryPoints: [path.join(ROOT, 'src/app.js')],
      bundle:      true,
      outfile:     path.join(ROOT, 'public/app.js'),
      format:      'iife',
      // harper.js reads its binary with fs only under Node; the page fetches it.
      external:    ['fs'],
      logLevel:    'warning',
    });
    // The spell and grammar checker's binary, loaded by the page at runtime.
    // Timestamps are kept so the ETag, and the browser's copy, survive restarts.
    fs.cpSync(path.join(ROOT, 'node_modules/harper.js/dist/harper_wasm_slim_bg.wasm'), path.join(ROOT, 'public/harper.wasm'), { preserveTimestamps: true });
    console.log('[build] Frontend bundled ✓');
  } catch (e) {
    console.error('[build] Frontend build failed.\n', e.message);
    process.exit(1);
  }
}

// Started by the desktop shell rather than by a person at a terminal. The shell
// owns the window, the update path, and this process's lifetime.
const SIDECAR = Boolean(process.env.STILURA_SIDECAR);
const desktop = SIDECAR && process.env.STILURA_STATE_DIR ? desktopBridge(process.env.STILURA_STATE_DIR, readBody, sendJson) : null;

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC = path.join(ROOT, 'public');
const extensionToken = randomBytes(32).toString('hex');
const extensionRoutes = new Map([
  ['/api/agent/status', 'GET'], ['/rewrite', 'POST'], ['/ask', 'POST'], ['/passage-hint', 'POST'], ['/write', 'POST'], ['/suggest', 'POST'],
]);

// Draft and style live in the folder Stilura was started from, not inside the
// install directory — `npx stilura` in a notes folder edits that folder. The
// bundled style.md is the fallback when the folder has none of its own.
const CWD        = process.cwd();
const DRAFT_FILE = process.env.DRAFT_FILE || path.join(CWD, 'draft.md');
// Unqualified /draft stays on the launch file. Each tab names its own file;
// opening one must never retarget saves made by another tab or agent.
const sessions = documentSessions();
// Verify the advertised owner before trusting it: a crashed server can leave
// a session file whose pid now belongs to some other program.
try { await sessions.getVerified(DRAFT_FILE); }
catch (error) {
  if (error.status !== 409) throw error;
  console.error(`${error.message}\n  Close the other Stilura window, or delete ${DRAFT_FILE}.stilura-session if nothing is running.`);
  process.exit(1);
}

// ─── Workspace files ───────────────────────────────────────────────────────
// The sidebar lists the Markdown and text files sitting next to the draft,
// so the writer can switch between them without leaving the page.
// The anchor is the initial draft's own folder, not the process working
// directory: DRAFT_FILE may point elsewhere, and the listing must follow the
// draft. Names are basenames with an approved extension, resolved inside that
// folder — anything else is a 400, never a filesystem walk. Opening a file
// identifies that tab's document without changing other tabs' save targets.
const FILES_DIR = path.dirname(path.resolve(DRAFT_FILE));
const HOME_DRAFT = path.resolve(DRAFT_FILE);
const workspaceFile = name => resolveWorkspaceFile(FILES_DIR, name);

async function requestedDraft(url) {
  const name = url.searchParams.get('name');
  if (name === null || name === path.basename(DRAFT_FILE)) return sessions.getVerified(DRAFT_FILE);
  const file = workspaceFile(name);
  if (!file) throw Object.assign(new Error('Open a Markdown or text file by name.'), { status: 400 });
  return sessions.getVerified(file);
}

// ─── Style guide ───────────────────────────────────────────────────────────
// Prompts and prose generation live in tasks.js.

// ─── Server ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error('[request]', error.message);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: fsErrorMessage(error) });
    else res.end();
  });
});

const reply = (res, status, value) => { sendJson(res, status, value); return true; };

// Host, origin and method checks. Answers the request itself and returns null
// when it is refused, otherwise the parsed URL.
function admit(req, res) {
  const host = req.headers.host;
  const port = server.address()?.port;
  const deny = (status, value) => { sendJson(res, status, value); return null; };
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return deny(403, { error: 'Invalid local host' });
  const url = new URL(req.url, 'http://localhost');
  const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin ?? '');
  const extensionCredential = req.headers['x-stilura-extension'];
  if (extensionOrigin || extensionCredential !== undefined) {
    if (req.headers.origin && !extensionOrigin) return deny(403, { error: 'Invalid extension origin' });
    const method = extensionRoutes.get(url.pathname);
    if (!method || url.search) return deny(403, { error: 'This route is not available to extensions' });
    if (extensionOrigin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS' && extensionOrigin) {
      const headers = (req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (req.headers['access-control-request-method'] !== method || headers.some(value => !['content-type', 'x-stilura-extension'].includes(value))) return deny(403, { error: 'Invalid extension preflight' });
      res.writeHead(204, { 'Access-Control-Allow-Methods': method, 'Access-Control-Allow-Headers': 'Content-Type, X-Stilura-Extension' });
      res.end();
      return null;
    }
    const credential = Buffer.from(extensionCredential ?? '');
    if (credential.length !== extensionToken.length || !timingSafeEqual(credential, Buffer.from(extensionToken))) return deny(403, { error: 'Reconnect Stilura from the extension settings.' });
    if (req.method !== method) return deny(405, { error: 'Method not allowed' });
  } else {
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return deny(403, { error: 'Cross-origin requests are not allowed' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return deny(403, { error: 'Cross-site requests are not allowed' });
  }
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return deny(405, { error: 'Method not allowed' });
  if (req.method !== 'GET' && req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return deny(415, { error: 'Use application/json' });
  return url;
}

// Version, agent status, credentials and subscription sign-in.
async function agentRoutes(req, res, url) {
  // Which version is running, and — only when the browser asks with ?check=1,
  // which it does only if the writer turned the check on — which is published.
  // A registry that is down is reported, not retried: this is a nicety.
  if (req.method === 'GET' && url.pathname === '/api/version') {
    const payload = { name: MANIFEST.name, current: VERSION };
    // The desktop build updates itself through the shell, which knows about
    // signed bundles the registry knows nothing about. Asking npm there would
    // offer the writer a command they have no reason to run.
    if (SIDECAR) payload.managed = 'desktop';
    else if (url.searchParams.get('check') === '1') {
      try { payload.latest = await latestPublished(); }
      catch (error) { payload.error = error.message; }
    }
    sendJson(res, 200, payload);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/agent/status') {
    sendJson(res, 200, await getAgentStatus({ force: url.searchParams.get('refresh') === '1' }));
    return true;
  }

  if ((req.method === 'POST' || req.method === 'DELETE') && url.pathname === '/api/agent/credentials') {
    try {
      const body = await readBody(req);
      const provider = String(body.provider ?? '').trim();
      if (req.method === 'POST') await saveProviderApiKey(provider, String(body.apiKey ?? ''));
      else await removeProviderApiKey(provider);
      sendJson(res, 200, await getAgentStatus());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  // Subscription sign-in (OAuth) mirrors Pi's CLI login over HTTP: start
  // begins it in the background and usually returns the auth URL at once;
  // status is polled; code feeds the manual-paste fallback; cancel aborts.
  // Only allowlisted providers are offered — see pi.js.
  if (req.method === 'GET' && url.pathname === '/api/agent/oauth/status') {
    try { sendJson(res, 200, await getOAuthStatus()); }
    catch (error) { sendJson(res, 500, { error: error.message }); }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/oauth/start') {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await startOAuth(String(body.provider ?? '').trim(), String(body.method ?? 'browser').trim()));
    } catch (error) {
      sendJson(res, error.status || 400, { error: error.message });
    }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/oauth/code') {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await submitOAuthCode(body.code));
    } catch (error) {
      sendJson(res, error.status || 400, { error: error.message });
    }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/oauth/cancel') {
    try { sendJson(res, 200, await cancelOAuth()); }
    catch (error) { sendJson(res, 500, { error: error.message }); }
    return true;
  }
  return false;
}

async function draftRoutes(req, res, url) {
  // ── Draft file
  //
  //  One local Markdown file is the durable copy of the working document.
  //  The browser keeps writing to localStorage for instant reload; this is
  //  what survives clearing browser data and what other editors can open.
  //
  if (url.pathname === '/draft/live') {
    try {
      const session = await requestedDraft(url);
      if (req.headers['x-stilura-session'] && req.headers['x-stilura-session'] !== session.token) return reply(res, 403, { error: 'Document session changed' });
      if (req.method === 'GET') {
        if (!url.searchParams.has('since')) return reply(res, 200, session.read());
        const since = Number(url.searchParams.get('since')), epoch = url.searchParams.get('epoch');
        if (!url.searchParams.has('events')) return reply(res, 200, session.events(since, epoch));
        let data;
        try { data = { type: 'updates', ...session.events(since, epoch) }; }
        catch (error) { if (!error.current) throw error; data = { type: 'reset', current: error.current }; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        const emit = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
        emit(data);
        const unsubscribe = session.subscribe(emit);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        res.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
        return true;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (body.action === 'push') return reply(res, 200, session.push(body));
        if (body.action === 'patch') return reply(res, 200, session.patch(body.edits, body.revision));
        if (body.action === 'write') return reply(res, 200, session.write(body.text, body.revision, { track: true }));
        if (body.action === 'notes') return reply(res, 200, session.updateNotes(body));
        if (body.action === 'work_next') return reply(res, 200, { job: session.claimWork(body.agent_id) });
        if (body.action === 'work_finish') return reply(res, 200, session.finishWork(body));
        if (body.action === 'work') return reply(res, 200, session.work(body));
        if (body.action === 'note_suggest') return reply(res, 200, session.suggestNote(body));
        return reply(res, 400, { error: 'Unknown session action' });
      }
    } catch (error) { return reply(res, error.status || 400, { error: error.message, current: error.current }); }
  }
  if (url.pathname === '/draft') {
    if (req.method === 'GET') {
      sendJson(res, 200, { ...(await requestedDraft(url)).read(), name: url.searchParams.get('name') ?? path.basename(DRAFT_FILE) });
      return true;
    }
    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        sendJson(res, 200, { saved: true, ...(await requestedDraft(url)).write(body.text, body.revision) });
      } catch (error) {
        console.error('[/draft]', error.message);
        sendJson(res, error.status || 500, { error: fsErrorMessage(error), current: error.current });
      }
      return true;
    }
  }
  if (req.method === 'GET' && url.pathname === '/draft/history') return reply(res, 200, { snapshots: (await requestedDraft(url)).history() });
  return false;
}

async function fileRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/files') {
    try { return reply(res, 200, { files: listWorkspaceFiles(FILES_DIR, HOME_DRAFT) }); }
    catch (error) { return reply(res, 500, { error: fsErrorMessage(error) }); }
  }
  if (req.method === 'GET' && url.pathname === '/file') {
    const file = workspaceFile(url.searchParams.get('name'));
    if (!file) { sendJson(res, 400, { error: 'Open a Markdown or text file by name.' }); return true; }
    let current;
    try { current = documentStore(file).read(); }
    catch (error) {
      const missing = error.code === 'ENOENT';
      sendJson(res, missing ? 404 : error.status || 500, { error: missing ? 'File no longer exists.' : fsErrorMessage(error) });
      return true;
    }
    if (!current.exists) { sendJson(res, 404, { error: 'File no longer exists.' }); return true; }
    sendJson(res, 200, { ...current, name: path.basename(file) });
    return true;
  }
  // DELETE /file — move a workspace file, with its notes and history, into
  // the folder's .trash/. The home draft stays: it is where Stilura opens.
  if (req.method === 'DELETE' && url.pathname === '/file') {
    const file = workspaceFile(url.searchParams.get('name'));
    if (!file) { sendJson(res, 400, { error: 'Delete a Markdown or text file by name.' }); return true; }
    if (file === HOME_DRAFT) { sendJson(res, 400, { error: 'The home draft cannot be deleted.' }); return true; }
    try {
      sessions.release(file);
      sendJson(res, 200, { deleted: true, name: path.basename(file), trashed: trashDocument(file) });
    } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : fsErrorMessage(error) }); }
    return true;
  }
  // POST /file/restore — put a trashed file back under its own name.
  if (req.method === 'POST' && url.pathname === '/file/restore') {
    try {
      const body = await readBody(req);
      sendJson(res, 200, { name: restoreDocument(FILES_DIR, String(body.trashed ?? '')) });
    } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : fsErrorMessage(error) }); }
    return true;
  }
  // POST /file/rename — rename a workspace file with its notes and history.
  // Never overwrites: an existing target is refused.
  if (req.method === 'POST' && url.pathname === '/file/rename') {
    try {
      const body = await readBody(req);
      const from = workspaceFile(String(body.name ?? '')), to = workspaceFile(String(body.to ?? ''));
      if (!from || !to) { sendJson(res, 400, { error: 'Use a Markdown or text file name, without folders.' }); return true; }
      if (from === HOME_DRAFT) { sendJson(res, 400, { error: 'The home draft keeps its name.' }); return true; }
      if (from === to) { sendJson(res, 200, { name: path.basename(to), ...documentStore(to).read() }); return true; }
      sessions.release(from);
      renameDocument(from, to);
      const current = documentStore(to).read();
      sendJson(res, 200, { name: path.basename(to), id: current.id, previousId: documentStore(from).read().id });
    } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : fsErrorMessage(error) }); }
    return true;
  }
  // Without a revision this only creates a missing file (including Undo).
  // Replacing an existing file uses the same guard and history as /draft.
  if (req.method === 'PUT' && url.pathname === '/file') {
    try {
      const body = await readBody(req);
      const file = workspaceFile(String(body.name ?? ''));
      if (!file) { sendJson(res, 400, { error: 'Write a Markdown or text file by name.' }); return true; }
      if (typeof body.text !== 'string') { sendJson(res, 400, { error: 'A text body is required.' }); return true; }
      if (Buffer.byteLength(body.text) > MAX_DOCUMENT_BYTES) { sendJson(res, 413, { error: 'File exceeds the 1 MB editing limit.' }); return true; }
      const current = documentStore(file).write(body.text, body.revision ?? 'missing');
      sendJson(res, 200, { saved: true, name: path.basename(file), ...current });
    } catch (error) {
      sendJson(res, error.status || 500, { error: fsErrorMessage(error), current: error.current });
    }
    return true;
  }
  // Opening validates and reads a file; saves explicitly name it afterwards.
  if (req.method === 'POST' && url.pathname === '/draft/open') {
    try {
      const body = await readBody(req);
      const file = workspaceFile(String(body.name ?? ''));
      if (!file) { sendJson(res, 400, { error: 'Open a Markdown or text file by name.' }); return true; }
      let text;
      try { text = fs.readFileSync(file, 'utf8'); }
      catch (error) {
        const missing = error.code === 'ENOENT';
        sendJson(res, missing ? 404 : 500, { error: missing ? 'File no longer exists.' : fsErrorMessage(error) });
        return true;
      }
      if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) { sendJson(res, 413, { error: 'File exceeds the 1 MB editing limit.' }); return true; }
      sendJson(res, 200, (await sessions.getVerified(file)).read());
    } catch (error) {
      sendJson(res, error.status || 500, { error: fsErrorMessage(error) });
    }
    return true;
  }
  return false;
}

// What the page may fetch from public/, by URL path.
const PUBLIC_FILES = new Map([
  ['/', 'index.html'], ['/style.css', 'style.css'], ['/app.js', 'app.js'], ['/harper.wasm', 'harper.wasm'],
  ['/logo-tile.png', 'logo-tile.png'], ['/logo-mark.png', 'logo-mark.png'], ['/logo-mark-white.png', 'logo-mark-white.png'],
  ['/icons/openai.svg', 'icons/openai.svg'], ['/icons/claude.svg', 'icons/claude.svg'],
]);

function serveAsset(req, res, url) {
  const file = PUBLIC_FILES.get(url.pathname)
    ?? (url.pathname.startsWith('/fonts/') ? path.join('fonts', path.basename(url.pathname)) : null);
  if (file) serveStatic(req, res, path.join(PUBLIC, file));
  else { res.writeHead(404); res.end('Not found'); }
}

async function handleRequest(req, res) {
  const url = admit(req, res);
  if (!url) return;
  const cancellation = new AbortController();
  res.on('close', () => { if (!res.writableEnded) cancellation.abort(); });
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(120_000)]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Chat is paused, including requests from older cached clients.
  if (url.pathname === '/chat') return sendJson(res, 410, { error: 'Chat is temporarily disabled.' });
  if (req.method === 'GET' && url.pathname === '/extension') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; connect-src 'self'; frame-ancestors 'none'" });
    return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect Stilura</title><h1>Connecting Stilura to Chrome</h1><p>This tab closes when the extension connects. Your documents stay in Stilura.</p></html>');
  }
  if (req.method === 'GET' && url.pathname === '/api/extension/connection') {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, { token: extensionToken });
  }
  if (url.pathname.startsWith('/api/desktop/')) {
    if (desktop) return desktop(req, res, url);
    return sendJson(res, 404, { error: 'Not a desktop session' });
  }

  if (await agentRoutes(req, res, url)) return;
  if (await draftRoutes(req, res, url)) return;
  if (await fileRoutes(req, res, url)) return;
  if (req.method === 'GET') return serveAsset(req, res, url);

  // ── API
  if (req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch (error) { sendJson(res, error.status || 400, { error: error.message }); return; }
    body.signal = signal;
    if (url.pathname !== '/suggest' && (body.document?.length ?? 0) > 60_000) return sendJson(res, 413, { error: 'AI actions support up to 60,000 characters per draft. Split the document into smaller drafts; editing and export remain available.' });
    if (['/rewrite', '/ask'].includes(url.pathname) && (typeof body.document !== 'string' || typeof body.selected !== 'string' || !body.selected || !Number.isInteger(body.from) || body.from < 0 || body.document.slice(body.from, body.from + body.selected.length) !== body.selected)) return sendJson(res, 400, { error: 'Selected text does not match the document range' });

    const handler = aiRoutes.get(url.pathname);
    if (handler) return handler({ res, url, body, signal });

    res.writeHead(404); res.end('Not found');
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32'                  ? ['cmd', ['/c', 'start', '', url]]
    :                                                 ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})   // no browser to open — the URL is already printed
    .unref();
}

// A stale Stilura, or anything else, may hold 3000. Walk up rather than die.
function listen(port, attempt = 0) {
  // A failed attempt leaves its handlers queued; without this the next success
  // fires every one of them and announces a port nothing is bound to.
  server.removeAllListeners('error');
  server.removeAllListeners('listening');

  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempt < 10) return listen(port + 1, attempt + 1);
    console.error(`[server] ${error.message}`);
    process.exit(1);
  });
  server.once('listening', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    sessions.listen(url);
    console.log(`Stilura → ${url}`);
    console.log(`Draft  → ${DRAFT_FILE}`);
    console.log(`Style  → ${STYLE_FILE}`);
    // One machine-readable line for the desktop shell. It waits for this before
    // it opens a window, so it must not be a log line someone may reword.
    if (SIDECAR) console.log(`STILURA_READY ${url}`);
    // The shell already has a window for this; a browser tab beside it would be
    // a second, stale copy of the same draft.
    if (!process.env.STILURA_NO_OPEN && !SIDECAR) openBrowser(url);
  });
  server.listen(port, '127.0.0.1');
}

// A shell that dies takes its server with it. Without this the writer's next
// launch meets an orphan holding the draft's lock file.
if (SIDECAR) {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(0));
}

listen(PORT);
// `exit` does not run for a signalled process: Ctrl-C or a closing window left
// the session claim behind, and the next launch had to work out whether it was
// still real. Clean up on the way out, then exit as usual.
const shutdown = () => { sessions.close(); process.exit(0); };
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, shutdown);
process.on('exit', () => sessions.close());
