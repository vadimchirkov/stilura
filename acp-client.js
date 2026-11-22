import { spawn } from 'node:child_process';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const MAX_STDERR = 4096;

function compareSemverDesc(a, b) {
  const pa = a.replace(/^v/i, '').split('.').map(n => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return b.localeCompare(a);
}

function nvmNodeBins(home) {
  if (!home) return [];
  const root = path.join(home, '.nvm', 'versions', 'node');
  try {
    return readdirSync(root)
      .sort(compareSemverDesc)
      .map(version => path.join(root, version, 'bin'));
  } catch {
    return [];
  }
}

export function searchDirs() {
  const home = process.env.HOME || homedir();
  const raw = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    path.dirname(process.execPath),
    ...(process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin']),
    ...(home ? [
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'local'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      ...nvmNodeBins(home),
    ] : []),
  ];
  const seen = new Set();
  const dirs = [];
  for (const dir of raw) {
    if (!dir || !path.isAbsolute(dir) || seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs;
}

export function* executables(name, override) {
  const binary = process.platform === 'win32' ? name + '.exe' : name;
  const candidates = override ? [override] : searchDirs().map(directory => path.join(directory, binary));
  for (const file of candidates) {
    try {
      if (!path.isAbsolute(file) || !statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      yield file;
    } catch {}
  }
}

// Inherit account discovery and OS settings, without API keys, proxy endpoints or cloud routing overrides.
export function authEnv() {
  const keys = ['PATH', 'HOME', 'USER', 'LOGNAME', '__CF_USER_TEXT_ENCODING', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT',
    'WINDIR', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'CLAUDE_CONFIG_DIR'];
  return Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}

export function envWithPath(extraDirs = []) {
  const env = authEnv();
  const existing = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (const dir of [...extraDirs, ...existing, ...searchDirs()]) {
    if (!dir || !path.isAbsolute(dir) || seen.has(dir)) continue;
    seen.add(dir);
    merged.push(dir);
  }
  if (merged.length) env.PATH = merged.join(path.delimiter);
  return env;
}

export function connectAcp({
  command,
  args = [],
  cwd = tmpdir(),
  env,
  unrefWhenIdle = false,
  startError = 'Could not start ACP process.',
  lostError = 'Lost the connection to the ACP process.',
  closedError = 'ACP process closed the connection.',
  requestError = 'ACP request failed.',
}) {
  const child = spawn(command, args, {
    cwd,
    env: env ?? envWithPath([path.dirname(process.execPath), path.dirname(command)]),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  const sessionListeners = new Map();
  let id = 0, closed = false, failure = null;
  let stderrText = '', stderrEnded = false;

  function syncRef() {
    if (!unrefWhenIdle) return;
    const fn = pending.size > 0 ? 'ref' : 'unref';
    child[fn]?.();
    child.stdin?.[fn]?.();
    child.stdout?.[fn]?.();
    child.stderr?.[fn]?.();
  }
  syncRef();

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderrText += chunk;
    if (stderrText.length > MAX_STDERR) stderrText = stderrText.slice(-MAX_STDERR);
  });
  child.stderr.once('end', () => { stderrEnded = true; });
  child.stderr.once('close', () => { stderrEnded = true; });

  const withStderr = base => {
    const detail = stderrText.trim();
    return detail ? `${base} (${detail})` : base;
  };

  function fail(error) {
    failure ??= error;
    for (const [reqId, entry] of pending) {
      pending.delete(reqId);
      entry.cleanup?.();
      entry.reject(failure);
    }
    syncRef();
  }

  function send(message) {
    if (closed || child.stdin.destroyed) return;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }

  child.on('error', () => fail(new Error(withStderr(startError))));
  child.stdin.on('error', () => {
    if (!closed) fail(new Error(withStderr(lostError)));
  });
  lines.on('close', () => {
    if (closed) return;
    const finishClose = () => fail(new Error(withStderr(closedError)));
    if (stderrEnded) finishClose();
    else {
      child.stderr.once('close', finishClose);
      child.once('close', finishClose);
    }
  });
  lines.on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      if (message.method && message.id != null) {
        if (message.method === 'session/request_permission') {
          send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
        } else {
          send({ id: message.id, error: { code: -32601, message: 'Unsupported client method' } });
        }
      } else if (message.method === 'session/update') {
        const listener = sessionListeners.get(message.params?.sessionId);
        const update = message.params?.update;
        if (listener && update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          listener(update.content.text);
        }
      } else if (message.id != null && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        entry.cleanup?.();
        syncRef();
        if (message.error) {
          entry.reject(new Error(message.error.data?.message || message.error.message || requestError));
        } else {
          entry.resolve(message.result);
        }
      }
    } catch (error) {
      fail(error);
    }
  });

  function request(method, params, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (failure) return Promise.reject(failure);
    if (closed) return Promise.reject(new Error(withStderr(closedError)));
    return new Promise((resolve, reject) => {
      const reqId = ++id;
      const onAbort = () => {
        if (!pending.delete(reqId)) return;
        syncRef();
        reject(signal.reason);
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      pending.set(reqId, { resolve, reject, cleanup });
      syncRef();
      signal?.addEventListener('abort', onAbort, { once: true });
      send({ id: reqId, method, params });
    });
  }

  async function initialize({ signal } = {}) {
    const agent = await request('initialize', { protocolVersion: 1 }, { signal });
    if (agent?.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version.');
    return agent;
  }

  async function prompt({ sessionId, prompt: content, signal, onText }) {
    signal?.throwIfAborted();
    let text = '';
    sessionListeners.set(sessionId, chunk => {
      text += chunk;
      onText?.(chunk);
    });
    const onAbort = () => {
      if (!closed && child.exitCode === null && !child.stdin.destroyed) {
        send({ method: 'session/cancel', params: { sessionId } });
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await request('session/prompt', { sessionId, prompt: content }, { signal });
      signal?.throwIfAborted();
      if (failure) throw failure;
      return { text, stopReason: result?.stopReason, result };
    } finally {
      sessionListeners.delete(sessionId);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    const error = failure ?? new Error(withStderr(closedError));
    for (const [reqId, entry] of pending) {
      pending.delete(reqId);
      entry.cleanup?.();
      entry.reject(error);
    }
    sessionListeners.clear();
    if (!child.stdin.destroyed) child.stdin.end();
    lines.close();
    // Closing stdin gives the server a chance to shut down its child processes.
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 1000);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }

  return {
    initialize,
    request,
    prompt,
    close,
    get alive() { return !closed && !failure && child.exitCode === null && !child.killed; },
    get closed() { return closed; },
  };
}
