import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { ghostRemainder } from '../../extension/writing-rules.js';

// ─── Ghost text ─────────────────────────────────────────────────────────────────
//
//  State: { text: string, pos: number } | null
//
//  Life-cycle:
//    suggestFetch() → ghostShow()  — set ghost at current cursor
//    tr.docChanged  → null         — user typed, clear immediately
//    tr.selection   → null         — cursor moved, clear immediately
//    Tab            → ghostAccept() — insert text, clear
//    Escape         → ghostClear() — dismiss
//

class GhostWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }

  eq(other) { return other.text === this.text; }

  toDOM() {
    const span = document.createElement('span');
    span.className   = 'cm-suggest';
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() { return true; }
}

export const setGhostFx   = StateEffect.define();
export const clearGhostFx = StateEffect.define();

// Ghost state field — also provides decorations
export const ghostField = StateField.define({
  create: () => null,

  update(val, tr) {
    // Typing the ghost's own next characters keeps the rest on screen, so
    // no new request is needed until the writer leaves the suggestion.
    if (val && tr.docChanged && tr.isUserEvent('input.type')) {
      let typed = null;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        typed = typed === null && fromA === val.pos && toA === val.pos ? inserted.toString() : false;
      });
      const pos = val.pos + (typed ? typed.length : 0);
      const head = tr.newSelection.main;
      if (typed && val.text.startsWith(typed) && head.empty && head.head === pos) {
        const remaining = ghostRemainder(val.text, typed);
        return remaining ? { text: remaining, pos } : null;
      }
      return null;
    }
    if (tr.docChanged) return null;  // typing → clear
    if (tr.selection)  return null;  // cursor moved → clear
    for (const e of tr.effects) {
      if (e.is(setGhostFx))   return e.value;   // { text, pos }
      if (e.is(clearGhostFx)) return null;
    }
    return val;
  },

  // Inline after the caret, as faded text. Suggestions only fire at a
  // paragraph end, so nothing of the writer's is pushed aside.
  provide: f => EditorView.decorations.from(f, ghost => {
    if (!ghost) return Decoration.none;
    const w = Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 });
    return Decoration.set([w.range(ghost.pos)]);
  }),
});

export function ghostShow(view, text) {
  const pos = view.state.selection.main.head;
  view.dispatch({
    // The margin keeps the continuation clear of the chat strip.
    effects: [setGhostFx.of({ text, pos }), EditorView.announce.of(`Suggestion: ${text.trim()}. Tab to accept; Escape to dismiss.`), EditorView.scrollIntoView(pos, { y: 'nearest', yMargin: 72 })],
  });
}

export function ghostClear(view) {
  view.dispatch({ effects: clearGhostFx.of(null) });
}

// Accept ghost: insert suggestion text at ghost.pos, move cursor after it
export function ghostAccept(view) {
  const ghost = view.state.field(ghostField);
  if (!ghost || view.state.readOnly || !view.hasFocus || !view.state.selection.main.empty) return false;
  view.dispatch({
    changes:   { from: ghost.pos, insert: ghost.text },
    selection: { anchor: ghost.pos + ghost.text.length },
    effects:   clearGhostFx.of(null),
    userEvent: 'input.acceptGhost',
  });
  return true;
}
