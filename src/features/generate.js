import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { slashCommand, reviewAction } from '../../extension/writing-rules.js';
import { createGenerationLoader } from '../../extension/editor-ui.js';
import { clearGhostFx } from '../editor/ghost.js';
import { modelError } from '../notices.js';

// ─── Generate in the draft ───
// A "/request" line streams a preview in place of the request. The preview
// stays outside the saved draft until it is accepted (Tab, a click or typing
// into it); Escape rejects it and R regenerates. The editor state below needs
// nothing from main(); the request and review flow gets main()'s state and
// actions through createGenerate's arguments, read at call time.
export const setGenerationFx = StateEffect.define();
export const generationField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (value && tr.docChanged) {
      let touched = false;
      tr.changes.iterChangedRanges((from, to) => {
        if (from === to ? from >= value.from && from <= value.to : from < value.to && to > value.from) touched = true;
      });
      value = touched ? null : { ...value, from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) };
      if (value && tr.newDoc.sliceString(value.from, value.to) !== value.quote) value = null;
      if (value) value.inline = value.source === 'passage' || value.from > tr.newDoc.lineAt(value.from).from;
    }
    for (const effect of tr.effects) if (effect.is(setGenerationFx)) value = effect.value;
    return value;
  },
});

export function slashRequest(state) {
  const line = state.doc.lineAt(state.selection.main.head);
  return slashCommand(line.text, line.from);
}

const hiddenSlash = Decoration.replace({});

// The slash only opens the request; it stays in the text (Backspace removes
// it and ends the request) but is not drawn. The background is the cue.
function requestDecorations(state) {
  if (state.field(generationField, false)) return Decoration.none;
  const request = slashRequest(state);
  if (!request) return Decoration.none;
  const decorations = [hiddenSlash.range(request.from, request.from + 1)];
  if (request.to > request.from + 1) decorations.push(Decoration.mark({ class: 'cm-generation-request' }).range(request.from + 1, request.to));
  else if (!request.inline) decorations.push(Decoration.line({ class: 'cm-generation-request' }).range(state.doc.lineAt(request.from).from));
  return Decoration.set(decorations, true);
}
export const requestField = StateField.define({
  create: requestDecorations,
  update: (value, tr) => tr.docChanged || tr.selection || tr.effects.some(effect => effect.is(setGenerationFx)) ? requestDecorations(tr.state) : value,
});


export function createGenerate({
  jobs, documentKey, loading, paused, passageFx, cancelSuggestion, closePassage, combinedContext,
  currentAgent, ensureAgent, startJob, finishJob, notify, notifyProblem, requestPassage, saveSnapshot,
  sseChunks, fetch = (...args) => globalThis.fetch(...args),
}) {
  let generationJob = null;
  class GenerationWidget extends WidgetType {
    constructor(value) { super(); this.value = value; }
    eq(other) { return this.value.job === other.value.job && this.value.text === other.value.text && this.value.phase === other.value.phase && this.value.inline === other.value.inline && this.value.previousText === other.value.previousText; }
    toDOM(view) {
      const wrap = document.createElement(this.value.inline ? 'span' : 'div');
      wrap.className = 'cm-generation';
      wrap.addEventListener('mousedown', event => {
        if (this.value.phase !== 'review') return;
        event.preventDefault(); event.stopPropagation();
        const point = document.caretPositionFromPoint?.(event.clientX, event.clientY);
        const caret = point ? { startContainer: point.offsetNode, startOffset: point.offset }
          : document.caretRangeFromPoint?.(event.clientX, event.clientY);
        const text = wrap.querySelector('.cm-suggest');
        let offset = this.value.text.length;
        if (caret && text?.contains(caret.startContainer)) {
          const range = document.createRange(); range.selectNodeContents(text);
          range.setEnd(caret.startContainer, caret.startOffset); offset = Math.min(offset, range.toString().length);
        }
        editGeneration(view, offset); view.focus();
      });
      wrap.setAttribute('aria-busy', String(this.value.phase === 'streaming'));
      if (this.value.phase === 'streaming' && (!this.value.text || this.value.previousText != null)) {
        wrap.append(createGenerationLoader(document));
      }
      if (this.value.text) {
        const text = document.createElement(this.value.inline ? 'span' : 'div');
        text.className = 'cm-suggest';
        // Keep the final empty line measurable while a stream ends with a newline.
        text.textContent = this.value.text + (this.value.text.endsWith('\n') ? '\u200b' : '');
        wrap.append(text);
      }
      return wrap;
    }
    coordsAt(dom) {
      const text = dom.querySelector('.cm-suggest')?.firstChild;
      if (!text || this.value.previousText != null) {
        const rect = dom.getBoundingClientRect();
        return { left: rect.left, right: rect.left, top: rect.top, bottom: rect.top };
      }
      // A replacement's box spans the whole preview; the caret belongs to its final text line.
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      return range.getBoundingClientRect();
    }
    get lineBreaks() { return this.value.inline ? (this.value.text.match(/\n/g) ?? []).length : 0; }
    ignoreEvent() { return false; }
  }
  function generationKey(view, action) {
    const target = view.state.field(generationField);
    const selection = view.state.selection.main;
    if (!target || !selection.empty || view.composing || selection.head < target.from || selection.head > target.to) return false;
    if (action === 'Regenerate' && target.phase === 'streaming' && target.previousText != null) return true;
    if (target.phase !== 'review') return false;
    if (action === 'Next' || action === 'Previous') {
      if (!target.variants || target.variants.length < 2) return false;
      const index = (target.index + (action === 'Next' ? 1 : target.variants.length - 1)) % target.variants.length;
      view.dispatch({ effects: [setGenerationFx.of({ ...target, index, text: target.variants[index] }),
        EditorView.announce.of(`Option ${index + 1} of ${target.variants.length}: ${target.variants[index]}`)] });
      return true;
    }
    void reviewGeneration(view, action, target.job);
    return true;
  }

  function editGeneration(view, offset) {
    const target = view.state.field(generationField);
    if (!target || target.phase !== 'review') return false;
    const selection = view.state.selection.main;
    if (offset === undefined && (selection.from < target.from || selection.to > target.to)) return false;
    reviewGeneration(view, 'Accept', target.job);
    if (view.state.field(generationField)) return false;
    view.dispatch({ selection: { anchor: target.from + Math.min(offset ?? target.text.length, target.text.length) } });
    return true;
  }

  const generationInput = [EditorView.domEventHandlers({
    keydown(event, view) {
      const target = view.state.field(generationField), selection = view.state.selection.main;
      if (!target || selection.from < target.from || selection.to > target.to) return false;
      const action = reviewAction(event, target.variants?.length);
      if (action === 'Edit') { editGeneration(view); return false; }
      return action ? generationKey(view, action) : false;
    },
    compositionstart(_event, view) { editGeneration(view); return false; },
  }), EditorView.inputHandler.of((view, from, to, text) => {
    const target = view.state.field(generationField);
    if (!target || from < target.from || to > target.to || !editGeneration(view)) return false;
    const at = view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' });
    return true;
  })];

  function handleWrite(view) {
    const selection = view.state.selection.main;
    if (!selection.empty || view.state.readOnly || view.composing) return false;
    const request = slashRequest(view.state);
    if (!request || selection.head !== request.to) return false;
    if (!request.instruction) { notify('Write a request after /, then press Enter.'); return true; }
    if (paused()) { notify('Wait until the draft can be saved.'); return true; }
    if (view.state.field(generationField)?.phase === 'review') { notify('Review the generated suggestion first: Tab accepts, Escape dismisses, R regenerates.'); return true; }
    if ([...jobs].some(job => !job.background)) { notify('Wait for the current request or stop it first.'); return true; }
    void generateFromLine(view, request, request.instruction);
    return true;
  }

  function reviewGeneration(view, action, job) {
    const target = view.state.field(generationField);
    if (!target || target.job !== job || target.phase !== 'review' || target.key !== documentKey()) return;
    if (action === 'Reject') {
      if (target.source === 'passage') { closePassage(view); return; }
      view.dispatch({ effects: [setGenerationFx.of(null), EditorView.announce.of('Suggestion rejected. Your request is unchanged.')] });
      return;
    }
    if (paused() || view.state.readOnly) { notify('Wait until the draft can be saved.'); return; }
    if (view.state.doc.sliceString(target.from, target.to) !== target.quote) return;
    if (action === 'Regenerate') {
      if ([...jobs].some(job => !job.background)) { notify('Wait for the current request or stop it first.'); return; }
      if (target.source === 'passage') return requestPassage(view, target.text);
      return generateFromLine(view, { from: target.from, to: target.to, text: target.quote }, target.instruction);
    }
    if (action !== 'Accept') return;
    saveSnapshot('Before generated text');
    view.dispatch({ changes: { from: target.from, to: target.to, insert: target.text },
      effects: [setGenerationFx.of(null), ...(target.source === 'passage' ? [passageFx().of(null)] : []), EditorView.announce.of('Text accepted. Undo restores the original passage.')],
      annotations: isolateHistory.of('full'), userEvent: 'input.generate' });
  }

  async function generateFromLine(view, line, instruction) {
    const document = view.state.doc.toString(), key = documentKey();
    const inline = line.from > view.state.doc.lineAt(line.from).from;
    const previous = view.state.field(generationField);
    const previousText = previous?.phase === 'review' ? previous.text : null;
    const job = startJob();
    generationJob = job;
    cancelSuggestion();
    view.dispatch({ effects: [clearGhostFx.of(null), setGenerationFx.of({ from: line.from, to: line.to, quote: line.text, text: previousText ?? '', previousText, instruction, key, inline, phase: 'streaming', job }),
      EditorView.announce.of('Generating text. Escape stops generation.')] });
    // The preview stays outside the saved draft until the author accepts it.
    const current = () => !job.signal.aborted && documentKey() === key && !paused()
      && !view.state.readOnly && view.state.field(generationField)?.job === job;
    const clear = () => {
      const target = view.state.field(generationField);
      if (target?.job !== job || target.phase !== 'streaming') return;
      const restored = previousText !== null && documentKey() === key && !loading()
        ? { ...target, text: previousText, previousText: null, phase: 'review' } : null;
      view.dispatch({ effects: [setGenerationFx.of(restored), EditorView.announce.of(restored
        ? 'Previous suggestion restored. Tab accepts, Escape dismisses, R regenerates.'
        : 'Generation stopped. Your request is unchanged.')] });
    };
    job.signal.addEventListener('abort', clear, { once: true });
    try {
      if (!await ensureAgent() || !current()) return;
      const res = await fetch('/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: job.signal,
        body: JSON.stringify({ document, from: line.from, cursor: line.to, instruction, previous: previousText ?? undefined, agent: currentAgent(), context: combinedContext() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      let answer = '';
      for await (const chunk of sseChunks(res)) {
        if (!current()) { job.abort(); return; }
        if (chunk.error) throw new Error(chunk.error);
        answer = typeof chunk.replace === 'string' ? chunk.replace : answer + (chunk.text ?? '');
        view.dispatch({ effects: setGenerationFx.of({ ...view.state.field(generationField), text: answer.trim(), previousText: null }) });
      }
      if (!current()) return;
      if (!answer.trim()) throw new Error('The model returned no text.');
      view.dispatch({ effects: [setGenerationFx.of({ ...view.state.field(generationField), text: answer.trim(), previousText: null, phase: 'review' }),
        EditorView.announce.of('Suggestion ready. Click or type to edit. Tab accepts, Escape dismisses, R regenerates.')] });
    } catch (error) {
      if (!job.signal.aborted) {
        const problem = modelError(error);
        notifyProblem({ ...problem, say: `${/^The model repeated/.test(error.message) ? error.message : problem.say} ${previousText === null ? 'Your request is unchanged; press Enter to retry.' : 'The previous suggestion is kept.'}` }, null, 'Try again', 'write-error');
      }
    } finally {
      job.signal.removeEventListener('abort', clear);
      clear();
      if (generationJob === job) generationJob = null;
      finishJob(job);
    }
  }

  return {
    GenerationWidget, generationInput, handleWrite, reviewGeneration, generateFromLine, editGeneration, generationKey,
    job: () => generationJob,
  };
}
