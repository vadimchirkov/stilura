import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPuppeteer } from './browser-driver.mjs';

// Spelling marks are checked only when typing pauses. This runs the real page
// against a real draft so the whole path is covered: the initial pass, the
// mapped marks that survive keystrokes, and the recheck that follows.
const puppeteer = loadPuppeteer();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-spelling-'));
const draft = path.join(directory, 'draft.md');
fs.writeFileSync(draft, 'Teh quikc brown fox.\n');

const server = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
  cwd: directory,
  env: { ...process.env, PORT: '0', STILURA_NO_OPEN: '1', DRAFT_FILE: draft },
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
server.stderr.on('data', chunk => process.stderr.write(chunk));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cm-content');
  const marks = () => page.evaluate(() => [...document.querySelectorAll('.cm-spell-marker')].map(node => node.textContent));
  const settled = async expected => {
    const until = Date.now() + 5000;
    let found = [];
    while (Date.now() < until) {
      found = await marks();
      if (expected.every(word => found.includes(word))) return found;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return found;
  };

  assert.deepEqual(await settled(['Teh', 'quikc']), ['Teh', 'quikc']);

  await page.evaluate(() => document.querySelector('.cm-content').focus());
  await page.keyboard.press('End');
  await page.keyboard.type(' Anothr typo.');
  // The marks already on screen stay through the keystrokes instead of
  // disappearing until the next full pass.
  assert.deepEqual((await marks()).slice(0, 2), ['Teh', 'quikc']);
  assert.ok((await settled(['Anothr'])).includes('Anothr'), 'a word typed and left alone is marked after the pause');

  assert.deepEqual(errors, []);
  console.log('Spelling browser checks passed: initial pass, marks mapped through typing, recheck after the pause.');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
}
