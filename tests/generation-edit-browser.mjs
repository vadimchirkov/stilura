import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { loadPuppeteer } from './browser-driver.mjs';

const puppeteer = loadPuppeteer();
const source = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('let generationJob = null;'), source.indexOf('// ─── Read-only compartment'));
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { createGenerationLoader } from './extension/editor-ui.js';
  import { EditorState, StateField, StateEffect, Prec } from '@codemirror/state';
  import { EditorView, WidgetType, Decoration, keymap } from '@codemirror/view';
  import { history, defaultKeymap, historyKeymap, isolateHistory } from '@codemirror/commands';
  import { slashCommand, reviewAction } from './extension/writing-rules.js';
  const documentKey = 'fixture', loadingDocument = false, savePaused = false;
  const saveSnapshot = () => {}, notify = () => {}, jobs = new Set();
  ${section}
  window.show = inline => {
    window.view?.destroy();
    const doc = inline ? 'Opening /write an intro' : '/write an intro';
    const from = inline ? 8 : 0;
    const view = window.view = new EditorView({ parent: document.body, state: EditorState.create({
      doc, selection: { anchor: doc.length }, extensions: [generationField, Prec.highest(generationInput), history(), EditorView.lineWrapping,
        keymap.of([...historyKeymap, ...defaultKeymap]),
        EditorView.decorations.compute([generationField], state => {
          const value = state.field(generationField);
          return value ? Decoration.set([Decoration.replace({ widget: new GenerationWidget(value), block: !inline }).range(from, doc.length)]) : Decoration.none;
        }),
      ],
    }) });
    view.dispatch({ effects: setGenerationFx.of({ from, to: doc.length, quote: doc.slice(from), text: 'A quiet garden.',
      key: documentKey, job: {}, phase: 'review', inline }) });
    view.focus();
  };
` }, bundle: true, write: false, format: 'iife' });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>body{font:18px/1.5 Georgia}.cm-suggest{opacity:.45}</style>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const undo = async () => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier); await page.keyboard.press('z'); await page.keyboard.up(modifier);
  };
  for (const inline of [false, true]) {
    const prefix = inline ? 'Opening ' : '';
    await page.evaluate(inline => window.show(inline), inline);
    await page.waitForSelector('.cm-generation .cm-suggest');
    const point = await page.$eval('.cm-suggest', el => {
      const range = document.createRange(); range.setStart(el.firstChild, 2); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.left, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + 'A quiet garden.');
    assert.equal(await page.evaluate(() => view.state.selection.main.head), prefix.length + 2);
    await page.keyboard.type('green ');
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + 'A green quiet garden.');
    assert.equal(await page.$('.cm-generation'), null);
    await undo();
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + 'A quiet garden.');
    await undo();
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + '/write an intro');

    await page.evaluate(inline => window.show(inline), inline);
    await page.waitForFunction(() => view.hasFocus && document.querySelector('.cm-generation'));
    await new Promise(resolve => setTimeout(resolve, 80));
    await page.keyboard.type(' More.');
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + 'A quiet garden. More.');
    await page.evaluate(inline => window.show(inline), inline);
    await page.waitForSelector('.cm-generation');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + 'A quiet garden.');
    await page.keyboard.type('!');
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + 'A quiet garden!.');
    await page.evaluate(inline => window.show(inline), inline);
    await page.waitForSelector('.cm-generation');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + 'A quiet garden.');
    await page.evaluate(inline => window.show(inline), inline);
    await page.waitForSelector('.cm-generation');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => view.state.doc.toString()), prefix + '/write an intro');
    assert.equal(await page.$('.cm-generation'), null);
  }
  assert.deepEqual(errors, []);
  console.log('Generation editing browser checks passed: click-to-edit caret, typing into ready output and separate Undo.');
} finally { await browser.close(); }
