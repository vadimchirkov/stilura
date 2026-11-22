import { createPassageInput } from '../extension/editor-ui.js';
import * as writingRules from '../extension/writing-rules.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EditorState, StateField, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { history, undo, isolateHistory } from '@codemirror/commands';
import { appSection, generateIn } from './app-source.mjs';

const draft = 'Opening.\n\n/Describe a quiet garden.\n\nEnding.';
function setup(beforeDone = async () => {}) {
  const jobs = new Set(), notices = [], requests = [], snapshots = [];
  const view = { composing: false };
  const context = vm.createContext({
    ...writingRules, createPassageInput,
    EditorState, StateField, StateEffect, EditorView, Decoration, WidgetType, isolateHistory,
    AbortController, documentKey: 'draft', loadingDocument: false, savePaused: false, jobs,
    clearGhostFx: StateEffect.define(), cancelSuggestion() {},
    startJob() { const job = new AbortController(); jobs.add(job); return job; },
    finishJob: job => jobs.delete(job), ensureAgent: async () => true,
    currentAgent: () => ({ provider: 'fixture', model: 'test' }), combinedContext: () => 'Author context',
    saveSnapshot: label => snapshots.push(label), notify: text => notices.push(text),
    notifyProblem: problem => notices.push(problem.say),
    modelError: error => ({ say: error.message }),
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body), signal: options.signal }); return { ok: true }; },
    async *sseChunks() {
      yield { text: 'A quiet ' };
      await beforeDone({ view, context, jobs, requests });
      yield { text: 'garden.' };
    },
  });
  generateIn(context);
  const field = vm.runInContext('generationField', context);
  view.state = EditorState.create({ doc: draft, selection: { anchor: draft.indexOf('\n\nEnding.') }, extensions: [field, history()] });
  view.dispatch = spec => {
    view.state = view.state.update(spec).state;
    for (const job of jobs) if (!view.state.field(field)) job.abort();
  };
  const run = () => context.generateFromLine(view, view.state.doc.lineAt(view.state.selection.main.head), 'Describe a quiet garden.');
  const review = action => context.reviewGeneration(view, action, view.state.field(field)?.job);
  return { context, view, field, jobs, notices, requests, snapshots, run, review };
}

// Keep the completed preview until acceptance; preserve concurrent edits and scoped Undo.
for (const remote of [false, true]) {
  const test = setup(async ({ view }) => {
    assert.equal(view.state.doc.toString(), draft, 'partial output must never be saved as prose');
    assert.equal(view.state.field(test.field).text, 'A quiet', 'the streaming preview is trimmed like the final text');
    view.dispatch({ changes: { from: 0, insert: 'New opening.\n\n' }, userEvent: 'input.type',
      ...(remote ? { annotations: Transaction.addToHistory.of(false) } : {}) });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await test.run();
  assert.equal(test.view.state.field(test.field).phase, 'review');
  assert.equal(test.view.state.field(test.field).text, 'A quiet garden.');
  assert.equal(test.view.state.doc.toString(), 'New opening.\n\n' + draft);
  assert.equal(test.snapshots.length, 0, 'an unaccepted suggestion must not write the draft');
  test.review('Accept');
  const expected = 'New opening.\n\nOpening.\n\nA quiet garden.\n\nEnding.';
  assert.equal(test.view.state.doc.toString(), expected);
  assert.equal(test.view.state.selection.main.head, expected.length, 'generation must not steal the caret');
  assert.equal(test.view.state.field(test.field), null);
  assert.equal(test.jobs.size, 0);
  assert.equal(test.requests[0].url, '/write');
  assert.equal(test.requests[0].body.document, draft);
  assert.equal(test.snapshots.length, 1);
  assert(undo(test.view));
  assert.equal(test.view.state.doc.toString(), 'New opening.\n\n' + draft, 'one undo restores the request and preserves other edits');
}

for (const failure of ['inside', 'delete', 'boundary', 'same-text-replacement', 'abort', 'disconnect', 'empty', 'readonly', 'save-paused', 'switch']) {
  let expected = draft;
  const test = setup(async ({ view, context, jobs }) => {
    const range = view.state.field(test.field);
    if (failure === 'inside') view.dispatch({ changes: { from: range.from + 9, insert: 'my ' } });
    if (failure === 'delete') view.dispatch({ changes: { from: range.from, to: range.to } });
    if (failure === 'boundary') view.dispatch({ changes: { from: range.to, insert: ' More.' } });
    if (failure === 'same-text-replacement') view.dispatch({ changes: { from: range.from, to: range.to, insert: range.quote } });
    if (failure === 'abort') [...jobs][0].abort();
    if (failure === 'readonly') view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
    if (failure === 'save-paused') context.savePaused = true;
    if (failure === 'switch') context.documentKey = 'other-draft';
    expected = view.state.doc.toString();
    if (failure === 'disconnect') throw new Error('Connection lost');
  });
  if (failure === 'empty') test.context.sseChunks = async function* () {};
  await test.run();
  assert.equal(test.view.state.doc.toString(), expected, failure);
  assert.equal(test.view.state.field(test.field), null, failure);
  assert.equal(test.snapshots.length, 0, failure);
  assert.equal(test.jobs.size, 0, failure);
}
// Reject leaves the original request; a stale button cannot accept a different proposal.
{
  const test = setup();
  await test.run();
  const oldJob = test.view.state.field(test.field).job;
  test.review('Reject');
  assert.equal(test.view.state.doc.toString(), draft);
  assert.equal(test.view.state.field(test.field), null);
  assert.equal(test.snapshots.length, 0);
  await test.run();
  test.context.reviewGeneration(test.view, 'Accept', oldJob);
  assert.equal(test.view.state.doc.toString(), draft);
  assert.equal(test.view.state.field(test.field).phase, 'review');
  test.view.dispatch({ changes: { from: 0, insert: 'New.\n\n' } });
  test.context.sseChunks = async function* () { yield { text: 'A second garden.' }; };
  await test.review('Regenerate');
  assert.equal(test.view.state.field(test.field).text, 'A second garden.');
  assert.equal(test.requests.at(-1).body.instruction, 'Describe a quiet garden.');
  assert.equal(test.requests.at(-1).body.document, 'New.\n\n' + draft);
  assert.equal(test.requests.at(-1).body.previous, 'A quiet garden.');
  test.review('Accept');
  assert.equal(test.view.state.doc.toString(), 'New.\n\nOpening.\n\nA second garden.\n\nEnding.');
}

// Server correction replaces the current preview rather than appending two attempts.
{
  const test = setup();
  await test.run();
  test.context.fetch = async (url, options) => {
    const preview = test.view.state.field(test.field);
    assert.equal(preview.text, 'A quiet garden.', 'keep the old suggestion visible until new tokens arrive');
    assert.equal(preview.phase, 'streaming');
    assert.equal(JSON.parse(options.body).previous, 'A quiet garden.');
    return { ok: true };
  };
  test.context.sseChunks = async function* () {
    yield { text: 'An echoed first attempt' };
    yield { replace: '' };
    yield { text: 'Existing context. A new garden.' };
    yield { replace: 'A new garden.' };
  };
  await test.review('Regenerate');
  assert.equal(test.view.state.field(test.field).text, 'A new garden.');
  assert.equal(test.view.state.doc.toString(), draft);
}

// A failed or stopped regeneration keeps the previous proposal reviewable.
for (const failure of ['abort', 'disconnect', 'empty']) {
  const test = setup();
  await test.run();
  test.context.sseChunks = async function* () {
    if (failure === 'empty') return;
    yield { text: 'Incomplete second answer' };
    if (failure === 'abort') [...test.jobs][0].abort();
    else throw new Error('Disconnected');
  };
  await test.review('Regenerate');
  assert.equal(test.view.state.doc.toString(), draft);
  assert.equal(test.view.state.field(test.field).phase, 'review');
  assert.equal(test.view.state.field(test.field).text, 'A quiet garden.');
  test.review('Accept');
  assert.equal(test.view.state.doc.toString(), 'Opening.\n\nA quiet garden.\n\nEnding.');
}

// Pending proposals map edits elsewhere but cannot overwrite a changed request.
for (const blocked of ['inside', 'paused', 'readonly', 'switch']) {
  const test = setup();
  await test.run();
  const target = test.view.state.field(test.field);
  if (blocked === 'inside') test.view.dispatch({ changes: { from: target.from + 1, insert: 'My ' } });
  if (blocked === 'paused') test.context.savePaused = true;
  if (blocked === 'readonly') test.view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
  if (blocked === 'switch') test.context.documentKey = 'other';
  const before = test.view.state.doc.toString();
  test.context.reviewGeneration(test.view, 'Accept', target.job);
  assert.equal(test.view.state.doc.toString(), before, blocked);
  assert.equal(test.snapshots.length, 0, blocked);
}

// Waiting and regeneration show the shared skeleton in place of the words.
{
  const test = setup();
  // The widget is module code: it builds with the page's document.
  globalThis.document = { createElement: tag => ({ tag, children: [], attributes: {}, textContent: '',
    style: { setProperty(key, value) { this[key] = value; } },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener() {},
    append(...children) { this.children.push(...children); },
  }) };
  const Widget = vm.runInContext('GenerationWidget', test.context);
  const waiting = new Widget({ job: {}, phase: 'streaming', text: '', instruction: 'Describe a quiet garden.' });
  const dom = waiting.toDOM(), [skeleton] = dom.children;
  assert.equal(dom.attributes['aria-busy'], 'true');
  assert.equal(dom.children.length, 1, 'waiting shows only the skeleton');
  assert.equal(skeleton.className, 'generation-skeleton');
  assert.equal(skeleton.textContent, 'Describe a quiet garden.', 'the skeleton takes the shape of the request');
  assert.equal(skeleton.attributes['aria-hidden'], 'true');
  assert.equal(new Widget({ job: {}, phase: 'streaming', text: '' }).toDOM().children[0].textContent, 'Writing a new passage…');

  const regeneration = { job: {}, phase: 'streaming', text: 'Previous', previousText: 'Previous' };
  const regenerating = new Widget(regeneration), regen = regenerating.toDOM();
  assert.equal(regen.children.length, 1);
  assert.equal(regen.children[0].className, 'generation-skeleton');
  assert.equal(regen.children[0].textContent, 'Previous', 'regeneration waits in the shape of the old candidate');
  assert(!regenerating.eq(new Widget({ ...regeneration, previousText: null })), 'first tokens replace the skeleton even when they repeat the old text');

  for (const phase of ['streaming', 'review']) {
    const text = new Widget({ job: {}, phase, text: 'Ready' }).toDOM();
    assert.equal(text.children.length, 1);
    assert.equal(text.children[0].className, 'cm-suggest');
  }
  const inline = new Widget({ job: {}, phase: 'review', text: 'First line.\nSecond line.', inline: true });
  assert.equal(inline.toDOM().tag, 'span');
  assert.equal(inline.lineBreaks, 1);
  delete globalThis.document;
}

// Keyboard review applies only at the proposal, not while writing another paragraph.
{
  const test = setup();
  await test.run();
  test.view.dispatch({ selection: { anchor: 0 } });
  assert.equal(test.context.generationKey(test.view, 'Accept'), false);
  assert.equal(test.view.state.doc.toString(), draft);
  test.view.dispatch({ selection: { anchor: test.view.state.field(test.field).to } });
  assert.equal(test.context.generationKey(test.view, 'Reject'), true);
  assert.equal(test.view.state.field(test.field), null);
  await test.run();
  assert.equal(test.context.generationKey(test.view, 'Accept'), true);
  assert.equal(test.view.state.doc.toString(), 'Opening.\n\nA quiet garden.\n\nEnding.');
}

const missing = setup();
missing.context.ensureAgent = async () => false;
await missing.run();
assert.equal(missing.view.state.doc.toString(), draft);
assert.equal(missing.requests.length, 0);
assert.equal(missing.view.state.field(missing.field), null);

// Only an explicit complete command starts a request; ordinary prose stays editable.
const commands = setup();
commands.view.dispatch({ selection: { anchor: 2 } });
assert.equal(commands.context.handleWrite(commands.view), false);
commands.view.state = EditorState.create({ doc: '/ ', selection: { anchor: 2 }, extensions: [commands.field] });
assert.equal(commands.context.handleWrite(commands.view), true);
assert.match(commands.notices.at(-1), /Write a request/);
commands.view.state = EditorState.create({ doc: '/Test request', selection: { anchor: 3 }, extensions: [commands.field] });
assert.equal(commands.context.handleWrite(commands.view), false, 'Enter in the middle of a command remains a newline');
await new Promise(resolve => setImmediate(resolve));
assert.equal(commands.requests.length, 0, 'no generation was started');

// A slash starts the request directly; typing and moving the caret update its highlight.
{
  const test = setup();
  const field = vm.runInContext('requestField', test.context);
  let state = EditorState.create({ doc: '', extensions: [field] });
  assert.equal(state.field(field).size, 0);
  const parts = state => { const out = []; for (const it = state.field(field).iter(); it.value; it.next()) out.push(it.value.spec.class ?? `hidden ${it.from}-${it.to}`); return out.sort(); };
  state = state.update({ changes: { from: 0, insert: '/' }, selection: { anchor: 1 } }).state;
  assert.deepEqual(parts(state), ['cm-generation-request', 'hidden 0-1'], 'a bare slash is hidden; the line background marks the request');
  state = state.update({ changes: { from: 1, insert: 'Напиши вступление\n\nОбычный текст' }, selection: { anchor: 2 } }).state;
  assert.deepEqual(parts(state), ['cm-generation-request', 'hidden 0-1']);
  state = state.update({ selection: { anchor: state.doc.length } }).state;
  assert.equal(state.field(field).size, 0);
  state = state.update({ selection: { anchor: 1 } }).state;
  assert.deepEqual(parts(state), ['cm-generation-request', 'hidden 0-1']);
  state = state.update({ changes: { from: 0, to: 1 } }).state;
  assert.equal(state.field(field).size, 0);
  const prefix = 'See /notes.';
  state = EditorState.create({ doc: prefix, extensions: [field] });
  state = state.update({ changes: { from: prefix.length, insert: '/' },
    selection: { anchor: prefix.length + 1 }, userEvent: 'input.type' }).state;
  assert.equal(test.context.slashRequest(state).from, prefix.length);
  assert.deepEqual(parts(state), ['cm-inline-request', 'hidden 11-12', 'hidden 12-12']);
  state = state.update({ changes: { from: prefix.length + 1, insert: 'Compare A / B' },
    selection: { anchor: prefix.length + 14 }, userEvent: 'input.type' }).state;
  assert.equal(test.context.slashRequest(state).instruction, 'Compare A / B');
  assert.deepEqual(parts(state), ['cm-generation-request', 'cm-inline-request', 'hidden 11-12', 'hidden 25-25']);
  for (const text of ['/Напиши вступление', '/ Напиши вступление', '  /  Напиши вступление  ']) {
    test.view.state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [test.field] });
    const asked = test.requests.length;
    assert.equal(test.context.handleWrite(test.view), true);
    while (test.jobs.size) await new Promise(resolve => setImmediate(resolve));
    const { body } = test.requests[asked];
    assert.equal(body.instruction, 'Напиши вступление');
    assert.equal(body.from, text.indexOf('/'), 'the request starts at the slash');
    assert.equal(body.cursor, text.length);
  }
  test.view.state = EditorState.create({ doc: 'Обычный текст', selection: { anchor: 12 }, extensions: [test.field] });
  assert.equal(test.context.handleWrite(test.view), false);
}
// Inline commands preserve the existing prefix through preview, acceptance and Undo.
{
  const test = setup();
  const prefix = 'The garden was quiet. ';
  const text = prefix + '/Continue the scene';
  const requestField = vm.runInContext('requestField', test.context);
  test.view.state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [test.field, requestField, history()] });
  const request = test.context.slashRequest(test.view.state);
  assert.equal(request.from, prefix.length);
  assert.equal(request.text, '/Continue the scene');
  assert.equal(request.instruction, 'Continue the scene');
  assert.equal(request.inline, true);
  const highlight = test.view.state.field(requestField).iter();
  assert.equal(highlight.value.spec.class, 'cm-inline-request');
  highlight.next();
  assert.deepEqual([highlight.from, highlight.to], [prefix.length, prefix.length + 1]);
  highlight.next();
  assert.equal(highlight.value.spec.class, 'cm-generation-request');
  assert.deepEqual([highlight.from, highlight.to], [prefix.length + 1, text.length], 'highlight only the request');
  await test.context.generateFromLine(test.view, request, request.instruction);
  assert.equal(test.view.state.doc.toString(), text);
  assert.equal(test.view.state.field(test.field).inline, true);
  assert.equal(test.requests[0].body.from, prefix.length);
  assert.equal(test.view.state.field(requestField).size, 0, 'the preview uses ghost styling without request background');
  test.review('Accept');
  assert.equal(test.view.state.doc.toString(), prefix + 'A quiet garden.');
  assert(undo(test.view));
  assert.equal(test.view.state.doc.toString(), text);
}

// R regenerates a ready proposal; repeated R presses during that request do not type into the draft.
{
  const test = setup();
  await test.run();
  test.view.dispatch({ selection: { anchor: 0 } });
  assert.equal(test.context.generationKey(test.view, 'Regenerate'), false);
  test.view.dispatch({ selection: { anchor: test.view.state.field(test.field).to } });
  test.view.composing = true;
  assert.equal(test.context.generationKey(test.view, 'Regenerate'), false);
  test.view.composing = false;
  test.context.sseChunks = async function* () { yield { text: 'A different garden.' }; };
  assert.equal(test.context.generationKey(test.view, 'Regenerate'), true);
  assert.equal(test.context.generationKey(test.view, 'Regenerate'), true);
  while (test.jobs.size) await new Promise(resolve => setImmediate(resolve));
  assert.equal(test.requests.length, 2, 'only one regeneration starts');
  assert.equal(test.requests[1].body.previous, 'A quiet garden.');
  assert.equal(test.view.state.doc.toString(), draft, 'R is not inserted into the request');
  assert.equal(test.view.state.field(test.field).text, 'A different garden.');
}

// URLs, word separators, paths and comments are ordinary text, not slash requests.
{
  const test = setup();
  const requestField = vm.runInContext('requestField', test.context);
  for (const text of [
    'Visit https://example.com/path',
    'Use foo/bar',
    '// comment',
    'See /etc/hosts',
    'Check /api/draft',
    'Edit /usr/local/bin/node',
    'Ratio 1 / 2 is fine.',
  ]) {
    test.view.state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [test.field, requestField] });
    assert.equal(test.context.slashRequest(test.view.state), null, text);
    assert.equal(test.view.state.field(requestField).size, 0, text);
    assert.equal(test.context.handleWrite(test.view), false, text);
  }
  for (const [text, expected] of [
    ['/explain /usr/bin', 'explain /usr/bin'],
    ['Existing text. /Explain /usr/bin', 'Explain /usr/bin'],
  ]) {
    test.view.state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [test.field, requestField] });
    assert.equal(test.context.slashRequest(test.view.state).instruction, expected, text);
  }
  // Explicitly typing "/" after a path still starts an inline command via typedSlash.
  const base = 'See /etc/hosts ';
  let state = EditorState.create({ doc: base, selection: { anchor: base.length }, extensions: [test.field, requestField] });
  assert.equal(test.context.slashRequest(state), null);
  state = state.update({ changes: { from: base.length, insert: '/' }, selection: { anchor: base.length + 1 }, userEvent: 'input.type' }).state;
  state = state.update({ changes: { from: base.length + 1, insert: 'explain it' }, selection: { anchor: base.length + 11 }, userEvent: 'input.type' }).state;
  assert.equal(test.context.slashRequest(state).from, base.length);
  assert.equal(test.context.slashRequest(state).instruction, 'explain it');
}

// Try again callback on /write error retries when the request line is intact and skips if edited.
{
  const test = setup();
  const retries = [];
  test.context.notifyProblem = (problem, action) => { test.notices.push(problem.say); retries.push(action); };
  const okFetch = test.context.fetch;
  test.context.fetch = async (url, options) => {
    test.requests.push({ url, body: JSON.parse(options.body), signal: options.signal });
    return { ok: false, status: 502, json: async () => ({ error: 'HTTP 502' }) };
  };
  await test.run();
  assert.equal(typeof retries[0], 'function', '/write failure must provide a retry callback');
  assert.equal(test.view.state.field(test.field), null);

  test.context.fetch = okFetch;
  await retries[0]();
  assert.equal(test.requests.length, 2);
  assert.equal(test.view.state.field(test.field).phase, 'review');
  assert.equal(test.view.state.field(test.field).text, 'A quiet garden.');

  // If the request line changed before clicking Try again, retry must not fire.
  const testEdited = setup();
  const editedRetries = [];
  testEdited.context.notifyProblem = (problem, action) => { testEdited.notices.push(problem.say); editedRetries.push(action); };
  testEdited.context.fetch = async (url, options) => {
    testEdited.requests.push({ url, body: JSON.parse(options.body), signal: options.signal });
    return { ok: false, status: 502, json: async () => ({ error: 'HTTP 502' }) };
  };
  await testEdited.run();
  assert.equal(typeof editedRetries[0], 'function');
  const slashPos = draft.indexOf('/Describe');
  testEdited.view.dispatch({ changes: { from: slashPos + 1, to: slashPos + 9, insert: 'Changed' } });
  await editedRetries[0]();
  assert.equal(testEdited.requests.length, 1, 'retry must not fire after the request line changed');
}

// Leading horizontal indentation is preserved during streaming and upon acceptance.
{
  const test = setup();
  const seen = [];
  test.context.sseChunks = async function* () {
    yield { text: '\n  - nested ' };
    seen.push(test.view.state.field(test.field).text);
    yield { text: 'item\n' };
  };
  await test.run();
  assert.equal(test.view.state.field(test.field).text, '  - nested item');
  test.review('Accept');
  assert.equal(test.view.state.doc.toString(), 'Opening.\n\n  - nested item\n\nEnding.');
}

console.log('Generation checks passed: inline slash requests, R regeneration, concurrent edits, review and Undo.');
