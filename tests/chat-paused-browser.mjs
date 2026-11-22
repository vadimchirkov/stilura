import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { appSection } from './app-source.mjs';
import { launchBrowser, loadPuppeteer } from './browser-driver.mjs';

const puppeteer = loadPuppeteer();
const browser = await launchBrowser(puppeteer);
try {
  const page = await browser.newPage();
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ content: fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8') });
  for (const width of [390, 1100]) {
    await page.setViewport({ width, height: 800 });
    for (const collapsed of [true, false]) for (const notice of [true, false]) {
      const state = await page.evaluate(({ collapsed, notice }) => {
        const chat = document.getElementById('chat');
        chat.classList.toggle('is-collapsed', collapsed);
        chat.classList.toggle('has-notice', notice);
        const stream = document.getElementById('chat-stream');
        stream.hidden = false;
        stream.textContent = 'Restored conversation or a late reply';
        const feedback = document.getElementById('edit-feedback');
        feedback.hidden = !notice;
        feedback.textContent = 'Undo';
        return { panel: getComputedStyle(chat).display,
          conversation: getComputedStyle(stream).display,
          background: getComputedStyle(chat, '::before').display,
          pill: getComputedStyle(document.getElementById('chat-pill')).display,
          composer: getComputedStyle(chat.querySelector('.chat-composer')).display,
          toggle: getComputedStyle(document.getElementById('chat-clear')).display,
          noticeInside: chat.contains(feedback),
          notice: getComputedStyle(feedback).display };
      }, { collapsed, notice });
      assert.equal(state.conversation, 'none', 'History and late replies must stay hidden');
      assert.equal(state.background, 'none', 'Conversation background must stay hidden');
      assert.equal(state.pill, 'none', 'Conversation launcher must stay hidden');
      assert.equal(state.composer, 'none');
      assert.equal(state.toggle, 'none');
      assert.equal(state.noticeInside, true, 'Notices must remain inside their positioning container');
      if (notice) {
        assert.notEqual(state.panel, 'none');
        assert.notEqual(state.notice, 'none', 'Undo and error notices must remain visible');
      } else assert.equal(state.panel, 'none');
    }
  }
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { createNotices, modelError } from './src/notices.js';
    import { createGenerate, setGenerationFx } from './src/features/generate.js';
    const chatPanel = document.getElementById('chat');
    const chatInput = document.getElementById('chat-input');
    const editFeedback = document.getElementById('edit-feedback');
    const noticeLive = document.getElementById('notice-live');
    const syncPill = () => {};
    let suggestWorking = '';
    window.openedSettings = '';
    const notices = createNotices({ editFeedback, noticeLive, chatPanel, chatInput,
      focusEditor() {}, openSettings: tab => { window.openedSettings = tab; } });
    const { notify, notifyProblem } = notices;
    ${appSection('function setSuggestStatus(', 'let tabId;')}
    const jobs = new Set();
    const error402 = '402 {"type":"error","error":{"type":"api_error","message":"Upstream request failed: Insufficient account funds"}}';
    const { generateFromLine } = createGenerate({
      jobs, docState: { documentKey: 'test' }, passageFx: () => null,
      startJob: () => { const job = new AbortController(); jobs.add(job); return job; },
      finishJob: job => jobs.delete(job), ensureAgent: async () => true, cancelSuggestion() {},
      currentAgent: () => ({}), combinedContext: () => '', notify, notifyProblem,
      closePassage() {}, requestPassage() {}, saveSnapshot() {},
      fetch: async () => ({ ok: true }),
      async *sseChunks() { yield { error: error402 }; },
    });
    window.checkWriteError = async () => {
      notify('Earlier instruction', { sticky: true });
      let target = null;
      const view = { state: { readOnly: false, doc: { toString: () => '/Write.', lineAt: () => ({ from: 0 }) }, field: () => target },
        dispatch({ effects }) { for (const effect of [effects].flat()) if (effect.is(setGenerationFx)) target = effect.value; } };
      await generateFromLine(view, { from: 0, to: 7, text: '/Write.' }, 'Write.');
      return { text: editFeedback.textContent, tone: editFeedback.dataset.tone, sticky: notices.state().sticky, timer: notices.state().timer };
    };
    window.checkSuggestError = () => {
      notify('Earlier instruction', { sticky: true });
      reportSuggestFailure(modelError(new Error(error402)), false);
      return { text: editFeedback.textContent, tone: editFeedback.dataset.tone, sticky: notices.state().sticky };
    };
    Object.assign(window, { notify, notifyProblem, modelError, editFeedback, noticeState: notices.state });
  ` }, bundle: true, write: false, format: 'iife' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const writeError = await page.evaluate(() => window.checkWriteError());
  assert.match(writeError.text, /out of credit/);
  assert.match(writeError.text, /Open settings/);
  assert.equal(writeError.tone, 'error');
  assert.equal(writeError.sticky, true);
  assert.equal(writeError.timer, null, 'Model errors must not expire automatically');
  const suggestError = await page.evaluate(() => window.checkSuggestError());
  assert.match(suggestError.text, /out of credit/);
  assert.equal(suggestError.sticky, true);
  await page.waitForFunction(() => {
    const notice = document.getElementById('edit-feedback');
    return !notice.hidden && getComputedStyle(notice).opacity === '1' && notice.getBoundingClientRect().height > 0;
  });
  await page.click('#edit-feedback .edit-feedback-undo');
  assert.equal(await page.evaluate(() => openedSettings), 'models');
  for (const [error, message] of [
    ['401 bad key', 'API key was rejected'], ['404 missing model', 'model is not available'],
    ['408 timeout', 'model took too long'], ['429 overloaded', 'model is rate-limited'],
    ['500 failed', 'provider hit an error'], ['Failed to fetch', 'Stilura stopped answering'],
  ]) {
    const state = await page.evaluate(error => {
      notifyProblem(modelError(new Error(error)), () => {});
      return { text: editFeedback.textContent, sticky: noticeState().sticky, visible: !editFeedback.hidden };
    }, error);
    assert(state.text.includes(message));
    assert(state.sticky && state.visible);
  }
  const alert = await page.evaluate(() => {
    notify('Old sticky message', { sticky: true });
    notify('New error', { tone: 'error' });
    notify('Background status');
    return editFeedback.textContent;
  });
  assert.match(alert, /New error/);
  await page.click('#edit-feedback .edit-feedback-close');
  await page.evaluate(() => {
    window.undone = false;
    notify('Text accepted', { action: () => { window.undone = true; } });
  });
  await page.click('#edit-feedback .edit-feedback-undo');
  assert.equal(await page.evaluate(() => window.undone), true);
  await page.evaluate(() => notify('Saved'));
  assert.equal(await page.$eval('#edit-feedback', node => node.textContent.includes('Saved') && !node.hidden), true);
  console.log('Paused chat checks passed: restored history, late replies, expanded/collapsed panels, notices and mobile/desktop widths.');
} finally { await browser.close(); }
