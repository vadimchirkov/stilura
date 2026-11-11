import { StateEffect, StateField } from '@codemirror/state';
import { loadLinter, lintMarkers } from '../../spellcheck.js';

// ─── Spelling marks ─────────────────────────────────────────────────────────
//
//  A deterministic, offline check for spelling and grammar errors (Harper) —
//  distinct from the style tells above, which flag wording choices rather
//  than errors. Fixes are instant swaps and need no model call.
//
// ponytail: "Ignore" only survives the tab session. Persist it in browser storage
// if writers hit the same false positive across reloads.
// Carries the markers of a finished check; the check itself is asynchronous.
const refreshSpellFx = StateEffect.define();
// Marks are plain ranges drawn by a view plugin, not a DecorationSet. Mapping
// keeps an underline on the word it belongs to while typing, and re-reading
// the quote keeps a click on it offering suggestions for the text that is
// actually underlined now.
function mapSpellMarkers(markers, tr) {
  const out = [];
  for (const marker of markers) {
    const from = tr.changes.mapPos(marker.from, 1), to = tr.changes.mapPos(marker.to, -1);
    if (to > from) out.push({ ...marker, from, to, quote: tr.newDoc.sliceString(from, to) });
  }
  return out;
}
export const spellMarkerField = StateField.define({
  create: () => [],
  update: (markers, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(refreshSpellFx)) return effect.value;
    }
    // A keystroke moves the existing marks along with the text and leaves the
    // checker alone; the full pass runs once typing pauses
    // (scheduleSpellCheck). Checking every word in the draft on every key was
    // the largest single cost of typing a long document.
    return tr.docChanged ? mapSpellMarkers(markers, tr) : markers;
  },
});

// `view` is read at call time: the editor is created after this module's
// field is handed to it.
export function createSpelling({ view }) {
  let spellChecker = null;
  // Long enough to skip the middle of a word, short enough that the underline
  // is there by the time the writer reads the sentence back.
  const SPELL_RECHECK_MS = 250;
  let spellRecheck = 0;
  function scheduleSpellCheck() {
    clearTimeout(spellRecheck);
    spellRecheck = setTimeout(() => {
      spellRecheck = 0;
      runSpellCheck();
    }, SPELL_RECHECK_MS);
  }
  function runSpellCheck() {
    if (!spellChecker) return;
    const doc = view().state.doc;
    lintMarkers(doc.toString(), spellChecker).then(markers => {
      // Typing during the check moved the text under these offsets: drop them,
      // the mapped marks stay on screen, and check again after the pause.
      if (view().state.doc !== doc) scheduleSpellCheck();
      else view().dispatch({ effects: refreshSpellFx.of(markers) });
    }).catch(error => console.warn('[spell]', error.message));
  }

  async function start() {
    spellChecker = await loadLinter();
    runSpellCheck();
  }
  return { schedule: scheduleSpellCheck, run: runSpellCheck, start };
}
