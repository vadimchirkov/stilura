import { createPassageInput } from '../extension/editor-ui.js';
import * as writingRules from '../extension/writing-rules.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EditorState, StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, showTooltip } from '@codemirror/view';
import { history, undo, isolateHistory } from '@codemirror/commands';
import { mapChatEdit } from '../chat-edits.js';
import { modelError } from '../src/notices.js';
import { appSection, appSource, generateIn, passageIn } from './app-source.mjs';

const source = appSource;
const draft = 'Opening. The quiet garden waited. Ending. The quiet garden waited.';
function setup({ beforeReply = () => {}, result } = {}) {
  const jobs = new Set(), requests = [], notices = [], snapshots = [];
  const view = { composing: false, focus() {} };
  const context = vm.createContext({
    ...writingRules, createPassageInput,
    EditorState, StateField, StateEffect, EditorView, Decoration, WidgetType, showTooltip, isolateHistory,
    mapChatEdit, AbortController, documentKey: 'draft', document: { activeElement: null },
    loadingDocument: false, savePaused: false, jobs, clearGhostFx: StateEffect.define(), cancelSuggestion() {}, ghostClear() {},
    startJob() { const job = new AbortController(); jobs.add(job); return job; }, finishJob: job => jobs.delete(job),
    ensureAgent: async () => true, currentAgent: () => ({ provider: 'fixture', model: 'test' }),
    combinedContext: () => '', saveSnapshot: label => snapshots.push(label), notify: text => notices.push(text),
    modelError: error => ({ say: error.message }),
    notifyProblem: problem => notices.push(problem.say),
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body), signal: options.signal });
      await beforeReply({ view, context, jobs });
      return { ok: true, json: async () => result ?? (JSON.parse(options.body).instruction.includes('mean') ? { answer: 'It describes a peaceful garden.', variants: [] } : { answer: '', variants: ['peaceful', 'tranquil', 'still'] }) };
    },
  });
  generateIn(context);
  passageIn(context);
  const field = vm.runInContext('passageField', context), gen = vm.runInContext('generationField', context);
  const effect = vm.runInContext('setPassageFx', context);
  const from = draft.indexOf('quiet'), to = from + 5;
  view.state = EditorState.create({ doc: draft, selection: { anchor: from, head: to }, extensions: [gen, field, history()] });
  view.dispatch = spec => {
    view.state = view.state.update(spec).state;
    for (const job of jobs) if (!view.state.field(field) || view.state.readOnly) job.abort();
  };
  assert(context.openPassage(view, view.state.selection.main));
  const configure = instruction => view.dispatch({ effects: effect.of({ ...view.state.field(field), instruction }) });
  const ask = previous => context.requestPassage(view, previous);
  return { view, context, field, gen, requests, jobs, snapshots, notices, configure, ask };
}

const question = setup();
question.configure('What does this word mean here?');
await question.ask();
assert.equal(question.requests[0].url, '/ask');
assert.equal(question.requests[0].body.selected, 'quiet');
assert.equal(question.requests[0].body.from, draft.indexOf('quiet'));
assert.match(question.view.state.field(question.field).answer, /peaceful/);
assert.equal(question.view.state.doc.toString(), draft);
assert.equal(question.view.state.field(question.gen), null);
assert.equal(question.snapshots.length, 0);

// A mapped replacement stays on the selected occurrence, preserving other edits and Undo.
const rewrite = setup({ beforeReply: ({ view }) => view.dispatch({ changes: { from: 0, insert: 'New opening. ' } }) });
rewrite.configure('Use simpler wording.');
await rewrite.ask();
let candidate = rewrite.view.state.field(rewrite.gen);
assert.equal(candidate.source, 'passage');
assert.equal(candidate.from, draft.indexOf('quiet') + 'New opening. '.length);
assert.equal(rewrite.view.state.doc.toString(), 'New opening. ' + draft);
rewrite.view.dispatch({ selection: { anchor: candidate.to } });
assert(rewrite.context.generationKey(rewrite.view, 'Next'));
assert.equal(rewrite.view.state.field(rewrite.gen).text, 'tranquil');
assert(rewrite.context.generationKey(rewrite.view, 'Accept'));
assert.equal(rewrite.view.state.doc.toString(), 'New opening. ' + draft.replace('quiet', 'tranquil'));
assert.equal(rewrite.view.state.field(rewrite.field), null);
assert(undo(rewrite.view));
assert.equal(rewrite.view.state.doc.toString(), 'New opening. ' + draft);

const synonyms = setup({ result: { variants: ['quiet', 'peaceful', 'peaceful', 'tranquil'] } });
synonyms.configure('Find synonyms.');
await synonyms.ask();
assert.equal(synonyms.requests[0].url, '/ask');
assert.equal(synonyms.requests[0].body.instruction, 'Find synonyms.');
assert.deepEqual(Array.from(synonyms.view.state.field(synonyms.gen).variants), ['peaceful', 'tranquil']);
synonyms.view.dispatch({ selection: { anchor: synonyms.view.state.field(synonyms.gen).to } });
assert(synonyms.context.generationKey(synonyms.view, 'Previous'));
assert.equal(synonyms.view.state.field(synonyms.gen).text, 'tranquil');
await synonyms.context.reviewGeneration(synonyms.view, 'Regenerate', synonyms.view.state.field(synonyms.gen).job);
assert(synonyms.requests[1].body.instruction.includes('tranquil'));
assert.equal(synonyms.view.state.field(synonyms.gen).text, 'peaceful');
assert(synonyms.context.generationKey(synonyms.view, 'Reject'));
assert.equal(synonyms.view.state.field(synonyms.gen), null);
assert.equal(synonyms.view.state.field(synonyms.field), null);
assert.equal(synonyms.view.state.doc.toString(), draft);

for (const stop of ['edit', 'close', 'switch', 'readonly']) {
  const test = setup({ beforeReply: ({ view, context }) => {
    if (stop === 'edit') view.dispatch({ changes: { from: draft.indexOf('quiet'), to: draft.indexOf('quiet') + 5, insert: 'my' } });
    if (stop === 'close') context.closePassage(view);
    if (stop === 'switch') context.documentKey = 'other';
    if (stop === 'readonly') view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
  } });
  test.configure('Make it simpler.');
  await test.ask();
  assert.equal(test.view.state.field(test.gen), null, stop);
  assert.equal(test.view.state.doc.toString(), stop === 'edit' ? draft.replace('quiet', 'my') : draft, stop);
  assert.equal(test.jobs.size, 0, stop);
}

const failed = setup();
failed.configure('Make it simpler.');
await failed.ask();
const previous = failed.view.state.field(failed.gen);
failed.context.fetch = async () => { throw new Error('Provider unavailable'); };
await failed.context.reviewGeneration(failed.view, 'Regenerate', previous.job);
assert.equal(failed.view.state.field(failed.gen).text, previous.text);
assert.equal(failed.view.state.doc.toString(), draft);
assert.equal(failed.view.state.field(failed.field).busy, false);
assert.match(failed.view.state.field(failed.field).answer, /previous suggestion is kept/);

const noModel = setup();
noModel.context.ensureAgent = async () => false;
noModel.configure('Why?');
await noModel.ask();
assert.equal(noModel.requests.length, 0);
assert.equal(noModel.view.state.field(noModel.field).busy, false);
assert.equal(noModel.jobs.size, 0);

// Non-JSON error bodies preserve the HTTP status for modelError instead of throwing SyntaxError.
{
  const problems = [];
  const nonJson = setup();
  nonJson.context.modelError = modelError;
  nonJson.context.notifyProblem = problem => problems.push(problem);
  nonJson.configure('Make it clearer.');

  nonJson.context.fetch = async () => ({ ok: false, status: 502, text: async () => 'Bad Gateway' });
  await nonJson.ask();
  assert.equal(problems.length, 1);
  assert.equal(problems[0].say, 'The provider hit an error.');
  assert.equal(problems[0].act, 'retry');
  assert.equal(problems[0].detail, 'HTTP 502');

  nonJson.context.fetch = async () => ({ ok: false, status: 413, text: async () => '<html>413 Payload Too Large</html>' });
  await nonJson.ask();
  assert.equal(problems.length, 2);
  assert.match(problems[1].say, /too long/i);
  assert.equal(problems[1].act, 'settings');
  assert.equal(problems[1].detail, 'HTTP 413');

  nonJson.context.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>not json</html>' });
  await nonJson.ask();
  assert.equal(problems.length, 3);
  assert.equal(problems[2].detail, 'The model returned an invalid response.');
  assert.equal(problems[2].act, 'retry');
}

// modelError extracts structured/embedded HTTP codes and routes local auth/setup failures to Settings.
{
  const fromProp = modelError(Object.assign(new Error('Unauthorized'), { status: 401 }));
  assert.equal(fromProp.say, 'The API key was rejected.');
  assert.equal(fromProp.act, 'settings');

  const embedded429 = modelError(new Error('Provider failed with status 429: try again in 12s'));
  assert.equal(embedded429.say, 'The model is rate-limited. Try again in 12 s.');
  assert.equal(embedded429.act, 'retry');

  const embedded401 = modelError(new Error('Upstream HTTP 401 invalid api key'));
  assert.equal(embedded401.say, 'The API key was rejected.');
  assert.equal(embedded401.act, 'settings');

  // Arbitrary numbers like "4000 characters" must not be misread as HTTP 400.
  const notAStatus = modelError(new Error('Select up to 4000 characters.'));
  assert.equal(notAStatus.say, 'The model could not answer.');
  assert.equal(notAStatus.act, 'retry');

  for (const message of [
    'Pi model openai/gpt-4o is not authenticated or unavailable',
    'Unknown Pi model foo/bar',
    'No authenticated Pi model available',
    'Run claude auth login and sign in with Claude Pro or Max.',
    'Install Claude Code and claude-agent-acp, then check the connection in Settings.',
    'Install Antigravity (agy), then check the connection in Settings.',
    'Antigravity is not signed in. Run agy acp --login in Terminal.',
  ]) {
    const res = modelError(new Error(message));
    assert.equal(res.act, 'settings', message);
    assert.equal(res.tab, 'models', message);
    assert.notEqual(res.say, 'The model could not answer.', message);
  }
}

console.log('Passage checks passed: local questions, synonyms, mapped replacements, regeneration, stale guards and Undo.');

const modelScope = vm.createContext({ currentAgent: () => ({ provider: 'shared', model: 'one' }) });
vm.runInContext(appSection('function activeSuggestAgent()', 'combobox(providerEl);'), modelScope);
assert.equal(modelScope.activeSuggestAgent().model, 'one');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert(!html.includes('id="suggest-model"'));
assert(!source.includes("['ask', 'Ask']"));

assert(!fs.readFileSync(new URL('../src/features/bubble.js', import.meta.url), 'utf8').includes("bubbleButton('Note'"));
assert(!source.includes("      noteField,"));
