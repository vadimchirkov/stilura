import { SUGGEST_DELAY, SUGGEST_MIN, paragraphEnd } from '../../extension/writing-rules.js';
import { ghostField, ghostShow, ghostClear } from '../editor/ghost.js';
import { modelError } from '../notices.js';

// ─── Suggestion system ───
// Continuations while the writer types: scheduled at a pause at a paragraph
// end, fetched in the background, shown as ghost text, and dropped the moment
// anything they depended on changes. Everything main() owns comes in as a
// getter or callback, read at call time.
// Suggest only where the writer is actually writing forward: caret collapsed
// at the end of a line with nothing but blank space after it. Editing mid-text
// is what produced the off-topic continuations — the model never saw the tail.
export function atParagraphEnd(state) {
  const sel = state.selection.main;
  if (!sel.empty) return false;
  return paragraphEnd(state.doc.toString(), sel.head);
}

export function createSuggest({
  getView, docState, generating, statusShown, setSuggestStatus, slashRequest, ensureAgent,
  activeSuggestAgent, currentAgent, briefContext, startJob, finishJob, reportSuggestFailure,
  hidden = () => document.hidden,
  fetch = (...args) => globalThis.fetch(...args),
  timers = globalThis,
}) {
  // The draft cannot be saved: it is loading, or saving is paused.
  const paused = () => docState.loadingDocument || docState.savePaused;
  let suggestTimer = null;
  let suggestAbort = null;
  let suggestVersion = 0;
  // A rate-limited provider answers every further keystroke with the same 429
  // and burns the quota it is waiting on. Automatic requests rest for a minute.
  let suggestPausedUntil = 0;

  function cancelSuggestion() {
    suggestVersion++;
    timers.clearTimeout(suggestTimer);
    suggestTimer = null;
    suggestAbort?.abort();
    suggestAbort = null;
    if (statusShown()) setSuggestStatus('');
  }

  function suggestSchedule() {
    cancelSuggestion();
    if (paused() || !getView().hasFocus || hidden()) return;
    if (Date.now() < suggestPausedUntil) return;
    const doc = getView().state.doc.toString();
    if (doc.trim().length < SUGGEST_MIN) return;
    if (!atParagraphEnd(getView().state)) return;

    suggestTimer = timers.setTimeout(suggestFetch, SUGGEST_DELAY);
  }

  // Selection changes cancel both the debounce and the in-flight request, even
  // when the selection's head stays at the same offset. Only typing starts work.
  function suggestionUpdate(update) {
    if (update.docChanged || update.selectionSet || (update.focusChanged && !update.view.hasFocus) || update.state.readOnly) {
      cancelSuggestion();
    }
    if (update.focusChanged && !update.view.hasFocus) {
      queueMicrotask(() => { if (!update.view.hasFocus) ghostClear(update.view); });
    }
    if (update.docChanged && update.transactions.some(tr => tr.isUserEvent('input.type')) && !update.state.field(ghostField)) suggestSchedule();
  }

  async function suggestFetch(manual = false) {
    suggestTimer = null;
    const view  = getView();
    const state = view.state;
    // The focus guard keeps background suggestions from firing while the writer
    // is elsewhere. An explicit ask is not background: the press itself may be
    // what took focus out of the editor (a bubble button, the settings dialog).
    if (generating() || state.readOnly || paused() || (!manual && !view.hasFocus) || hidden() || view.composing) return;
    if (!atParagraphEnd(state)) {
      if (manual) setSuggestStatus('Place the caret at the end of a paragraph to request a continuation.');
      return;
    }

    const doc = state.doc.toString();
    const pos = state.selection.main.head;
    if (slashRequest(state)) return;
    if (!doc.trim() || (!manual && doc.trim().length < SUGGEST_MIN)) {
      if (manual) setSuggestStatus('Write a few words before requesting a continuation.');
      return;
    }

    const version = suggestVersion;
    if (manual && !await ensureAgent()) return;
    const suggestAgent = activeSuggestAgent() ?? currentAgent();
    if (version !== suggestVersion || (!manual && !view.hasFocus) || !suggestAgent) return;
    const agent = suggestAgent;
    const brief = briefContext();

    const job = startJob({ background: !manual });
    suggestAbort = job;
    const isCurrent = () => suggestAbort === job && !job.signal.aborted && version === suggestVersion
      && !paused() && !hidden() && (manual || view.hasFocus) && !view.composing
      && !view.state.readOnly
      && view.state.doc === state.doc && view.state.selection.eq(state.selection)
      && JSON.stringify(activeSuggestAgent() ?? currentAgent()) === JSON.stringify(agent)
      && briefContext() === brief;
    if (manual) setSuggestStatus('Suggesting…');

    try {
      const res = await fetch('/suggest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          document: doc,
          cursor:   pos,
          agent,
          manual,
          brief: brief || undefined,
        }),
        signal: job.signal,
      });
      // A background feature that fails in silence looks like a broken one. Say
      // it once in the status line; the next keystroke schedules another try.
      if (!res.ok) {
        // The provider's own status is in the body; the 500 is only our wrapper.
        let errorBody = '{}';
        try { errorBody = await res.text(); } catch {}
        let errorMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(errorBody);
          // Unwrap Google-style error objects: {"error":{"message":"...","code":429}}
          if (parsed.error?.message) errorMsg = parsed.error.message;
          else if (parsed.error?.error?.message) errorMsg = parsed.error.error.message;
          else if (parsed.message) errorMsg = parsed.message;
          else if (parsed.error) errorMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
        } catch {}
        if (/\b429\b|rate.?limit|quota/i.test(errorMsg)) suggestPausedUntil = Date.now() + 60_000;
        const problem = modelError(new Error(errorMsg));
        if (suggestAbort === job && !job.signal.aborted) { setSuggestStatus(''); reportSuggestFailure(problem, manual); }
        return;
      }

      const data = await res.json();

      // Only show if nothing changed while we were waiting
      if (!isCurrent()) return;
      setSuggestStatus('');
      if (data.suggestion) ghostShow(view, data.suggestion);
      else if (manual) setSuggestStatus('No continuation to suggest.');
    } catch (error) {
      if (error.name === 'AbortError') return;
      let errorMsg = error.message;
      // Unwrap nested JSON error strings from server responses
      try {
        const parsed = JSON.parse(errorMsg);
        if (parsed.error?.message) errorMsg = parsed.error.message;
        else if (parsed.error?.error?.message) errorMsg = parsed.error.error.message;
        else if (parsed.message) errorMsg = parsed.message;
      } catch {}
      const problem = modelError(new Error(errorMsg));
      if (suggestAbort === job && !job.signal.aborted) { setSuggestStatus(''); reportSuggestFailure(problem, manual); }
    } finally {
      finishJob(job);
      if (suggestAbort === job) suggestAbort = null;
    }
  }

  // A continuation is waiting to be asked for or is on its way.
  const pending = () => suggestTimer !== null || suggestAbort !== null;
  return { cancelSuggestion, suggestSchedule, suggestionUpdate, suggestFetch, pending };
}
