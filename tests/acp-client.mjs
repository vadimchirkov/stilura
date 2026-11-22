import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectAcp } from '../acp-client.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-acp-client-'));
const logFile = path.join(temp, 'server-log.jsonl');

function makeScript(name, body) {
  const file = path.join(temp, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

const mockServer = makeScript('mock-acp', `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\\n');
const log = entry => fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(entry) + '\\n');
let sessionSeq = 0;
let currentModel = 'default';
let pendingPrompt = null;
let waitingPerm = null;

rl.on('line', line => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id != null && !msg.method && waitingPerm && msg.id === waitingPerm.id) {
    log({ permissionOutcome: msg.result });
    const { promptId, sessionId } = waitingPerm;
    waitingPerm = null;
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'model=' + currentModel + ' ' } } } });
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'pid=' + process.pid } } } });
    send({ id: promptId, result: { stopReason: 'end_turn' } });
    return;
  }
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'Mock ACP' } } });
  } else if (msg.method === 'session/new') {
    const sessionId = 's-' + (++sessionSeq);
    send({ id: msg.id, result: { sessionId } });
  } else if (msg.method === 'session/set_model') {
    currentModel = msg.params.modelId;
    send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/close') {
    log({ closed: msg.params.sessionId });
    send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/cancel') {
    log({ cancelled: msg.params.sessionId });
    if (pendingPrompt && pendingPrompt.sessionId === msg.params.sessionId) {
      send({ id: pendingPrompt.id, result: { stopReason: 'cancelled' } });
      pendingPrompt = null;
    }
  } else if (msg.method === 'session/prompt') {
    const text = msg.params?.prompt?.[0]?.text || '';
    const sessionId = msg.params.sessionId;
    if (text === 'WAIT_FOR_CANCEL') {
      pendingPrompt = { id: msg.id, sessionId };
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial ' } } } });
      return;
    }
    if (text === 'ASK_PERMISSION') {
      waitingPerm = { id: 900 + sessionSeq, promptId: msg.id, sessionId };
      send({ id: waitingPerm.id, method: 'session/request_permission', params: { sessionId, tool: 'bash' } });
      return;
    }
    send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'reply:' + currentModel + ':' + process.pid } } } });
    send({ id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`);

const crashServer = makeScript('crash-acp', `#!/usr/bin/env node
process.stderr.write('Fatal ACP startup error: bad config\\n');
process.exit(1);
`);

try {
  // Multi-session reuse, session/set_model, streaming onText, permission cancellation, AbortSignal -> session/cancel.
  const client = connectAcp({ command: mockServer });
  try {
    assert.equal(client.alive, true);
    assert.equal(client.closed, false);
    const agent = await client.initialize();
    assert.equal(agent.protocolVersion, 1);

    // Session 1: set_model + permission request -> cancelled + streaming chunks.
    const s1 = await client.request('session/new', { cwd: temp, mcpServers: [] });
    await client.request('session/set_model', { sessionId: s1.sessionId, modelId: 'gemini-4-neon-medium' });
    const chunks1 = [];
    const r1 = await client.prompt({
      sessionId: s1.sessionId,
      prompt: [{ type: 'text', text: 'ASK_PERMISSION' }],
      onText: chunk => chunks1.push(chunk),
    });
    assert.equal(r1.stopReason, 'end_turn');
    assert.equal(chunks1.length, 2);
    assert.match(r1.text, /^model=gemini-4-neon-medium pid=\d+$/);
    const pid1 = r1.text.match(/pid=(\d+)$/)[1];
    await client.request('session/close', { sessionId: s1.sessionId });
    assert.equal(client.alive, true);

    // Session 2: AbortSignal triggers session/cancel without killing the connection.
    const s2 = await client.request('session/new', { cwd: temp, mcpServers: [] });
    const controller = new AbortController();
    await assert.rejects(
      client.prompt({
        sessionId: s2.sessionId,
        prompt: [{ type: 'text', text: 'WAIT_FOR_CANCEL' }],
        signal: controller.signal,
        onText: () => controller.abort(new Error('user-cancelled')),
      }),
      error => error.message === 'user-cancelled',
    );
    await client.request('session/close', { sessionId: s2.sessionId });
    assert.equal(client.alive, true, 'aborting one prompt must keep long-lived connection alive');

    // Session 3: same process PID still serves new sessions after abort.
    const s3 = await client.request('session/new', { cwd: temp, mcpServers: [] });
    await client.request('session/set_model', { sessionId: s3.sessionId, modelId: 'gemini-3.8-flash-low' });
    const r3 = await client.prompt({
      sessionId: s3.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
    });
    assert.equal(r3.stopReason, 'end_turn');
    assert.equal(r3.text, `reply:gemini-3.8-flash-low:${pid1}`, 'multi-session reuse must keep the same process');
    await client.request('session/close', { sessionId: s3.sessionId });

    const events = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert(events.some(e => e.permissionOutcome?.outcome?.outcome === 'cancelled'), 'session/request_permission must be cancelled');
    assert(events.some(e => e.cancelled === s2.sessionId), 'AbortSignal must send session/cancel');
    assert(events.some(e => e.closed === s1.sessionId) && events.some(e => e.closed === s3.sessionId));
  } finally {
    client.close();
  }
  assert.equal(client.closed, true);
  assert.equal(client.alive, false);

  // Stderr propagation on process crash.
  const failing = connectAcp({ command: crashServer, closedError: 'Crash test closed.' });
  try {
    await assert.rejects(
      failing.initialize(),
      error => /Fatal ACP startup error: bad config/.test(error.message),
      'stderr must be surfaced when ACP process crashes',
    );
  } finally {
    failing.close();
  }

  console.log('ACP client checks passed: multi-session reuse, set_model, streaming, permission cancel, abort cancel and stderr.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
