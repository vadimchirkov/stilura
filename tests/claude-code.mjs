import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeCodeStatus, askClaudeCode } from '../claude-code.js';
import { getAgentStatus } from '../pi.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-claude-code-'));
const savedEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  STILURA_CLAUDE_CODE: process.env.STILURA_CLAUDE_CODE,
  STILURA_CLAUDE_ACP: process.env.STILURA_CLAUDE_ACP,
  STILURA_AGY: process.env.STILURA_AGY,
  STILURA_OFFLINE_MODELS: process.env.STILURA_OFFLINE_MODELS,
  PI_OFFLINE: process.env.PI_OFFLINE,
};
process.env.STILURA_AGY = path.join(temp, 'missing-agy');

function makeScript(name, body) {
  const file = path.join(temp, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

const counterFile = path.join(temp, 'auth-count.txt');
fs.writeFileSync(counterFile, '0');

const mockClaude = makeScript('mock-claude', `#!/usr/bin/env node
const fs = require('node:fs');
const count = Number(fs.readFileSync(${JSON.stringify(counterFile)}, 'utf8')) + 1;
fs.writeFileSync(${JSON.stringify(counterFile)}, String(count));
process.stdout.write(JSON.stringify({
  loggedIn: true,
  apiProvider: 'firstParty',
  authMethod: 'claude.ai',
  subscriptionType: 'pro',
}));
`);

const mockAdapter = makeScript('mock-adapter', `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\\n');
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { protocolVersion: 1 } });
  } else if (msg.method === 'session/new') {
    send({ id: msg.id, result: { sessionId: 'sess-1' } });
  } else if (msg.method === 'session/prompt') {
    const wantPath = msg.params?.prompt?.[0]?.text === 'ECHO_PATH';
    if (wantPath) {
      send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: process.env.PATH || '' } } } });
    } else {
      send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } } } });
      send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'standalone!' } } } });
    }
    send({ id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`);

const failingAdapter = makeScript('failing-adapter', `#!/usr/bin/env node
process.stderr.write('Simulated adapter crash: missing auth token\\n');
process.exit(1);
`);

try {
  // (a) Separate claudeInstalled / adapterInstalled reporting and TTL caching.
  process.env.STILURA_CLAUDE_CODE = mockClaude;
  process.env.STILURA_CLAUDE_ACP = path.join(temp, 'missing-adapter');
  assert.deepEqual(await claudeCodeStatus({ force: true }), {
    installed: false, claudeInstalled: true, adapterInstalled: false, plan: null,
  });

  process.env.STILURA_CLAUDE_CODE = path.join(temp, 'missing-claude');
  process.env.STILURA_CLAUDE_ACP = mockAdapter;
  assert.deepEqual(await claudeCodeStatus({ force: true }), {
    installed: false, claudeInstalled: false, adapterInstalled: true, plan: null,
  });

  process.env.STILURA_CLAUDE_CODE = mockClaude;
  process.env.STILURA_CLAUDE_ACP = mockAdapter;
  const first = await claudeCodeStatus({ force: true });
  assert.deepEqual(first, {
    installed: true, claudeInstalled: true, adapterInstalled: true, plan: 'pro',
  });
  assert.equal(Number(fs.readFileSync(counterFile, 'utf8')), 1);

  const cached = await claudeCodeStatus();
  assert.deepEqual(cached, first);
  assert.equal(Number(fs.readFileSync(counterFile, 'utf8')), 1, 'status call within TTL must use cache');

  await claudeCodeStatus({ force: true });
  assert.equal(Number(fs.readFileSync(counterFile, 'utf8')), 2, 'force: true must bypass cache');

  // getAgentStatus({ force }) forwards cache bypass to claudeCodeStatus.
  process.env.STILURA_OFFLINE_MODELS = '1';
  process.env.PI_OFFLINE = '1';
  const statusCached = await getAgentStatus();
  assert.equal(statusCached.claudeCode?.plan, 'pro');
  assert.equal(Number(fs.readFileSync(counterFile, 'utf8')), 2, 'getAgentStatus() uses cached claude status');
  const statusForced = await getAgentStatus({ force: true });
  assert.equal(statusForced.claudeCode?.plan, 'pro');
  assert.equal(Number(fs.readFileSync(counterFile, 'utf8')), 3, 'getAgentStatus({ force: true }) refreshes claude status');

  // (b) askClaudeCode works with #!/usr/bin/env node adapter under minimal GUI PATH
  // and appends searchDirs() (e.g. ~/.local/bin) into child PATH.
  process.env.HOME = temp;
  process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  const chunks = [];
  const answer = await askClaudeCode({
    systemPrompt: 'Be concise.',
    userPrompt: 'Say hello.',
    onText: chunk => chunks.push(chunk),
  });
  assert.equal(answer, 'Hello standalone!');
  assert.deepEqual(chunks, ['Hello ', 'standalone!']);

  const adapterPath = await askClaudeCode({ systemPrompt: 'Be concise.', userPrompt: 'ECHO_PATH' });
  const adapterPathDirs = adapterPath.split(path.delimiter);
  assert(adapterPathDirs.includes(path.join(temp, '.local', 'bin')), 'envWithPath must include searchDirs() like ~/.local/bin');

  // (c) Failing adapter surfaces its stderr in the thrown error.
  process.env.STILURA_CLAUDE_ACP = failingAdapter;
  await assert.rejects(
    askClaudeCode({ systemPrompt: 'Be concise.', userPrompt: 'Fail.' }),
    error => /Simulated adapter crash: missing auth token/.test(error.message),
    'adapter stderr must be included in the failure message',
  );

  console.log('Claude Code checks passed: separate binary status, TTL cache, GUI PATH launch and stderr reporting.');
} finally {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
