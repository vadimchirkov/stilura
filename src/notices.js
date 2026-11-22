import { el } from './dom.js';
import { hydrateIcons } from './icons.js';

// A provider's failure arrives as a status code and its own JSON, and pasting
// that into the interface tells the writer nothing they can act on. Keep the
// line about whose problem it is and what to do; the payload goes to the
// console and the tooltip, where it is there for a bug report and nowhere else.
// One short sentence for the cause. What to do about it is the button beside
// it, not a second clause: "rate-limited, try again shortly" says the same
// thing twice and reads like an apology.
const MODEL_ERRORS = {
  400: 'The model rejected the request.',
  401: 'The API key was rejected.',
  402: 'This provider is out of credit.',
  403: 'This key may not use this model.',
  404: 'This model is not available.',
  408: 'The model took too long.',
  413: 'The draft is too long for this model. Pick a model with a longer context, or select a shorter passage.',
  429: 'The model is rate-limited.',
  500: 'The provider hit an error.',
  502: 'The provider hit an error.',
  503: 'The provider is unavailable.',
  529: 'The provider is overloaded.',
};

export function modelError(error) {
  const detail = error?.message ?? String(error);
  console.error('[model]', detail);
  if (/failed to fetch|networkerror|load failed/i.test(detail)) {
    return { say: 'Stilura stopped answering.', act: 'retry', detail };
  }
  const claudeLimit = /you've hit your session limit(?:\s*·\s*resets (.+))?/i.exec(detail);
  if (claudeLimit) {
    return { say: `Claude session limit reached${claudeLimit[1] ? ` · resets ${claudeLimit[1]}` : '.'}`, act: 'retry', detail };
  }
  const rawStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : Number(
      /^(?:HTTP |Server error )?([45]\d\d)\b/.exec(detail)?.[1]
      ?? /\b(?:HTTP|status|code|error)\s*[:=]?\s*([45]\d\d)\b/i.exec(detail)?.[1]
    );
  const status = Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 0;
  if (!status) {
    if (/claude auth login|install claude code|could not start claude-agent-acp/i.test(detail)) {
      return { say: 'Claude Code is not ready. Check its connection in Settings.', act: 'settings', tab: 'models', detail };
    }
    if (/agy acp --login|install antigravity|could not start antigravity/i.test(detail)) {
      return { say: 'Antigravity is not ready. Check its connection in Settings.', act: 'settings', tab: 'models', detail };
    }
    if (/no authenticated pi model/i.test(detail)) {
      return { say: 'No model is connected yet. Connect a provider in Settings.', act: 'settings', tab: 'models', detail };
    }
    if (/is not authenticated/i.test(detail)) {
      return { say: 'This model is not connected. Sign in or pick another model.', act: 'settings', tab: 'models', detail };
    }
    if (/unknown (?:pi|claude code) model/i.test(detail)) {
      return { say: 'This model is not available. Pick another model in Settings.', act: 'settings', tab: 'models', detail };
    }
  }
  // Providers say how long to wait ("try again in 14.16s"); that number is the
  // one useful thing in a rate-limit payload.
  const waitMatch = status === 429 ? /try again in (\d+(?:\.\d+)?)\s*(ms|s|m)\b/i.exec(detail) : null;
  const wait = waitMatch ? Math.max(1, Math.ceil(Number(waitMatch[1]) * { ms: .001, s: 1, m: 60 }[waitMatch[2].toLowerCase()])) : 0;
  const unusable = /^Expected TEXT:|^Continuation must be|^Word continuation/.test(detail);
  return {
    say: wait ? `The model is rate-limited. Try again in ${wait} s.`
      : unusable ? 'The model\'s answer was unusable.'
      : MODEL_ERRORS[status] ?? 'The model could not answer.',
    // Retrying a rejected key, a missing model or an oversized draft only
    // fails again; each is fixed in settings (the draft by a larger model).
    act: [401, 402, 403, 404, 413].includes(status) ? 'settings' : 'retry',
    // Where the fix is: a rejected or unfunded key is under access, a model
    // the key cannot use or that does not exist is picked under models.
    tab: 'models',
    detail,
  };
}

// ─── Notices ───
// One surface for everything the app tells the writer outside the
// conversation: a failed save, a refused model call, a dismissal that can be
// undone. One notice at a time, so nothing is said twice — a new one replaces
// the last. Passing notices fade on their own; a sticky one (a problem) stays
// until its button or × puts it away, and no passing notice may cover it.
// `key` names who raised it, so only they clear it (clearNotice).
// The notice is a view of the conversation island (#edit-feedback lives
// inside #chat): while one is shown the pill steps aside for it, like an
// iPhone alert expanding the island. Tapping the notice opens the chat.
export function createNotices({ editFeedback, noticeLive, chatPanel, chatInput, focusEditor, openSettings }) {
  const NOTICE_MS = 8000;
  let noticeTimer = null;
  let noticeKey = '';
  let noticeSticky = false;
  // A notice never covers a focused field — keystrokes must not fall into the
  // void. While the writer types, the notice parks here (one slot: the next
  // notice replaces a parked one, like shown ones do) and flushes on blur.
  let pendingNotice = null;
  function notify(text, { action = null, label = 'Undo', sticky = false, detail = '', key = '', icon = 'info', tone = '' } = {}) {
    if (tone === 'error') sticky = true;
    if (!text) {
      clearTimeout(noticeTimer);
      editFeedback.hidden = true;
      noticeLive.textContent = '';
      chatPanel.classList.remove('has-notice');
      if (key === '' || (pendingNotice && pendingNotice.key === key)) pendingNotice = null;
      noticeKey = ''; noticeSticky = false;
      return;
    }
    if (noticeSticky && !sticky && !editFeedback.hidden) return;
    // A passing notice waits for the field's blur rather than covering typing.
    // A problem does not: it is usually the answer to what was just sent from
    // that field, and parked it stayed invisible while the writer waited.
    if (document.activeElement === chatInput && !sticky) { pendingNotice = { text, key, opts: { action, label, sticky, detail, key, icon, tone } }; return; }
    pendingNotice = null;
    showNotice(text, { action, label, sticky, detail, key, icon, tone });
  }
  function showNotice(text, { action = null, label = 'Undo', sticky = false, detail = '', key = '', icon = 'info', tone = '' } = {}) {
    clearTimeout(noticeTimer);
    editFeedback.replaceChildren();
    if (icon) {
      const badge = el('span', 'ph notice-icon', '');
      badge.dataset.icon = icon;
      badge.setAttribute('aria-hidden', 'true');
      editFeedback.append(badge);
    }
    const message = el('span', '', text);
    message.title = detail || text;
    editFeedback.append(message);
    if (action) {
      const run = el('button', 'edit-feedback-undo', label);
      run.type = 'button';
      run.addEventListener('click', () => { notify(''); action(); });
      editFeedback.append(run);
    }
    const close = el('button', 'edit-feedback-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Hide notice');
    close.addEventListener('click', () => { notify(''); focusEditor(); });
    editFeedback.append(close);
    hydrateIcons(editFeedback);
    if (tone) editFeedback.dataset.tone = tone; else delete editFeedback.dataset.tone;
    editFeedback.hidden = false;
    noticeLive.textContent = text;
    chatPanel.classList.add('has-notice');
    noticeKey = key;
    noticeSticky = sticky;
    // Only plain news times out. An Undo or an error stays until dismissed: a
    // timer would take the recovery away before a keyboard user reaches it.
    if (!sticky && !action && tone !== 'error') noticeTimer = setTimeout(() => notify(''), NOTICE_MS);
  }
  // A notice under the pointer is being read or about to be pressed: it must
  // not fade out from under the hand. Leaving restarts the full count.
  editFeedback.addEventListener('mouseenter', () => clearTimeout(noticeTimer));
  editFeedback.addEventListener('mouseleave', () => {
    if (noticeSticky || editFeedback.hidden || editFeedback.querySelector('.edit-feedback-undo') || editFeedback.dataset.tone === 'error') return;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notify(''), NOTICE_MS);
  });
  // Summoning the composer dismisses a passing notice: the island shows either
  // the input or the notice, never both. A sticky problem stays until its own
  // action or × — it keeps the input covered until then.
  function dismissPassingNotice() {
    if (!noticeSticky && !editFeedback.hidden) notify('');
  }
  chatInput.addEventListener('blur', event => {
    if (!pendingNotice) return;
    // Focus moving within the island (Send, chip clear) is still the composer
    // at work — the parked notice waits for a real leave.
    if (event.relatedTarget && chatPanel.contains(event.relatedTarget)) return;
    const parked = pendingNotice;
    pendingNotice = null;
    notify(parked.text, parked.opts);
  });
  function clearNotice(key) { if (noticeKey === key) notify(''); }

  // The message is the cause; the button is the answer to it. Every failure the
  // writer can act on takes this shape — a bare retry pill with no sentence
  // beside it is a button for a problem that was never named.
  // A retry that rejects puts the way out back.
  function notifyProblem(problem, retry = null, label = 'Try again', key = '') {
    const act = problem.act === 'settings' ? { action: () => openSettings(problem.tab), label: 'Open settings' }
      : problem.act === 'retry' && retry
        ? { action: () => Promise.resolve().then(retry).catch(() => notifyProblem(problem, retry, label, key)), label }
        : {};
    notify(problem.say, { ...act, sticky: true, detail: problem.detail, key, icon: 'alert', tone: 'error' });
  }

  // For callers that clear only their own notice, and for tests.
  const state = () => ({ key: noticeKey, sticky: noticeSticky, timer: noticeTimer });
  return { notify, notifyProblem, clearNotice, dismissPassingNotice, state };
}
