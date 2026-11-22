import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { documentStore } from '../document-store.js';
import { createSession, documentSessions, readSessionAddress, sessionFile } from '../live-session.js';
import { desktopStorage } from '../desktop.js';

// Failure recovery: a crash must cost the writer a reload, not the draft.
// Every case here reproduces a state that used to need a manual delete — or,
// for the notes file, stopped the server from starting at all.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-recovery-'));
let serial = 0;
const draft = (content = 'Opening.\n\nEnding.\n') => {
  const file = path.join(directory, `${serial++}.md`);
  fs.writeFileSync(file, content);
  return file;
};
const closedPort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});
const sleeper = async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  await once(child, 'spawn');
  return child;
};

// ── Missing draft folder ──
// DRAFT_FILE=./sub/draft.md used to throw ENOENT; the folder is created.
{
  const file = path.join(directory, 'new', 'nested', 'draft.md');
  const store = documentStore(file);
  assert(fs.statSync(path.dirname(file)).isDirectory());
  assert.equal(store.read().path, path.join(fs.realpathSync(path.dirname(file)), 'draft.md'));
}

// ── Unreadable notes ──
// A note file with a broken byte kept the session from opening, so the draft
// could not be edited in the app at all. The text is intact; the notes are
// kept aside and the margin starts empty.
{
  const file = draft();
  fs.writeFileSync(`${file}.stilura-notes.json`, '{ not json');
  const session = createSession(documentStore(file));
  try {
    assert.equal(session.read().text, 'Opening.\n\nEnding.\n');
    assert.equal(session.read().notesReady, false);
  } finally { session.close(); }
  const kept = fs.readdirSync(directory).filter(name => name.startsWith(`${path.basename(file)}.stilura-notes.json.corrupt-`));
  assert.equal(kept.length, 1, 'the unreadable notes are kept, not deleted');
  assert.equal(fs.readFileSync(path.join(directory, kept[0]), 'utf8'), '{ not json');
}

// Valid JSON of the wrong shape is the same case.
{
  const file = draft();
  fs.writeFileSync(`${file}.stilura-notes.json`, JSON.stringify({ notes: 'not a list' }));
  const session = createSession(documentStore(file));
  try { assert.equal(session.read().notesReady, false); } finally { session.close(); }
}

// ── Session claims ──
// A truncated claim is not a live owner; left on disk it told every launch
// that the draft was open somewhere and nothing could clear it.
{
  const file = draft();
  fs.writeFileSync(sessionFile(file), '{ truncated');
  assert.equal(readSessionAddress(file), null);
  assert.equal(fs.existsSync(sessionFile(file)), false);
}
{
  const file = draft();
  fs.writeFileSync(sessionFile(file), JSON.stringify({ pid: process.pid, url: 'http://192.0.2.1/draft/live', token: 't' }));
  assert.equal(readSessionAddress(file), null, 'a non-local address is not a claim');
  assert.equal(fs.existsSync(sessionFile(file)), false);
}
{
  const file = draft();
  const child = await sleeper();
  child.kill();
  await once(child, 'exit');
  fs.writeFileSync(sessionFile(file), JSON.stringify({ pid: child.pid, url: `http://127.0.0.1:1/draft/live?name=${path.basename(file)}`, token: 'dead' }));
  assert.equal(readSessionAddress(file), null, 'a dead owner claims nothing');
  assert.equal(fs.existsSync(sessionFile(file)), false);
}

// A claim whose process number was reused by an unrelated program, and whose
// address answers nothing, is stale. Asking the address is what tells the two
// apart: a synchronous pid check cannot.
{
  const file = draft();
  const child = await sleeper();
  const port = await closedPort();
  fs.writeFileSync(sessionFile(file), JSON.stringify({
    pid: child.pid, url: `http://127.0.0.1:${port}/draft/live?name=${path.basename(file)}`, token: 'stale',
  }));
  const sessions = documentSessions();
  try {
    const session = await sessions.getVerified(file);
    assert.equal(session.read().text, 'Opening.\n\nEnding.\n');
    assert.equal(readSessionAddress(file), null, 'the stale claim is removed');
  } finally { sessions.close(); child.kill(); }
}

// A claim that answers is real, and starting a second server on the same
// draft is still refused.
{
  const file = draft();
  const child = await sleeper();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(sessionFile(file), JSON.stringify({
    pid: child.pid, url: `http://127.0.0.1:${server.address().port}/draft/live?name=${path.basename(file)}`, token: 'live',
  }));
  const sessions = documentSessions();
  try {
    await assert.rejects(() => sessions.getVerified(file), error => error.status === 409);
    assert.equal(fs.existsSync(sessionFile(file)), true, 'a live claim is kept');
  } finally { sessions.close(); server.close(); child.kill(); }
}

// POST /draft/open verifies a stale claim with a reused live pid and takes over the session.
{
  const mainFile = draft('Main.\n');
  const sideFile = draft('Sidebar draft.\n');
  const child = await sleeper();
  const port = await closedPort();
  fs.writeFileSync(sessionFile(sideFile), JSON.stringify({
    pid: child.pid, url: `http://127.0.0.1:${port}/draft/live?name=${path.basename(sideFile)}`, token: 'stale',
  }));
  const serverChild = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'index.js')], {
    cwd: directory,
    env: { ...process.env, PORT: '0', DRAFT_FILE: mainFile, STILURA_NO_OPEN: '1', STILURA_OFFLINE_MODELS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  serverChild.stderr.on('data', chunk => { output += chunk; });
  try {
    const baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start: ' + output)), 20_000);
      serverChild.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/Stilura → (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      serverChild.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    const res = await fetch(baseUrl + '/draft/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: path.basename(sideFile) }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(res.status, 200, 'POST /draft/open must recover from a stale session claim');
    assert.equal((await res.json()).text, 'Sidebar draft.\n');
    const claim = readSessionAddress(sideFile);
    assert.equal(claim?.pid, serverChild.pid, 'the server must claim the recovered session');
  } finally {
    serverChild.kill('SIGTERM');
    if (serverChild.exitCode === null) await once(serverChild, 'exit');
    child.kill();
  }
}

// ── Stale lock ──
// Saves hold the lock for milliseconds. One left by a crashed process made
// every later save answer 423 until the writer deleted a file by hand.
{
  const file = draft('old\n');
  const store = documentStore(file);
  fs.writeFileSync(`${file}.stilura-lock`, JSON.stringify({ pid: 2147483647 }));
  assert.equal(store.write('new\n', store.read().revision).text, 'new\n');
  assert.equal(fs.existsSync(`${file}.stilura-lock`), false, 'the recovered lock is released after the save');
}
{
  // A lock taken before owners were recorded has no pid to check; age is all
  // there is, and a save never lasts a minute.
  const file = draft();
  const store = documentStore(file);
  const lock = `${file}.stilura-lock`;
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 5 * 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(store.write('after crash\n', store.read().revision).text, 'after crash\n');
}
{
  // A lock held by a live process is a real exclusion.
  const file = draft();
  const store = documentStore(file);
  const child = await sleeper();
  fs.writeFileSync(`${file}.stilura-lock`, JSON.stringify({ pid: child.pid }));
  try {
    assert.throws(() => store.write('x\n', store.read().revision), error => error.status === 423);
  } finally { child.kill(); fs.rmSync(`${file}.stilura-lock`, { force: true }); }
}

// ── Desktop state ──
// One unreadable entry used to fail the whole read, and the desktop window
// started without its settings or its open draft.
{
  const state = path.join(directory, 'desktop');
  const storage = desktopStorage(state);
  storage.write('stilura:voice', 'plain');
  fs.writeFileSync(path.join(state, 'a'.repeat(64) + '.json'), '{ broken');
  assert.deepEqual(storage.read(), [['stilura:voice', 'plain']]);
  const kept = fs.readdirSync(state).filter(name => name.includes('.corrupt-'));
  assert.equal(kept.length, 1, 'the unreadable entry is kept aside');
  assert.equal(storage.read().length, 1, 'the next read is quiet');
}

fs.rmSync(directory, { recursive: true, force: true });
console.log('recovery ok');
