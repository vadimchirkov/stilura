import { clampBubble } from '../../editing.js';
import { ignoreMarker } from '../../spellcheck.js';
import { chatEl } from '../dom.js';

// ── Mark bubble ──
//
//  Clicking a mark or selecting text arms nothing. The bubble beside the click
//  holds explicit actions: Change opens a local passage field; rewrite
//  actions ask for scoped replacements. One bubble at a
//  time; an edit, copy, or Escape puts it away — a scroll carries it along.
export function createBubble({ element, getView, openPassage, recheckSpelling }) {
  let bubbleMode = null;   // 'selection' | 'spell' while open

  function hideMarkBubble() {
    cancelDeferredBubble();
    bubbleAnchor = null;
    if (element.hidden) return;
    // Children stay: the bubble fades out (style.css), and emptied first it
    // would shrink to a sliver mid-fade. The next show replaces them.
    element.hidden = true;
    bubbleMode = null;
  }

  // Bubbles nobody asked for by name — after a selection, after a click at a
  // paragraph's end — wait a beat. Most such clicks are about to type, drag or
  // click again, and a toolbar flashing up for each reads as noise. Any key or
  // press in the meantime cancels; so does the text or caret moving on.
  // Clicking a mark is asking, so those bubbles still open at once.
  let bubbleTimer = 0;
  function deferBubble(show, ms) {
    clearTimeout(bubbleTimer);
    const { doc, selection } = getView().state;
    bubbleTimer = setTimeout(() => {
      bubbleTimer = 0;
      const now = getView().state;
      if (now.doc === doc && now.selection.main.eq(selection.main)) show();
    }, ms);
  }
  function cancelDeferredBubble() {
    clearTimeout(bubbleTimer);
    bubbleTimer = 0;
  }
  document.addEventListener('keydown', cancelDeferredBubble, true);
  document.addEventListener('mousedown', cancelDeferredBubble, true);

  // The box the bubble may live in: the writing pane, not the window — the file
  // sidebar is a column beside it, and a toolbar under it is a toolbar nobody can
  // press. The transparent header band is fair game: the bubble draws above the
  // header (z-index in style.css), and using the band is what lets a bubble for
  // the draft's second line stand above it instead of flipping onto the next.
  function bubbleArea() {
    const pane = document.getElementById('pane-work').getBoundingClientRect();
    const left = pane.left + 8;
    return {
      left,
      right: Math.max(left, pane.right - 8),
      top: pane.top + 8,
      bottom: window.innerHeight - 8,
    };
  }

  // The document position the bubble was asked for, so a reflow can put it back
  // over the same words — the draft re-centres when the sidebar opens, so the
  // old screen point would be off. Cleared whenever it is put away.
  let bubbleAnchor = null;

  // A floating bubble stands over the text it acts on, never on it: anchored to
  // the top of the passage's first line (centred on the passage when it fits on
  // one line, at the pointer otherwise), with the passage's height kept so it can
  // flip below the last line instead. Pointer-relative placement put the bubble
  // over the upper half of the very line that was clicked.
  function textAnchor(from, to, fallbackX) {
    const start = getView().coordsAtPos(from, 1);
    const end = getView().coordsAtPos(to, -1);
    if (!start || !end) return null;
    const x = Math.abs(end.top - start.top) < 2 ? (start.left + end.right) / 2 : fallbackX;
    return { pos: from, dx: x - start.left, dy: 0, dh: Math.max(end.bottom, start.bottom) - start.top };
  }

  function placeBubble(x, y, anchor = null) {
    element.hidden = false;
    if (!anchor) {
      // A bare point: the line under it is the text to clear.
      const pos = getView().posAtCoords({ x, y });
      anchor = pos == null ? null : textAnchor(pos, pos, x);
      if (anchor) anchor.dx = x - getView().coordsAtPos(pos, 1).left;
    }
    if (anchor) {
      const at = getView().coordsAtPos(anchor.pos, 1);
      if (at) ({ x, y } = { x: at.left + anchor.dx, y: at.top + anchor.dy });
    }
    bubbleAnchor = anchor;
    const area = bubbleArea();
    // Scrolled under the header or off the pane: hidden with its words, back
    // when they return — never pinned to an edge pointing at nothing.
    const box = element.getBoundingClientRect();
    element.style.visibility = y < area.top - 8 || y > area.bottom ? 'hidden' : '';
    const { left, top, side } = clampBubble(x, y, { w: box.width, h: box.height }, area, y + (anchor?.dh ?? 0));
    element.dataset.side = side;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  // Back over its words after a scroll or reflow, at the same offset from them.
  // Layout is read in CM's measure phase: reading it mid-update throws.
  function reanchorBubble() {
    const anchor = bubbleAnchor;
    if (!anchor) return;
    getView().requestMeasure({
      read: view => view.coordsAtPos(anchor.pos),
      write: coords => {
        if (element.hidden) return;
        if (!coords) { element.style.visibility = 'hidden'; return; }
        placeBubble(coords.left + anchor.dx, coords.top + anchor.dy, anchor);
      },
    });
  }
  // CM reports no geometry change when the text column only shifts sideways
  // (sidebar, window width), so the pane itself is watched too.
  new ResizeObserver(reanchorBubble).observe(document.getElementById('pane-work'));

  function bubbleButton(label, run) {
    const button = chatEl('button', 'mark-bubble-seg', label);
    button.type = 'button';
    button.addEventListener('click', () => { hideMarkBubble(); run(); getView().focus(); });
    return button;
  }

  function showSelectionBubble(x, y) {
    const sel = getView().state.selection.main;
    if (sel.empty) return;
    // A mark click owns the bubble when the click lands on one; a bare
    // selection opens its own local instruction field.
    bubbleMode = 'selection';
    const actions = chatEl('div', 'mark-bubble-actions');
    actions.append(bubbleButton('Change', () => {
      const live = getView().state.selection.main;
      if (live.empty) return;
      openPassage(getView(), live);
    }));
    element.replaceChildren(actions);
    placeBubble(x, y, textAnchor(sel.from, sel.to, x));
  }

  // A dictionary miss offers direct replacements — no model call, no card, the
  // fix is already known. Suggestions are computed on click, not while typing:
  // nspell's suggest() does an edit-distance search, correct() alone does not.
  //
  // Four words, not five: the bubble is a single unwrapped row capped at 340px,
  // and its segments never shrink below their text. A fifth replacement pushes
  // the last segment past the rounded end of the pill, where it reads as part of
  // the page instead of part of the toolbar. Four is already more than anyone
  // weighs before choosing.
  const SPELL_SUGGESTIONS = 4;
  function showSpellBubble(marker, x, y) {
    bubbleMode = 'spell';
    const actions = chatEl('div', 'mark-bubble-actions');
    const replace = suggestion => {
      if (getView().state.sliceDoc(marker.from, marker.to) !== marker.quote) return;
      getView().dispatch({ changes: { from: marker.from, to: marker.to, insert: suggestion }, userEvent: 'input.spellfix' });
    };
    for (const fix of marker.fixes.slice(0, SPELL_SUGGESTIONS)) {
      actions.append(bubbleButton(fix.label, () => replace(fix.insert)));
    }
    actions.append(bubbleButton('Ignore', () => {
      ignoreMarker(marker);
      recheckSpelling();
    }));
    element.replaceChildren(actions);
    placeBubble(x, y, textAnchor(marker.from, marker.to, x));
  }

  return {
    hideMarkBubble, deferBubble, reanchorBubble, showSelectionBubble, showSpellBubble,
    mode: () => bubbleMode,
  };
}
