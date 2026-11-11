import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as generate from '../src/features/generate.js';
import * as passage from '../src/features/passage.js';
import { createDocumentState } from '../src/document-state.js';

// Some tests run a section of src/app.js cut out by text markers. A marker
// that moved or was renamed must fail loudly here, not hand the test an empty
// or truncated slice that then checks nothing.
export const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

export function appSection(start, end, { last = false } = {}) {
  const from = last ? appSource.lastIndexOf(start) : appSource.indexOf(start);
  assert(from >= 0, `src/app.js has no section start: ${JSON.stringify(start)}`);
  const to = appSource.indexOf(end, from);
  assert(to > from, `src/app.js has no section end after ${JSON.stringify(start)}: ${JSON.stringify(end)}`);
  return appSource.slice(from, to);
}

// The vm harnesses keep main()'s names as globals of a context. This builds
// the generation feature from them, read at call time so a test can swap one
// later, and puts its functions and state fields back into the context for
// the app.js sections that call them.
export function generateIn(context) {
  const late = name => (...args) => context[name](...args);
  const feature = generate.createGenerate({
    jobs: context.jobs,
    docState: context,
    passageFx: () => context.setPassageFx ?? null,
    fetch: late('fetch'),
    ...Object.fromEntries(['cancelSuggestion', 'closePassage', 'combinedContext', 'currentAgent', 'ensureAgent',
      'startJob', 'finishJob', 'notify', 'notifyProblem', 'requestPassage', 'saveSnapshot', 'sseChunks'].map(name => [name, late(name)])),
  });
  const { setGenerationFx, generationField, slashRequest, requestField } = generate;
  Object.assign(context, feature, { setGenerationFx, generationField, slashRequest, requestField });
  return feature;
}

// Same for the passage actions; build generation first, they share its field.
export function passageIn(context) {
  const late = name => (...args) => context[name](...args);
  const feature = passage.createPassage({
    jobs: context.jobs,
    docState: context,
    fetch: late('fetch'),
    ...Object.fromEntries(['cancelSuggestion', 'combinedContext', 'currentAgent', 'ensureAgent', 'startJob', 'finishJob',
      'notify', 'notifyProblem'].map(name => [name, late(name)])),
  });
  Object.assign(context, feature, { setPassageFx: passage.setPassageFx });
  return feature;
}

// app.js keeps the document's load and save state in one object, docState.
// In a vm harness that object is the context itself, so the names a test
// sets on the context (loadingDocument, savePaused, documentKey, …) are the
// ones the app code reads and writes.
export function docContext(globals) {
  const context = vm.createContext(globals);
  const { on, emit } = createDocumentState();
  Object.assign(context, { on, emit, docState: context });
  return context;
}
