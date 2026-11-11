import { WorkerLinter, createBinaryModuleFromUrl } from 'harper.js';
import { isLatinScript } from './review.js';

// Harper (https://github.com/automattic/harper) checks spelling and grammar
// offline. Its WebAssembly binary is ~20 MB, so it is not inlined into app.js:
// the build copies it to public/harper.wasm, the server serves it with a long
// cache, and a worker loads it off the main thread so typing never waits.
let cached = null;
export function loadLinter() {
  return cached ??= (async () => {
    // The worker runs from a blob URL, so the binary address must be absolute.
    const binary = createBinaryModuleFromUrl(new URL('/harper.wasm', location.href).href, 'slim');
    const linter = new WorkerLinter({ binary });
    await linter.setup();
    return linter;
  })().catch(error => {
    // A failed load must not stick forever: the next call retries.
    cached = null;
    throw error;
  });
}

// Ignore hides one problem text for one rule kind for the rest of the session,
// wherever it appears.
const ignored = new Set();
const ignoreKey = marker => `${marker.kind}\u0000${marker.quote}`;
export function ignoreMarker(marker) {
  ignored.add(ignoreKey(marker));
}

// A suggestion becomes a replacement for the marked range, so applying one is
// the same edit whichever kind Harper returned (0 replace, 1 remove, 2 insert
// after). Remove gets a label because its replacement text is empty.
function fix(quote, suggestion) {
  const text = suggestion.get_replacement_text();
  const kind = suggestion.kind();
  if (kind === 1) return { label: 'Remove', insert: '' };
  if (kind === 2) return { label: quote + text, insert: quote + text };
  return { label: text, insert: text };
}

// English only, same scope as the style-tell word lists in review.js. Harper
// parses the draft as Markdown, so code spans, code blocks and URLs are not
// checked. Spans come back in JavaScript string offsets.
export async function lintMarkers(text, linter) {
  if (!linter || !isLatinScript(text)) return [];
  const out = [];
  for (const lint of await linter.lint(text, { language: 'markdown' })) {
    const { start: from, end: to } = lint.span();
    const quote = text.slice(from, to);
    const marker = { from, to, quote, kind: lint.lint_kind(), message: lint.message() };
    if (to <= from || ignored.has(ignoreKey(marker))) continue;
    marker.fixes = lint.suggestions().map(suggestion => fix(quote, suggestion));
    out.push(marker);
  }
  return out;
}
