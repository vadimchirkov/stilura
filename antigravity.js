import { tmpdir } from 'node:os';
import path from 'node:path';
import { executables, envWithPath, connectAcp } from './acp-client.js';

export const ANTIGRAVITY = 'antigravity';

const STATUS_CACHE_TTL = 60_000;
const IDLE_TTL = 5 * 60_000;

let pool = null;
let idleTimer = null;
let cachedStatus = null;

const envKey = () => [process.env.STILURA_AGY ?? '', process.env.PATH ?? ''].join('\0');
const findBinary = () => executables('agy', process.env.STILURA_AGY).next().value;

function clearIdleTimer() {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function resetIdleTimer() {
  clearIdleTimer();
  idleTimer = setTimeout(closeAntigravity, IDLE_TTL);
  idleTimer.unref();
}

export function closeAntigravity() {
  clearIdleTimer();
  if (!pool) return;
  const current = pool;
  pool = null;
  current.client.close();
}

process.once('exit', closeAntigravity);

async function getClient(signal) {
  const command = findBinary();
  if (!command) throw new Error('Install Antigravity (agy), then check the connection in Settings.');
  const key = envKey();
  if (pool && (pool.client.closed || !pool.client.alive || pool.command !== command || pool.envKey !== key)) {
    closeAntigravity();
  }
  if (!pool) {
    const client = connectAcp({
      command,
      args: ['acp', '--stdio', '--include-default-customizations=false'],
      cwd: tmpdir(),
      env: envWithPath([path.dirname(process.execPath), path.dirname(command)]),
      unrefWhenIdle: true,
      startError: 'Could not start Antigravity (agy). Check the installation.',
      lostError: 'Lost the connection to Antigravity.',
      closedError: 'Antigravity closed the connection.',
      requestError: 'Antigravity request failed.',
    });
    const ready = client.initialize({ signal }).catch(error => {
      if (pool?.client === client) closeAntigravity();
      throw error;
    });
    pool = { client, command, envKey: key, ready };
  }
  resetIdleTimer();
  await pool.ready;
  resetIdleTimer();
  return pool.client;
}

export async function antigravityStatus({ force = false } = {}) {
  const key = envKey();
  if (!force && cachedStatus && cachedStatus.envKey === key && Date.now() - cachedStatus.at < STATUS_CACHE_TTL) {
    return cachedStatus.value;
  }
  const command = findBinary();
  if (!command) {
    const value = { installed: false, loggedIn: false, tier: null, models: [] };
    cachedStatus = { envKey: key, at: Date.now(), value };
    return value;
  }
  const signal = AbortSignal.timeout(15_000);
  let sessionId = null;
  let client = null;
  try {
    client = await getClient(signal);
    const sess = await client.request('session/new', { cwd: tmpdir(), mcpServers: [] }, { signal });
    sessionId = sess?.sessionId ?? null;
    const tier = sess?._meta?.antigravity?.tier?.name ?? null;
    const models = (sess?.models?.availableModels ?? []).map(m => ({
      provider: ANTIGRAVITY,
      model: m.modelId,
      name: m.name || m.modelId,
      reasoning: false,
      thinkingLevels: ['off'],
    }));
    const value = { installed: true, loggedIn: models.length > 0, tier, models };
    cachedStatus = { envKey: key, at: Date.now(), value };
    return value;
  } catch {
    const value = { installed: true, loggedIn: false, tier: null, models: [] };
    cachedStatus = { envKey: key, at: Date.now(), value };
    return value;
  } finally {
    if (client && sessionId) {
      client.request('session/close', { sessionId }).catch(() => {});
    }
  }
}

export async function askAntigravity({ systemPrompt, userPrompt, messages, model, signal, onText }) {
  signal?.throwIfAborted();
  const effectiveSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)].filter(Boolean));
  const client = await getClient(effectiveSignal);
  const cwd = tmpdir();
  const session = await client.request('session/new', { cwd, mcpServers: [] }, { signal: effectiveSignal });
  const sessionId = session?.sessionId;
  if (typeof sessionId !== 'string') throw new Error('Antigravity did not start a session.');
  try {
    if (model) {
      await client.request('session/set_model', { sessionId, modelId: model }, { signal: effectiveSignal });
    }
    const body = messages ? JSON.stringify(messages) : (userPrompt ?? '');
    const instructions = [
      systemPrompt,
      'Respond with plain text only. Do not call any tools, read or edit files, or run commands.',
    ].filter(Boolean).join('\n\n');
    const promptText = instructions ? `${instructions}\n\n---\n\n${body}` : body;
    const { text, stopReason } = await client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: promptText }],
      signal: effectiveSignal,
      onText,
    });
    if (stopReason !== 'end_turn') throw new Error('Antigravity stopped before finishing the response.');
    return text.trim();
  } finally {
    resetIdleTimer();
    client.request('session/close', { sessionId }).catch(() => {});
  }
}
