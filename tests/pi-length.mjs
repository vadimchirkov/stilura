import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

// A TEXT:/WORD: answer cut by the token limit is not thrown away: a usable
// prefix is accepted, an empty one is retried once with a larger budget.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-pi-length-'));
const requests = [];
let replies = [];
const modelServer = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  requests.push(JSON.parse(body));
  const [content, finish] = replies.shift();
  const chunk = choices => ({ id: 't', object: 'chat.completion.chunk', created: 0, model: 'model', choices });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: { content }, finish_reason: null }]))}\n\n`);
  res.end(`data: ${JSON.stringify(chunk([{ index: 0, delta: {}, finish_reason: finish }]))}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify({ providers: { test: {
  baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'model', name: 'Test', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 8000 }],
} } }));
Object.assign(process.env, { PI_CODING_AGENT_DIR: dir, PI_PROVIDER: 'test', PI_MODEL: 'model', STILURA_OFFLINE_MODELS: '1', PI_OFFLINE: '1' });
const { completeText } = await import('../pi.js');
const complete = async (...turns) => {
  requests.length = 0; replies = turns;
  const text = await completeText({ systemPrompt: 's', userPrompt: 'u', continuation: true, signal: AbortSignal.timeout(10_000) });
  return { text, calls: requests.length, budgets: requests.map(request => request.max_completion_tokens ?? request.max_tokens) };
};
try {
  // complete answers pass through untouched
  assert.deepEqual((await complete(['TEXT: fine.', 'stop'])).text, 'TEXT: fine.');
  // cut mid-word after real content: keep the whole words, no retry
  assert.deepEqual(await complete(['TEXT: The migrat', 'length']).then(({ text, calls }) => ({ text, calls })), { text: 'TEXT: The', calls: 1 });
  // cut inside the only word: retry once with four times the budget
  const retried = await complete(['WORD: en', 'length'], ['WORD: en.', 'stop']);
  assert.equal(retried.text, 'WORD: en.');
  assert.equal(retried.calls, 2);
  assert.equal(retried.budgets[1], retried.budgets[0] * 4);
  // reasoning-only/empty cut: retry once, and stop there
  const spent = await complete(['', 'length'], ['TEXT: still cut off', 'length']);
  assert.equal(spent.text, 'TEXT: still cut');
  assert.equal(spent.calls, 2);
  assert.equal((await complete(['TEXT: x', 'length'], ['', 'length'])).text, '');
  console.log('Pi length checks passed: complete answers, usable prefix, one larger retry for empty cuts.');
} finally {
  modelServer.closeAllConnections();
  await new Promise(resolve => modelServer.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}
