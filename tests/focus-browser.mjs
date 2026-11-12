import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPuppeteer } from './browser-driver.mjs';

// Focus mode on a real page: Cmd/Ctrl+. fades every paragraph but the one
// with the caret, the faded set follows the caret, the choice survives a
// reload, and switching it off restores the draft.
const puppeteer = loadPuppeteer();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-focus-'));
const draft = path.join(directory, 'draft.md');
fs.writeFileSync(draft, '- First item\n- Second item\n\nSecond paragraph.\n\nThird paragraph.\n');

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
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('Third'));
  await page.evaluate(() => document.getElementById('settings-dialog').close());
  const lines = () => page.$$eval('.cm-line', nodes => nodes.map(node => [node.textContent, node.classList.contains('cm-focus-dim')]));
  const shortcut = async () => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier); await page.keyboard.press('.'); await page.keyboard.up(modifier);
  };
  // Caret in the first paragraph: both its lines stay, everything else fades.
  await page.click('.cm-line');
  await shortcut();
  assert.equal(await page.evaluate(() => document.body.classList.contains('focus-mode')), true);
  assert.deepEqual(await lines(), [
    ['- First item', false], ['- Second item', false],
    ['', true], ['Second paragraph.', true], ['', true], ['Third paragraph.', true], ['', true],
  ]);
  assert.equal(await page.$eval('#editor-shortcuts', node => getComputedStyle(node).display), 'none');

  // The faded set follows the caret.
  await page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-line')].find(node => node.textContent === 'Third paragraph.');
    const range = document.createRange(); range.setStart(line.firstChild, 3); range.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('.cm-line')].find(node => node.textContent === 'Third paragraph.').classList.contains('cm-focus-dim'));
  assert.deepEqual((await lines()).filter(([, dim]) => !dim).map(([text]) => text), ['Third paragraph.']);

  // Remembered across a reload; the shortcut switches it off again.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('focus-mode') && document.querySelectorAll('.cm-focus-dim').length > 0);
  assert.equal(await page.evaluate(() => document.getElementById('focus-toggle').checked), true);
  await page.evaluate(() => { document.getElementById('settings-dialog').close(); document.querySelector('.cm-content').focus(); });
  await shortcut();
  assert.equal(await page.evaluate(() => document.body.classList.contains('focus-mode')), false);
  assert.equal(await page.$$eval('.cm-focus-dim', nodes => nodes.length), 0);
  assert.equal(fs.readFileSync(draft, 'utf8'), '- First item\n- Second item\n\nSecond paragraph.\n\nThird paragraph.\n', 'focus mode never edits the draft');

  assert.deepEqual(errors, []);
  console.log('Focus browser checks passed: shortcut, paragraph fade following the caret, reload, switch off.');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
}
