import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

export const CLAUDE_CODE = 'claude-code';
export const claudeModels = [
  ['default', 'Claude Code default'], ['sonnet', 'Claude Sonnet'],
  ['opus', 'Claude Opus'], ['haiku', 'Claude Haiku'],
].map(([model, name]) => ({ provider: CLAUDE_CODE, model, name, reasoning: false, thinkingLevels: ['off'] }));

function* executables(name, override) {
  const candidates = override ? [override] : (process.env.PATH ?? '').split(path.delimiter)
    .filter(directory => path.isAbsolute(directory))
    .map(directory => path.join(directory, process.platform === 'win32' ? name + '.exe' : name));
  for (const file of candidates) {
    try {
      if (!path.isAbsolute(file) || !statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      yield file;
    } catch {}
  }
}

async function commands(signal) {
  const adapter = executables('claude-agent-acp', process.env.STILURA_CLAUDE_ACP).next().value;
  let installed = false;
  for (const claude of executables('claude', process.env.STILURA_CLAUDE_CODE)) {
    installed = Boolean(adapter);
    if (!adapter) break;
    const plan = await subscription(claude, signal);
    // An older npm shim can shadow a working Claude install and crash.
    if (plan !== undefined) return { installed, claude, adapter, plan };
  }
  return { installed, plan: null };
}

// Inherit account discovery and OS settings, without API keys, proxy endpoints or cloud routing overrides.
function authEnv() {
  const keys = ['PATH', 'HOME', 'USER', 'LOGNAME', '__CF_USER_TEXT_ENCODING', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT',
    'WINDIR', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'CLAUDE_CONFIG_DIR'];
  return Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}

const run = promisify(execFile);

async function subscription(claude, signal) {
  try {
    const { stdout } = await run(claude, ['auth', 'status'], { env: authEnv(), timeout: 5000, signal, windowsHide: true });
    const status = JSON.parse(stdout);
    if (status.loggedIn && status.apiProvider === 'firstParty' && status.authMethod === 'claude.ai' && ['pro', 'max'].includes(status.subscriptionType)) {
      return status.subscriptionType;
    }
    return null;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

export async function claudeCodeStatus() {
  const { installed, plan } = await commands();
  return { installed, plan };
}

export async function askClaudeCode({ systemPrompt, userPrompt, messages, model = 'default', signal, onText }) {
  if (!claudeModels.some(choice => choice.model === model)) throw new Error('Unknown Claude Code model.');
  signal?.throwIfAborted();
  const { claude, adapter, plan, installed } = await commands(signal);
  if (!installed) throw new Error('Install Claude Code and claude-agent-acp, then check the connection in Settings.');
  if (!plan) throw new Error('Run claude auth login and sign in with Claude Pro or Max.');
  signal?.throwIfAborted();
  signal = AbortSignal.any([signal, AbortSignal.timeout(120000)].filter(Boolean));
  const cwd = tmpdir();
  const child = spawn(adapter, [], {
    cwd, env: { ...authEnv(), CLAUDE_CODE_EXECUTABLE: claude },
    stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  let pending, id = 0, answer = '', sessionId, failure;
  function fail(error) {
    failure ??= error;
    pending?.reject(failure);
  }
  function send(message) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }
  function request(method, params) {
    if (failure) throw failure;
    return new Promise((resolve, reject) => {
      pending = { id: ++id, resolve, reject };
      send({ id, method, params });
    });
  }
  const abort = () => fail(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  child.on('error', () => fail(new Error('Could not start claude-agent-acp. Check the adapter installation.')));
  child.stdin.on('error', () => fail(new Error('Lost the connection to Claude Code.')));
  lines.on('close', () => fail(new Error('Claude Code closed the connection.')));
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method && message.id != null) {
        if (message.method === 'session/request_permission') {
          send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
        } else send({ id: message.id, error: { code: -32601, message: 'Unsupported client method' } });
      } else if (message.method === 'session/update' && sessionId && message.params?.sessionId === sessionId) {
        const update = message.params.update;
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          answer += update.content.text;
          onText?.(update.content.text);
        }
      } else if (pending && message.id === pending.id) {
        const { resolve, reject } = pending;
        pending = null;
        if (message.error) reject(new Error(message.error.data?.message || message.error.message || 'Claude Code request failed.'));
        else resolve(message.result);
      }
    } catch (error) { fail(error); }
  });
  try {
    const agent = await request('initialize', { protocolVersion: 1 });
    if (agent?.protocolVersion !== 1) throw new Error('Unsupported Claude Code ACP protocol version.');
    const session = await request('session/new', {
      cwd, mcpServers: [],
      _meta: { claudeCode: { options: {
        ...(model === 'default' ? {} : { model }),
        systemPrompt, tools: [], settingSources: [], strictMcpConfig: true,
        persistSession: false, promptSuggestions: false, maxTurns: 1,
      } } },
    });
    sessionId = session?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('Claude Code did not start a session.');
    const result = await request('session/prompt', {
      sessionId, prompt: [{ type: 'text', text: messages ? JSON.stringify(messages) : userPrompt }],
    });
    signal?.throwIfAborted();
    if (failure) throw failure;
    if (result?.stopReason !== 'end_turn') throw new Error('Claude Code stopped before finishing the response.');
    return answer.trim();
  } finally {
    signal?.removeEventListener('abort', abort);
    if (signal?.aborted && sessionId && child.exitCode === null && !child.stdin.destroyed) {
      send({ method: 'session/cancel', params: { sessionId } });
    }
    child.stdin.end();
    lines.close();
    // Closing stdin gives the adapter a chance to shut down its Claude process.
    const timer = setTimeout(() => child.kill(), 1000);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }
}
