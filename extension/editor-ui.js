// Shared DOM controls; editor adapters supply state, positioning and document edits.
export const EDITOR_UI_CSS = `
.passage-panel{margin:0}
.passage-completion{display:block;width:fit-content;max-width:min(360px,calc(100vw - 32px));padding:3px 10px;margin-top:3px;border-radius:5px;background:var(--primary-bg,#263126);color:var(--primary-fg,#fff);font:12px/1.5 var(--ui-font,system-ui);overflow-wrap:anywhere;pointer-events:none}
.passage-completion[hidden]{display:none}
.passage-input{display:block;field-sizing:content;min-width:160px;max-width:min(360px,calc(100vw - 32px));max-height:min(420px,65vh);overflow-y:auto;padding:7px 10px;border:0;border-radius:7px;resize:none;background:var(--primary-bg,#263126);color:var(--primary-fg,#fff);font:13px/1.5 var(--ui-font,system-ui);box-sizing:border-box}
.passage-input:focus{outline:none}
.passage-input::placeholder{color:inherit;opacity:.6}
@supports not (field-sizing:content){.passage-input{width:240px}}
@media (forced-colors: active) {
  .generation-skeleton { background: GrayText; }
}

/* Loading placeholders share one sheen in cards and the draft. */
.cm-passage-busy, .generation-skeleton {
  border-radius: var(--r-xs, 2px);
  background: linear-gradient(90deg, var(--surface-3, rgba(128,128,128,.18)) 25%, var(--surface-2, rgba(128,128,128,.08)) 37%, var(--surface-3, rgba(128,128,128,.18)) 63%);
  background-size: 400% 100%;
  animation: skeleton-sheen 1.4s ease-in-out infinite;
}

@keyframes skeleton-sheen {
  from { background-position: 100% 50%; }
  to { background-position: 0 50%; }
}

@media (prefers-reduced-motion: reduce) {
  .cm-passage-busy, .generation-skeleton { animation: none; }
}

.generation-skeleton{color:transparent;box-decoration-break:clone;-webkit-box-decoration-break:clone}
`;

const passageHints = ['Too much?', 'Say it plainly.', 'Does this land?', 'Find a better word.', 'What’s missing?', 'Tighten this.'];
let nextPassageHint = 0;

export function rememberPassageRequest(history, value) {
  return [value, ...history.filter(entry => entry !== value)].slice(0, 50);
}

export function createPassageInput({ history = () => [], remember = () => {}, selected = '', onSubmit, onChange = () => {}, onClose }) {
  const dom = document.createElement('form'); dom.className = 'passage-panel';
  dom.setAttribute('aria-label', 'Selected passage');
  const input = document.createElement('textarea'); input.className = 'passage-input';
  input.rows = 1; input.maxLength = 4000;
  const text = selected.trim();
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const hints = !words.length ? passageHints
    : words.length === 1 ? ['Better word?', 'What fits?', 'Try a synonym.']
    : text.includes('\n') || words.length > 35 ? ['Find the point.', 'Lose a line.', 'What’s missing?']
    : text.endsWith('?') ? ['What’s unclear?', 'Ask it plainly.', 'More direct?']
    : words.length > 18 ? ['Too much?', 'Split this?', 'Tighten this.']
    : ['Does this land?', 'Say it plainly.', 'What feels off?'];
  input.placeholder = hints[nextPassageHint++ % hints.length];
  input.setAttribute('aria-label', 'Passage request');
  input.setAttribute('aria-description', 'Tab fills the suggestion or completes a previous request. Enter sends, Shift+Enter adds a line, Escape closes.');
  const completion = document.createElement('span');
  completion.className = 'passage-completion';
  completion.hidden = true;
  completion.setAttribute('role', 'status');
  function suffix() {
    const value = input.value;
    if (input.readOnly || !value.trim() || input.selectionStart !== value.length || input.selectionEnd !== value.length) return '';
    const prefix = value.toLowerCase();
    return history().find(entry => entry.length > value.length
      && entry.slice(0, value.length).toLowerCase() === prefix)?.slice(value.length) ?? '';
  }
  const refreshCompletion = () => {
    const ending = document.activeElement === input || input.matches(':focus') ? suffix() : '';
    const label = ending ? `${input.value}${ending} · Tab` : '';
    if (completion.textContent !== label) completion.textContent = label;
    completion.hidden = !ending;
  };
  const fit = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    refreshCompletion();
  };
  const submit = () => {
    const value = input.value.trim();
    if (input.readOnly || !value) return;
    remember(value);
    onSubmit(value);
  };
  for (const event of ['focus', 'blur', 'select', 'keyup', 'click']) input.addEventListener(event, refreshCompletion);
  input.addEventListener('input', () => { fit(); onChange(input.value); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !input.readOnly) {
      const ending = input.value ? suffix() : input.placeholder;
      if (ending) {
        event.preventDefault();
        input.value += ending;
        input.setSelectionRange(input.value.length, input.value.length);
        fit();
        onChange(input.value);
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  });
  dom.addEventListener('submit', event => { event.preventDefault(); submit(); });
  dom.append(input, completion);
  return { dom, input, fit };
}
