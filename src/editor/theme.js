import { EditorView, Decoration } from '@codemirror/view';

// The editor's look, injected into <head> by CodeMirror. `dark` only tells
// CodeMirror which base theme to pair it with; colours come from CSS variables.
export const createEditorTheme = dark => EditorView.theme({
  // Root element — fills the #editor-wrapper flex container
  '&': {
    height:     '100%',
    background: 'var(--surface)',
  },

  // Remove the focus ring CM6 adds by default
  '&.cm-focused': {
    outline: 'none',
  },

  // Scrollable area — inherits the writing font
  '.cm-scroller': {
    fontFamily: 'var(--font)',
    fontSize:   '17px',
    lineHeight: '1.75',
    overflowY:  'auto',
    // Reserve scrollbar space without a left gutter, which offsets CM's cursor layer.
    scrollbarGutter: 'stable',
  },

  // Editable content area — generous padding, centred like the old textarea
  '.cm-content': {
    // The measure is set in characters, so it holds if the size changes. It
    // gives way before the notes do: between 52ch and 68ch the column shrinks
    // so the margin keeps room for the rail (RAIL_WIDTH + RAIL_GUTTER a side).
    // Only below 52ch do notes fall back to the chat stream.
    padding:    '28px max(32px, calc((100% - clamp(52ch, 100% - 2 * 244px, 68ch)) / 2))',
    caretColor: 'var(--accent)',
    color:      'var(--text)',
    minHeight:  '100%',
  },

  // Each line — no extra horizontal padding (already on .cm-content)
  '.cm-line': { padding: '0' },

  // Cursor
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '1.5px',
  },

  // Selection highlight: a mark on the selected text itself (textSelection
  // below). CodeMirror's selection rectangles span the content box, which
  // includes the wide side margins of the centred column, so a selection over
  // several lines lit up the whole window; and tinting the native ::selection
  // let the browser do the same. Both stay transparent.
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    background: 'transparent !important',
  },
  '.cm-selected-text': {
    background: 'var(--attached-tint)',
    boxDecorationBreak: 'clone',
  },

  // ── Suggestion ─────────────────────────────────────────────────────────────
  //
  //  Continuation text after the caret, same face as the draft but fainter.
  //  Nothing is added to the document until Tab; accepted text is plain
  //  document text, so it simply loses this class. Escape dismisses.
  //
  '.cm-suggest': {
    opacity:       '0.45',
    pointerEvents: 'none',
    userSelect:    'none',
  },

  // Working ranges share one blue wash; no outsets that touch adjacent lines.
  '.cm-attached': {
    background: 'var(--attached-tint)',
    borderRadius: '2px',
    boxDecorationBreak: 'clone',
  },
  '.cm-note': {
    textDecoration: 'underline dotted var(--muted)',
    textUnderlineOffset: '4px',
    cursor: 'pointer',
  },
  '.cm-note.is-drifted': { textDecorationStyle: 'dashed' },

  // Slightly dim the content while the document is loading.
  '&.streaming .cm-content': { opacity: '0.8' },

  '.cm-generation': { whiteSpace: 'break-spaces' },

  '.cm-generation-request': { background: 'var(--attached-tint)', borderRadius: '2px' },

  // Hide gutters and fold markers — this is a prose editor
  '.cm-gutters': { display: 'none' },
}, { dark });

// The selection, drawn on the selected characters only.
const selectedText = Decoration.mark({ class: 'cm-selected-text' });
export const textSelection = EditorView.decorations.compute(['selection'], state =>
  Decoration.set(state.selection.ranges.filter(range => !range.empty).map(range => selectedText.range(range.from, range.to)), true));
