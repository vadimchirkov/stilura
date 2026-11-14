import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPuppeteer } from './browser-driver.mjs';

// Files in the sidebar and the quick switcher, on a real page against a
// disposable folder: New and import add files instead of replacing the open
// draft, Cmd/Ctrl+O opens and creates, rename moves the file, and delete
// sends it to .trash/ with an Undo.
const puppeteer = loadPuppeteer();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-files-ui-'));
const draft = path.join(directory, 'draft.md');
fs.writeFileSync(draft, 'Home draft text.\n');
fs.writeFileSync(path.join(directory, 'notes.md'), 'Notes about the bakery.\n');
const onDisk = name => fs.existsSync(path.join(directory, name)) ? fs.readFileSync(path.join(directory, name), 'utf8') : null;
const until = async (check, message) => {
  for (let i = 0; i < 50; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail(message);
};

const env = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !/API_KEY|TOKEN|SECRET|^AWS_|^GOOGLE_|^AZURE_|^PI_/.test(name)));
const server = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
  cwd: directory,
  env: { ...env, PORT: '0', STILURA_NO_OPEN: '1', DRAFT_FILE: draft, STILURA_CLAUDE_CODE: '/nonexistent', STILURA_CLAUDE_ACP: '/nonexistent', STILURA_OFFLINE_MODELS: '1',
    PI_CODING_AGENT_DIR: path.join(directory, '.pi') },
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
const upload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-import-')), 'notes.md');
fs.writeFileSync(upload, 'Imported text.\n');

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 800 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.cm-content')?.innerText.includes('Home draft text.'));
  await page.waitForSelector('#settings-dialog[open]');
  await page.evaluate(() => document.getElementById('settings-dialog').close());
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const opened = name => page.waitForFunction(name => document.querySelector('.file-card[aria-current="true"] .file-name')?.textContent === name, {}, name);
  const action = async (name, index) => {
    const row = await page.evaluateHandle(name => [...document.querySelectorAll('.file-list > li')]
      .find(item => item.querySelector('.file-name')?.textContent === name), name);
    const date = await row.$('.file-meta');
    const more = await row.$('.file-more');
    await more.focus();
    assert.equal(await date.evaluate(node => getComputedStyle(node).visibility), 'hidden');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.file-action-panel:popover-open');
    const actions = await row.$$('.file-action');
    await actions[index].click();
    await row.dispose();
  };
  if (await page.$eval('#sidebar', node => node.getBoundingClientRect().width < 40)) await page.click('#sidebar-toggle');
  await page.waitForFunction(() => !document.getElementById('sidebar-toggle-side').hidden);
  await page.waitForSelector('.file-card');
  await opened('draft.md');

  // New: a new empty file opens; the home draft is untouched.
  await page.click('#file-new');
  await opened('Untitled.md');
  assert.equal(onDisk('Untitled.md'), '');
  assert.equal(onDisk('draft.md'), 'Home draft text.\n');
  await page.click('.cm-content');
  await page.keyboard.type('An idea.');
  await until(() => onDisk('Untitled.md') === 'An idea.', 'typing in the new file saves it');

  // Rename the open file in place: the file moves and stays open.
  await action('Untitled.md', 0);
  await page.waitForSelector('.file-rename');
  await page.keyboard.type('Ideas');
  await page.keyboard.press('Enter');
  await opened('Ideas.md');
  assert.equal(onDisk('Ideas.md'), 'An idea.');
  assert.equal(onDisk('Untitled.md'), null);
  assert.match(await page.$eval('.cm-content', node => node.innerText), /An idea\./);

  // Cmd/Ctrl+O opens by a few letters, and creates a file by name.
  const quick = async query => {
    await page.keyboard.down(modifier); await page.keyboard.press('o'); await page.keyboard.up(modifier);
    await page.waitForSelector('.switcher[open] .switcher-input');
    await page.keyboard.type(query);
    await page.keyboard.press('Enter');
  };
  await quick('nts');
  await opened('notes.md');
  await quick('Plan');
  await opened('Plan.md');
  assert.equal(onDisk('Plan.md'), '');

  // Delete a file that is not open: to the trash, and back with Undo.
  await action('Ideas.md', 1);
  await page.waitForFunction(() => document.getElementById('edit-feedback').textContent.includes('Moved Ideas.md to the trash'));
  assert.equal(onDisk('Ideas.md'), null);
  assert.equal(fs.readdirSync(path.join(directory, '.trash')).filter(name => name.endsWith(' Ideas.md')).length, 1);
  await page.click('#edit-feedback .edit-feedback-undo');
  await until(() => onDisk('Ideas.md') === 'An idea.', 'Undo restores the deleted file');

  // Delete the open file: the home draft opens first.
  await action('Plan.md', 1);
  await opened('draft.md');
  await until(() => onDisk('Plan.md') === null, 'the open file is deleted after leaving it');
  assert.equal(await page.$$eval('.file-list > li', items => items.filter(item => !item.querySelector('.file-action'))
    .map(item => item.querySelector('.file-name').textContent).join()), 'draft.md', 'the home draft has no rename or delete');

  // Import copies a file into the folder and opens it; nothing is replaced.
  await (await page.$('#file-input')).uploadFile(upload);
  await opened('notes 2.md');
  assert.equal(onDisk('notes 2.md'), 'Imported text.\n');
  assert.equal(onDisk('notes.md'), 'Notes about the bakery.\n');
  assert.equal(onDisk('draft.md'), 'Home draft text.\n');

  assert.deepEqual(errors, []);
  console.log('Files browser checks passed: New, rename in place, Cmd/Ctrl+O open and create, delete with Undo, delete the open file, import.');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(path.dirname(upload), { recursive: true, force: true });
}
