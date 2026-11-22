import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, loadPuppeteer, startStilura } from './browser-driver.mjs';

// Focus mode on a real page: Cmd/Ctrl+. fades every paragraph but the one
// with the caret, the faded set follows the caret, the choice survives a
// reload, and switching it off restores the draft.
const puppeteer = loadPuppeteer();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-focus-'));
const draft = path.join(directory, 'draft.md');
fs.writeFileSync(draft, '- First item\n- Second item\n\nSecond paragraph.\n\nThird paragraph.\n');

const { server, url } = await startStilura({ directory, draft });
server.stderr.on('data', chunk => process.stderr.write(chunk));

const browser = await launchBrowser(puppeteer);
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

  // A selection over several lines tints the selected text only, never the
  // side margins of the centred column.
  await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    const from = lines.find(node => node.textContent === '- Second item'), to = lines.find(node => node.textContent === 'Third paragraph.');
    const text = node => document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(text(from), 0); range.setEnd(text(to), 5);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.waitForSelector('.cm-selected-text');
  const tint = await page.evaluate(() => {
    const column = document.querySelector('.cm-line').getBoundingClientRect();
    const marks = [...document.querySelectorAll('.cm-selected-text')].flatMap(node => [...node.getClientRects()]);
    const layer = [...document.querySelectorAll('.cm-selectionBackground')].map(node => getComputedStyle(node).backgroundColor);
    return { inside: marks.every(rect => rect.left >= column.left - 1 && rect.right <= column.right + 1), layer, text: marks.length > 0 };
  });
  assert(tint.text && tint.inside, 'the selection tint stays on the text');
  assert(tint.layer.every(color => color === 'rgba(0, 0, 0, 0)'), 'the full-width selection rectangles stay transparent');

  assert.deepEqual(errors, []);
  console.log('Focus browser checks passed: shortcut, paragraph fade following the caret, reload, switch off, selection on the text only.');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
}
