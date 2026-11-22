import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { executables, envWithPath, connectAcp, STATUS_CACHE_TTL } from './acp-client.js';

export const CLAUDE_CODE = 'claude-code';
export const claudeModels = [
  ['default', 'Claude Code default'], ['sonnet', 'Claude Sonnet'],
  ['opus', 'Claude Opus'], ['haiku', 'Claude Haiku'],
].map(([model, name]) => ({ provider: CLAUDE_CODE, model, name, reasoning: false, thinkingLevels: ['off'] }));

let cachedCommands = null;

async function commands(signal, { force = false } = {}) {
  const envKey = [process.env.STILURA_CLAUDE_CODE ?? '', process.env.STILURA_CLAUDE_ACP ?? '', process.env.PATH ?? ''].join('\0');
  if (!force && cachedCommands && cachedCommands.envKey === envKey && Date.now() - cachedCommands.at < STATUS_CACHE_TTL) {
    return cachedCommands.value;
  }
  const adapter = executables('claude-agent-acp', process.env.STILURA_CLAUDE_ACP).next().value;
  const adapterInstalled = Boolean(adapter);
  let claudeInstalled = false;
  let result = null;
  for (const claude of executables('claude', process.env.STILURA_CLAUDE_CODE)) {
    claudeInstalled = true;
    if (!adapterInstalled) break;
    const plan = await subscription(claude, signal);
    // An older npm shim can shadow a working Claude install and crash.
    if (plan !== undefined) {
      result = { installed: true, claudeInstalled: true, adapterInstalled: true, claude, adapter, plan };
      break;
    }
  }
  if (!result) {
    result = { installed: claudeInstalled && adapterInstalled, claudeInstalled, adapterInstalled, plan: null };
  }
  cachedCommands = { envKey, at: Date.now(), value: result };
  return result;
}

const run = promisify(execFile);

async function subscription(claude, signal) {
  try {
    const { stdout } = await run(claude, ['auth', 'status'], {
      env: envWithPath([path.dirname(process.execPath), path.dirname(claude)]),
      timeout: 10000, signal, windowsHide: true,
    });
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

export async function claudeCodeStatus({ force = false } = {}) {
  const { installed, claudeInstalled, adapterInstalled, plan } = await commands(undefined, { force });
  return { installed, claudeInstalled, adapterInstalled, plan };
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
  const client = connectAcp({
    command: adapter,
    cwd,
    env: { ...envWithPath([path.dirname(process.execPath), path.dirname(adapter)]), CLAUDE_CODE_EXECUTABLE: claude },
    startError: 'Could not start claude-agent-acp. Check the adapter installation.',
    lostError: 'Lost the connection to Claude Code.',
    closedError: 'Claude Code closed the connection.',
    requestError: 'Claude Code request failed.',
  });
  try {
    await client.initialize({ signal });
    const session = await client.request('session/new', {
      cwd, mcpServers: [],
      _meta: { claudeCode: { options: {
        ...(model === 'default' ? {} : { model }),
        systemPrompt, tools: [], settingSources: [], strictMcpConfig: true,
        persistSession: false, promptSuggestions: false, maxTurns: 1,
      } } },
    }, { signal });
    const sessionId = session?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('Claude Code did not start a session.');
    const { text, stopReason } = await client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: messages ? JSON.stringify(messages) : userPrompt }],
      signal,
      onText,
    });
    if (stopReason !== 'end_turn') throw new Error('Claude Code stopped before finishing the response.');
    return text.trim();
  } finally {
    client.close();
  }
}
