import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ANTIGRAVITY, antigravityStatus, askAntigravity, closeAntigravity } from '../antigravity.js';
import { completeText, getAgentStatus, streamText } from '../pi.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-antigravity-'));
const logFile = path.join(temp, 'agy-log.jsonl');
const savedEnv = {
  PATH: process.env.PATH,
  STILURA_AGY: process.env.STILURA_AGY,
  STILURA_CLAUDE_CODE: process.env.STILURA_CLAUDE_CODE,
  STILURA_CLAUDE_ACP: process.env.STILURA_CLAUDE_ACP,
  STILURA_OFFLINE_MODELS: process.env.STILURA_OFFLINE_MODELS,
  PI_OFFLINE: process.env.PI_OFFLINE,
};

const mockAgy = path.join(temp, 'mock-agy');
fs.writeFileSync(mockAgy, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\\n');
const log = entry => fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(entry) + '\\n');
log({ argv: process.argv.slice(2), pid: process.pid });
let seq = 0;
let selectedModel = 'default';

rl.on('line', line => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'Antigravity ACP Server', version: '1.5.14' } } });
  } else if (msg.method === 'session/new') {
    const sessionId = 'agy-' + (++seq);
    log({ newSession: sessionId });
    send({
      id: msg.id,
      result: {
        sessionId,
        models: {
          availableModels: [
            { modelId: 'gemini-4-neon-medium', name: 'Gemini 4 Neon' },
            { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash' },
          ],
        },
        _meta: { antigravity: { tier: { name: 'Google AI Pro', id: 'g1-pro-tier' } } },
      },
    });
  } else if (msg.method === 'session/set_model') {
    selectedModel = msg.params.modelId;
    log({ setModel: selectedModel, sessionId: msg.params.sessionId });
    send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/close') {
    log({ closed: msg.params.sessionId });
    send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/prompt') {
    const sessionId = msg.params.sessionId;
    const text = msg.params?.prompt?.[0]?.text || '';
    log({ prompt: text, sessionId });
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: selectedModel + ':' } } } });
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'pid=' + process.pid } } } });
    send({ id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`, { mode: 0o755 });

try {
  process.env.STILURA_CLAUDE_CODE = path.join(temp, 'missing-claude');
  process.env.STILURA_CLAUDE_ACP = path.join(temp, 'missing-acp');
  process.env.STILURA_OFFLINE_MODELS = '1';
  process.env.PI_OFFLINE = '1';

  // (a) Missing binary.
  process.env.STILURA_AGY = path.join(temp, 'missing-agy');
  assert.deepEqual(await antigravityStatus({ force: true }), {
    installed: false, loggedIn: false, tier: null, models: [],
  });

  // (b) antigravityStatus() with mock agy, caching and force: true.
  process.env.STILURA_AGY = mockAgy;
  const first = await antigravityStatus({ force: true });
  assert.equal(first.installed, true);
  assert.equal(first.loggedIn, true);
  assert.equal(first.tier, 'Google AI Pro');
  assert.deepEqual(first.models, [
    { provider: ANTIGRAVITY, model: 'gemini-4-neon-medium', name: 'Gemini 4 Neon', reasoning: false, thinkingLevels: ['off'] },
    { provider: ANTIGRAVITY, model: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash', reasoning: false, thinkingLevels: ['off'] },
  ]);

  const readLog = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const sessionsAfterFirst = readLog().filter(e => e.newSession).length;
  assert.equal(sessionsAfterFirst, 1);

  const cached = await antigravityStatus();
  assert.deepEqual(cached, first);
  assert.equal(readLog().filter(e => e.newSession).length, 1, 'status within TTL must use cache');

  await antigravityStatus({ force: true });
  assert.equal(readLog().filter(e => e.newSession).length, 2, 'force: true must re-query status');

  // (c) Two consecutive askAntigravity() calls reuse one PID, set_model, stream onText, and close sessions.
  const chunks1 = [];
  const r1 = await askAntigravity({
    systemPrompt: 'Write clearly.',
    userPrompt: 'First request',
    model: 'gemini-4-neon-medium',
    onText: chunk => chunks1.push(chunk),
  });
  assert.match(r1, /^gemini-4-neon-medium:pid=\d+$/);
  assert.deepEqual(chunks1, ['gemini-4-neon-medium:', r1.slice('gemini-4-neon-medium:'.length)]);
  const pid1 = r1.match(/pid=(\d+)$/)[1];

  const r2 = await askAntigravity({
    systemPrompt: 'Write clearly.',
    userPrompt: 'Second request',
    model: 'gemini-3.8-flash-low',
  });
  assert.equal(r2, `gemini-3.8-flash-low:pid=${pid1}`, 'consecutive calls must reuse the same agy ACP process');

  // (d) Integration through pi.js: getAgentStatus, completeText, streamText.
  const agentStatus = await getAgentStatus();
  assert.equal(agentStatus.antigravity?.loggedIn, true);
  assert.equal(agentStatus.antigravity?.tier, 'Google AI Pro');
  assert(agentStatus.providers.some(p => p.id === ANTIGRAVITY && p.name === 'Antigravity'));
  assert(agentStatus.models.some(m => m.provider === ANTIGRAVITY && m.model === 'gemini-4-neon-medium'));

  const completed = await completeText({
    systemPrompt: 'Complete it.',
    userPrompt: 'Hello',
    selection: { provider: ANTIGRAVITY, model: 'gemini-4-neon-medium', thinkingLevel: 'off' },
  });
  assert.equal(completed, `gemini-4-neon-medium:pid=${pid1}`);

  const streamed = [];
  await streamText({
    systemPrompt: 'Stream it.',
    userPrompt: 'Hello stream',
    selection: { provider: ANTIGRAVITY, model: 'gemini-3.8-flash-low', thinkingLevel: 'off' },
    onText: chunk => streamed.push(chunk),
  });
  assert.equal(streamed.join(''), `gemini-3.8-flash-low:pid=${pid1}`);

  // Verify flags, set_model, no-tools instruction, and session/close calls.
  const entries = readLog();
  assert.deepEqual(entries[0].argv, ['acp', '--stdio', '--include-default-customizations=false']);
  assert.equal(entries.filter(e => e.argv).length, 1, 'only one agy process should have been spawned');
  assert(entries.some(e => e.prompt?.includes('Do not call any tools')));
  assert(entries.filter(e => e.closed).length >= 5);

  // (e) UI and Chrome extension wiring for Antigravity and background auto-suggestions guard.
  const root = path.resolve(import.meta.dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  for (const id of ['service-antigravity', 'connect-antigravity', 'antigravity-connect-hint', 'antigravity-command', 'antigravity-copy', 'antigravity-install', 'antigravity-recheck']) {
    assert(html.includes(`id="${id}"`), `index.html must include #${id}`);
  }
  assert(html.includes('agy acp --login'));
  const appSource = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  assert(appSource.includes("const antigravityProvider = 'antigravity'"));
  assert(appSource.includes('backgroundAllowed: () => ![claudeProvider, antigravityProvider].includes(currentAgent()?.provider)'));
  const bgSource = fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');
  assert(bgSource.includes("['claude-code', 'antigravity'].includes(config.agent?.provider)"));

  console.log('Antigravity checks passed: status/cache, process reuse, set_model, streaming, pi.js routing, UI/extension wiring and cleanup.');
} finally {
  closeAntigravity();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
