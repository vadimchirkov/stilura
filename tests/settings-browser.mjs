import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, loadPuppeteer, startStilura } from './browser-driver.mjs';

// One Model tab: with nothing connected the dialog opens on ChatGPT sign-in;
// picking another provider shows its key field instead of Model/Reasoning,
// and a key brings its models in and selects one. Runs against an empty,
// disposable Pi directory with every provider credential stripped from the
// environment, so no real account or key is read or touched.
const puppeteer = loadPuppeteer();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-settings-'));
const draft = path.join(directory, 'draft.md');
const original = 'A quiet room.\n';
fs.writeFileSync(draft, original);
const claude = path.join(directory, 'claude');
const adapter = path.join(directory, 'claude-agent-acp');
const statusCommand = loggedIn => fs.writeFileSync(claude, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ loggedIn, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro' })}'\n`, { mode: 0o755 });
statusCommand(false);
fs.writeFileSync(adapter, `#!${process.execPath}
const assert = require('node:assert/strict');
const { createInterface } = require('node:readline');
const send = (message) => console.log(JSON.stringify({ jsonrpc: '2.0', ...message }));
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  let result;
  if (method === 'initialize') result = { protocolVersion: 1 };
  else if (method === 'session/new') {
    const options = params._meta.claudeCode.options;
    assert.match(options.systemPrompt, /Help with the SELECTED TEXT|<stilura-text>/);
    assert.equal(options.model, 'sonnet');
    assert.deepEqual(options.tools, []);
    assert.deepEqual(params.mcpServers, []);
    assert.equal(options.persistSession, false);
    result = { sessionId: 'fixture' };
  } else if (method === 'session/prompt') {
    assert.equal(params.sessionId, 'fixture');
    const prompt = params.prompt[0].text;
    assert.match(prompt, /A ⟦quiet⟧ room|Write an ending/);
    const text = prompt.includes('Write an ending') ? '<stilura-text>The door closed.</stilura-text>'
      : '<stilura-edits>[{"label":"Synonym","quote":"quiet","replacement":"peaceful"}]</stilura-edits>';
    for (const chunk of [text.slice(0, 10), text.slice(10)]) {
      send({ method: 'session/update', params: { sessionId: 'fixture',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } } });
    }
    result = { stopReason: 'end_turn' };
  } else throw new Error(method);
  send({ id, result });
});
`, { mode: 0o755 });
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !/API_KEY|TOKEN|SECRET|^AWS_|^GOOGLE_|^AZURE_|^PI_/.test(name)));

const { server, url } = await startStilura({ directory, draft,
  env: { ...env, STILURA_AGY: '/nonexistent', STILURA_OFFLINE_MODELS: '1',
    PI_CODING_AGENT_DIR: path.join(directory, 'pi'), STILURA_CLAUDE_CODE: claude, STILURA_CLAUDE_ACP: adapter } });

const browser = await launchBrowser(puppeteer);
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const visible = selector => page.$eval(selector, node => !node.closest('[hidden]') && node.getClientRects().length > 0);

  // First run: the Model tab, ChatGPT chosen, its Sign in focused.
  await page.waitForFunction(() => document.getElementById('settings-dialog').open);
  assert.deepEqual(await page.$$eval('.settings-tabs [role="tab"]', tabs => tabs.map(tab => tab.textContent)), ['Model', 'General']);
  assert.equal(await visible('#api-model-settings'), false);
  assert(await page.$$eval('.model-service img', images => images.length === 2 && images.every(image => image.naturalWidth > 0)));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'service-chatgpt');
  assert.match(await page.$eval('#settings-sub', node => node.textContent), /^Connect a service to start writing with AI/);
  assert.equal(await visible('#model-field'), false);
  assert.equal(await visible('#connect-key'), false);

  // Another provider: its key field replaces Model and Reasoning.
  await page.click('#service-api');
  await page.click('#agent-provider');
  // The popover's toggle handler clears and focuses the search a task later.
  await page.waitForFunction(() => document.activeElement?.matches('#provider-combo .combo-search'));
  await page.type('#provider-combo .combo-search', 'OpenAI');
  const openai = await page.$$eval('#provider-combo .combo-item', items => items.map(item => [item.dataset.value, item.textContent]));
  assert(openai.some(([value, label]) => value === 'openai' && /not connected/.test(label)), JSON.stringify(openai));
  await page.click('#provider-combo .combo-item[data-value="openai"]');
  assert.equal(await visible('#connect-key'), true);
  assert.equal(await visible('#connect-signin'), false);
  assert.equal(await visible('#model-field'), false);
  assert.equal(await page.$eval('#api-key-label', node => node.textContent), 'OpenAI API key');
  assert.equal(await page.$eval('#model-hint', node => node.textContent), 'Connect OpenAI to choose a model.');

  // A key connects it: a model is chosen and saved, and the lines say so.
  await page.type('#api-key', 'sk-fixture-not-a-real-key');
  await page.click('#key-add');
  await page.waitForFunction(() => !document.getElementById('model-field').hidden);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wa-agent')));
  assert.equal(saved.provider, 'openai');
  assert.ok(saved.model);
  assert.equal(await visible('#connect-row'), false);
  assert.equal(await page.$eval('#connection-line', node => node.textContent), 'Connected with an API key. Remove key');

  // Remove asks twice and says so, then the provider is back to its key field.
  await page.click('#connection-line button');
  assert.equal(await page.$eval('#connection-line button', node => node.textContent), 'Press again to remove');
  await page.click('#connection-line button');
  await page.waitForFunction(() => !document.getElementById('connect-key').hidden);
  assert.equal(await page.evaluate(() => localStorage.getItem('wa-agent')), null);

  await page.click('#service-claude');
  assert.equal(await visible('#connect-claude'), true);
  assert.equal(await visible('#connect-key'), false);
  statusCommand(true);
  await page.click('#claude-recheck');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('wa-agent'))?.provider === 'claude-code');
  assert.equal(await visible('#model-field'), false);
  assert.equal(await page.$eval('#service-claude', node => node.getAttribute('aria-current')), 'true');
  await page.evaluate(() => document.getElementById('settings-dialog').close());
  await page.click('#settings-open');
  await page.waitForFunction(() => !document.getElementById('model-field').hidden);
  assert.equal(await page.$eval('#service-claude', node => node.getAttribute('aria-pressed')), 'true');
  await page.click('#agent-model');
  await page.waitForFunction(() => document.activeElement?.matches('#model-combo .combo-search'));
  await page.type('#model-combo .combo-search', 'Claude Sonnet');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('wa-agent'))?.model === 'sonnet');
  await page.evaluate(() => document.getElementById('settings-dialog').close());
  await page.waitForFunction(() => document.querySelector('.cm-content')?.innerText.includes('A quiet room.'));
  const editor = await page.$('.cm-content');
  await editor.focus();
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => {
    const node = document.querySelector('.cm-line').firstChild;
    window.getSelection().setBaseAndExtent(node, 2, node, 7);
  });
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(modifier);
  await page.keyboard.press('k');
  await page.keyboard.up(modifier);
  await page.waitForSelector('.passage-input');
  await page.type('.passage-input', 'Give me a synonym.');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.cm-generation')?.textContent.includes('peaceful'));
  assert.equal(fs.readFileSync(draft, 'utf8'), original);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.cm-content')?.innerText.includes('A peaceful room.'));
  const write = await fetch(url + '/write', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: '/Write an ending', from: 0, cursor: 16,
      instruction: 'Write an ending', agent: { provider: 'claude-code', model: 'sonnet' } }),
  });
  const stream = await write.text();
  assert.match(stream, /The door closed/);
  assert.match(stream, /\[DONE\]/);
  // A saved model the catalog no longer lists is "unavailable", not a first run.
  await page.evaluate(() => localStorage.setItem('wa-agent', JSON.stringify({ provider: 'openai', model: 'gone-model', thinkingLevel: 'medium' })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('settings-dialog').open && !document.getElementById('model-unavailable').hidden);
  assert.match(await page.$eval('#model-unavailable-text', node => node.textContent), /Saved model gone-model is unavailable/);
  assert.equal(await page.$eval('#settings-dialog', node => node.dataset.guided ?? ''), '');
  await page.click('#model-unavailable-pick');
  assert.equal(await page.$eval('#settings-dialog', node => node.dataset.guided), 'true');
  assert.equal(await visible('#model-unavailable'), false);
  assert.deepEqual(errors, []);
  console.log('Settings browser checks passed: first-run ChatGPT, unconnected provider key field, connect, remove, Claude Pro recheck, passage preview/accept and streamed generation.');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
}
