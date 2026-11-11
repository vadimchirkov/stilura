// Shared DOM controls; editor adapters supply state, positioning and document edits.
export const EDITOR_UI_CSS = `
.passage-panel{margin:0;font:13px/1.5 var(--ui-font,monospace)}
.passage-input{display:block;field-sizing:content;min-width:160px;max-width:min(360px,calc(100vw - 32px));max-height:min(420px,65vh);overflow-y:auto;padding:7px 10px;border:0;border-radius:7px;resize:none;background:var(--primary-bg,#263126);color:var(--primary-fg,#fff);font:inherit;box-sizing:border-box}
.passage-input:focus-visible{outline:2px solid var(--accent,#7796c8);outline-offset:2px}
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

export function createPassageInput({ onSubmit, onChange = () => {}, onClose }) {
  const dom = document.createElement('form'); dom.className = 'passage-panel';
  dom.setAttribute('aria-label', 'Selected passage');
  const input = document.createElement('textarea'); input.className = 'passage-input';
  input.rows = 1; input.maxLength = 4000;
  input.placeholder = 'Ask about or rewrite this passage…';
  input.setAttribute('aria-label', 'Passage request');
  input.setAttribute('aria-description', 'Enter sends, Shift+Enter adds a line, Escape closes.');
  const fit = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
  const submit = () => { if (!input.readOnly && input.value.trim()) onSubmit(input.value.trim()); };
  input.addEventListener('input', () => { fit(); onChange(input.value); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  });
  dom.addEventListener('submit', event => { event.preventDefault(); submit(); });
  dom.append(input);
  return { dom, input, fit };
}
