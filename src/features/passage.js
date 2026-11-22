import { EditorView, showTooltip } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { distinctVariants, rewriteInstruction } from '../../extension/writing-rules.js';
import { createPassageInput, rememberPassageRequest } from '../../extension/editor-ui.js';
import { mapChatEdit } from '../../chat-edits.js';
import { ghostClear } from '../editor/ghost.js';
import { modelError } from '../notices.js';
import { generationField, setGenerationFx } from './generate.js';

// ─── Local passage actions ───
// Cmd+K or a selection bubble opens a small field under a passage: a question
// gets an answer in the field, a rewrite request a replacement previewed in
// place (the generation preview, source 'passage'). main()'s state and
// actions come in through createPassage's arguments, read at call time.
export const setPassageFx = StateEffect.define();

export function createPassage({
  jobs, docState, storage, cancelSuggestion, combinedContext, currentAgent, ensureAgent,
  startJob, finishJob, notify, notifyProblem, fetch = (...args) => globalThis.fetch(...args),
}) {
  let passageJob = null;
  const historyKey = 'wa-passage-requests';
  const history = () => {
    try {
      const saved = JSON.parse(storage?.getItem(historyKey) ?? '[]');
      return Array.isArray(saved) ? saved.filter(entry => typeof entry === 'string' && entry.length <= 4000) : [];
    } catch { return []; }
  };
  // The draft cannot be saved: it is loading, or saving is paused.
  const paused = () => docState.loadingDocument || docState.savePaused;
  const passageField = StateField.define({
    create: () => null,
    update(value, tr) {
      if (tr.state.readOnly) return null;
      if (value && tr.docChanged) {
        value = { ...value, state: 'pending' };
        mapChatEdit(value, tr.changes);
        if (value.state === 'stale' || tr.newDoc.sliceString(value.from, value.to) !== value.quote) value = null;
      }
      for (const effect of tr.effects) if (effect.is(setPassageFx)) value = effect.value;
      return value;
    },
    provide: field => [
      showTooltip.computeN([field, generationField], state => {
        const value = state.field(field);
        return value && !value.busy && state.field(generationField)?.source !== 'passage' ? [{ pos: value.from, end: value.to, above: false, create: passageTooltip }] : [];
      }),
    ],
  });

  function openPassage(view, range) {
    if (!range || range.to <= range.from || docState.loadingDocument || view.state.readOnly) return false;
    if (view.state.field(generationField)?.source !== 'passage' && view.state.field(generationField)) {
      notify('Accept or dismiss the current suggestion first.'); return false;
    }
    closePassage(view);
    cancelSuggestion(); ghostClear(view);
    view.dispatch({ effects: setPassageFx.of({ from: range.from, to: range.to,
      quote: view.state.doc.sliceString(range.from, range.to), key: docState.documentKey,
      instruction: '', answer: '', busy: false }), selection: { anchor: range.to } });
    return true;
  }

  function closePassage(view) {
    passageJob?.abort();
    const effects = [setPassageFx.of(null)];
    if (view.state.field(generationField)?.source === 'passage') effects.push(setGenerationFx.of(null));
    view.dispatch({ effects });
  }

  function passageTooltip(view) {
    const { quote } = view.state.field(passageField);
    const hintRequest = new AbortController();
    const { dom, input, fit } = createPassageInput({
      selected: quote, history,
      remember: value => {
        try { storage?.setItem(historyKey, JSON.stringify(rememberPassageRequest(history(), value))); } catch {}
      },
      onSubmit: () => { void requestPassage(view); },
      onChange: instruction => {
        hintRequest.abort();
        const value = view.state.field(passageField);
        if (value && !value.busy) view.dispatch({ effects: setPassageFx.of({ ...value, instruction, answer: '' }) });
      },
      onClose: () => {
        if (passageJob) passageJob.abort(); else closePassage(view);
        view.focus();
      },
    });
    const render = () => {
      const value = view.state.field(passageField);
      if (!value) return;
      const text = !value.busy && value.answer || value.instruction;
      if (input.value !== text) { input.value = text; fit(); }
      input.readOnly = value.busy;
      input.setAttribute('aria-busy', String(value.busy));
    };
    // A press anywhere else puts the field away. Not blur: a replacement
    // preview hands focus to the editor on purpose, and its own buttons
    // (inside .cm-generation) must still work.
    const outside = event => {
      if (!dom.contains(event.target) && !event.target.closest?.('.cm-generation')) closePassage(view);
    };
    render();
    return {
      dom, update: render,
      mount() {
        document.addEventListener('pointerdown', outside, true);
        queueMicrotask(() => { if (dom.isConnected) { fit(); input.focus(); } });
        const agent = currentAgent();
        if (!agent || !quote.trim() || quote.length > 10000) return;
        fetch('/passage-hint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: hintRequest.signal,
          body: JSON.stringify({ selected: quote, agent }),
        }).then(response => response.ok ? response.json() : null).then(result => {
          if (result?.hint && !hintRequest.signal.aborted && dom.isConnected && !input.value) {
            input.placeholder = result.hint;
            fit();
          }
        }).catch(() => {});
      },
      destroy() {
        hintRequest.abort();
        document.removeEventListener('pointerdown', outside, true);
      },
    };
  }

  async function requestPassage(view, previous = null) {
    let target = view.state.field(passageField);
    if (!target || paused() || view.state.readOnly || target.key !== docState.documentKey) return;
    if (!target.instruction.trim()) return;
    if ([...jobs].some(job => !job.background)) { notify('Wait for the current request or stop it first.'); return; }
    const job = startJob(); passageJob = job;
    view.dispatch({ effects: setPassageFx.of({ ...target, busy: true, job, answer: '' }) });
    view.focus();
    const current = () => !job.signal.aborted && !paused() && !view.state.readOnly
      && view.state.field(passageField)?.job === job && docState.documentKey === target.key;
    try {
      if (!await ensureAgent() || !current()) return;
      target = view.state.field(passageField);
      const instruction = rewriteInstruction(target.instruction, previous);
      const response = await fetch('/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: job.signal,
        body: JSON.stringify({ document: view.state.doc.toString(), selected: target.quote, from: target.from,
          instruction, agent: currentAgent(), context: combinedContext() || undefined }),
      });
      let data = null;
      if (typeof response.text === 'function') {
        const raw = await response.text().catch(() => '');
        if (raw) {
          try { data = JSON.parse(raw); }
          catch { data = null; }
        }
      } else if (typeof response.json === 'function') {
        try { data = await response.json(); }
        catch { data = null; }
      }
      if (!response.ok) {
        const message = typeof data?.error === 'string' && data.error.trim()
          ? data.error
          : `HTTP ${response.status}`;
        throw new Error(message);
      }
      if (!data || typeof data !== 'object') throw new Error('The model returned an invalid response.');
      if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      if (!current()) return;
      const live = view.state.field(passageField);
      if (!data.variants?.length) {
        if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('The model returned no answer.');
        view.dispatch({ effects: setPassageFx.of({ ...live, answer: data.answer }) });
        return;
      }
      const variants = distinctVariants(data.variants, target.quote, previous);
      if (view.state.doc.sliceString(live.from, live.to) !== live.quote) { notify('The passage changed while the model was working.'); return; }
      // A suggestion in place of the passage: Tab accepts, R regenerates, Escape dismisses.
      view.dispatch({ effects: [setGenerationFx.of({ from: live.from, to: live.to, quote: live.quote,
        text: variants[0], variants, index: 0, source: 'passage', instruction: target.instruction,
        key: target.key, inline: true, phase: 'review', job }),
        setPassageFx.of({ ...live, answer: data.answer || '' }),
        EditorView.announce.of('Suggestion ready. Click or type to edit. Tab accepts, Escape dismisses, R regenerates.')],
        selection: { anchor: live.to } });
      view.focus();
      notify('Tab accepts · R regenerates · Esc dismisses', { sticky: true, key: 'passage-hint' });
    } catch (error) {
      if (current()) {
        if (previous && view.state.field(generationField)) {
          view.dispatch({ effects: setPassageFx.of({ ...view.state.field(passageField), answer: 'Could not regenerate — the previous suggestion is kept.' }) });
        }
        notifyProblem(modelError(error), () => requestPassage(view, previous), 'Try again', 'passage-error');
      }
    } finally {
      const live = view.state.field(passageField);
      if (live?.job === job) view.dispatch({ effects: setPassageFx.of({ ...live, busy: false }) });
      if (passageJob === job) passageJob = null;
      finishJob(job);
    }
  }

  return { passageField, openPassage, closePassage, requestPassage, job: () => passageJob };
}
