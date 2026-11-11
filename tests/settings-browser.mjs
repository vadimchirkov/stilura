import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPuppeteer } from './browser-driver.mjs';

// One Model tab: with nothing connected the dialog opens on ChatGPT sign-in;
// picking another provider shows its key field instead of Model/Reasoning,
// and a key brings its models in and selects one. Runs against an empty,
// disposable Pi directory with every provider credential stripped from the
// environment, so no real account or key is read or touched.
const puppeteer = loadPuppeteer();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-settings-'));
const draft = path.join(directory, 'draft.md');
fs.writeFileSync(draft, 'A draft.\n');
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !/API_KEY|TOKEN|SECRET|^AWS_|^GOOGLE_|^AZURE_|^PI_/.test(name)));

const server = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
  cwd: directory,
  env: { ...env, PORT: '0', STILURA_NO_OPEN: '1', DRAFT_FILE: draft, STILURA_OFFLINE_MODELS: '1',
    PI_CODING_AGENT_DIR: path.join(directory, 'pi') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const url = await new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error(`Stilura did not start: ${output}`)), 30000);
  server.stdout.on('data', chunk => {
    output += chunk;
    const match = output.match(/Stilura → (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  server.stderr.on('data', chunk => { output += chunk; });
});

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const visible = selector => page.$eval(selector, node => !node.closest('[hidden]') && node.getClientRects().length > 0);

  // First run: the Model tab, ChatGPT chosen, its Sign in focused.
  await page.waitForFunction(() => document.getElementById('settings-dialog').open);
  assert.deepEqual(await page.$$eval('.settings-tabs [role="tab"]', tabs => tabs.map(tab => tab.textContent)), ['Model', 'General']);
  assert.match(await page.$eval('#agent-provider', node => node.textContent), /ChatGPT/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'connect-browser');
  assert.equal(await visible('#model-field'), false);
  assert.equal(await visible('#connect-key'), false);

  // Another provider: its key field replaces Model and Reasoning.
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

  // A key connects it: a model is chosen and saved, and the lines say so.
  await page.type('#api-key', 'sk-fixture-not-a-real-key');
  await page.click('#key-add');
  await page.waitForFunction(() => !document.getElementById('model-field').hidden);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wa-agent')));
  assert.equal(saved.provider, 'openai');
  assert.ok(saved.model);
  assert.equal(await visible('#connect-row'), false);
  assert.match(await page.$eval('#connection-line', node => node.textContent), /Connected via API key · Remove/);
  assert.match(await page.$eval('#connected-list', node => node.textContent), /^Connected: OpenAI/);

  // Remove asks twice, then the provider is back to its key field.
  await page.click('#connection-line button');
  await page.click('#connection-line button');
  await page.waitForFunction(() => !document.getElementById('connect-key').hidden);
  assert.equal(await page.evaluate(() => localStorage.getItem('wa-agent')), null);

  assert.deepEqual(errors, []);
  console.log('Settings browser checks passed: first-run ChatGPT, unconnected provider key field, connect, remove.');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
}
