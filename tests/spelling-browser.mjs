import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, loadPuppeteer, startStilura } from './browser-driver.mjs';

// Spelling and grammar marks (Harper) are checked only when typing pauses. This runs the real page
// against a real draft so the whole path is covered: the initial pass, the
// mapped marks that survive keystrokes, and the recheck that follows.
const puppeteer = loadPuppeteer();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-spelling-'));
const draft = path.join(directory, 'draft.md');
fs.writeFileSync(draft, 'Teh quikc brown fox. He go home.\n');

const { server, url } = await startStilura({ directory, draft });
server.stderr.on('data', chunk => process.stderr.write(chunk));

const browser = await launchBrowser(puppeteer);
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

  assert.deepEqual(await settled(['Teh', 'quikc', 'go']), ['Teh', 'quikc', 'go']);

  // A grammar mark offers Harper's fix; choosing it edits the draft.
  const go = await page.$$eval('.cm-spell-marker', nodes => nodes.findIndex(node => node.textContent === 'go'));
  await (await page.$$('.cm-spell-marker'))[go].click();
  const fixes = await page.$$eval('#mark-bubble .mark-bubble-seg', nodes => nodes.map(node => node.textContent));
  assert.deepEqual(fixes, ['goes', 'Ignore']);
  await page.evaluate(() => document.querySelector('#mark-bubble .mark-bubble-seg').click());
  assert.match(await page.$eval('.cm-content', node => node.textContent), /He goes home\./);
  await page.waitForFunction(() => ![...document.querySelectorAll('.cm-spell-marker')].some(node => node.textContent === 'goes'), { timeout: 5000 });
  assert.deepEqual(await marks(), ['Teh', 'quikc']);

  await page.evaluate(() => document.querySelector('.cm-content').focus());
  await page.keyboard.press('End');
  await page.keyboard.type(' Anothr typo.');
  // The marks already on screen stay through the keystrokes instead of
  // disappearing until the next full pass.
  assert.deepEqual((await marks()).slice(0, 2), ['Teh', 'quikc']);
  assert.ok((await settled(['Anothr'])).includes('Anothr'), 'a word typed and left alone is marked after the pause');

  assert.deepEqual(errors, []);
  console.log('Spelling browser checks passed: initial pass, grammar fix, marks mapped through typing, recheck after the pause.');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
}
