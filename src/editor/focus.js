import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';

// ─── Focus mode ───
// Only the paragraph being written stays at full strength; the rest of the
// draft fades back. While typing, the line keeps near the middle of the
// window, so the eye stays in one place instead of following the text down.
// The draft itself is untouched: these are decorations and scroll effects.

const dimmed = Decoration.line({ class: 'cm-focus-dim' });

// The paragraph around `pos`: the run of non-blank lines that contains it.
// A blank line is a paragraph of its own, so an empty line being typed into
// keeps the rest of the draft dimmed.
function paragraphAt(doc, pos) {
  let first = doc.lineAt(pos), last = first;
  if (!first.text.trim()) return { from: first.from, to: first.to };
  while (first.number > 1 && doc.line(first.number - 1).text.trim()) first = doc.line(first.number - 1);
  while (last.number < doc.lines && doc.line(last.number + 1).text.trim()) last = doc.line(last.number + 1);
  return { from: first.from, to: last.to };
}

function dimDecorations(view) {
  const { doc, selection } = view.state;
  const active = paragraphAt(doc, selection.main.head);
  const ranges = [];
  // Only what is on screen: a long draft costs no more than a short one.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      if (line.to < active.from || line.from > active.to) ranges.push(dimmed.range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges);
}

const dimOthers = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = dimDecorations(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = dimDecorations(update.view);
  }
}, { decorations: plugin => plugin.decorations });

// Typing keeps the caret's line centred. Only the writer's own input moves
// the page: a remote edit or a programmatic change scrolls nothing.
const centreWhileTyping = EditorState.transactionExtender.of(tr =>
  tr.docChanged && (tr.isUserEvent('input') || tr.isUserEvent('delete'))
    ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
    : null);

const focusCompartment = new Compartment();
const extension = [dimOthers, centreWhileTyping];

// Starts off; setFocusMode switches it on the live editor.
export const focusMode = focusCompartment.of([]);

export function setFocusMode(view, on) {
  view.dispatch({ effects: [
    focusCompartment.reconfigure(on ? extension : []),
    ...(on ? [EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' })] : []),
  ] });
}
