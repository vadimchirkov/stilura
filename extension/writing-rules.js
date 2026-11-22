// Shared by the CodeMirror editor and native Chrome fields.
export const SUGGEST_DELAY = 200;
export const SUGGEST_MIN = 15;

export function rewriteInstruction(instruction, previous) {
  return previous ? `${instruction}\nReplace the previous candidate with different wording, preserving the request and facts. Previous candidate:\n${previous}` : instruction;
}

export function reviewAction(event, variants = 1) {
  if (event.isComposing) return null;
  const { key, shiftKey, ctrlKey, metaKey, altKey } = event;
  if (key === 'Escape') return 'Reject';
  if (!shiftKey && !ctrlKey && !metaKey) {
    if (key === 'Tab' && !altKey) return 'Accept';
    if ((key === 'r' && !altKey) || (key === 'Enter' && altKey)) return 'Regenerate';
    if (variants > 1 && !altKey && key === 'ArrowDown') return 'Next';
    if (variants > 1 && !altKey && key === 'ArrowUp') return 'Previous';
  }
  if (!altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Enter'].includes(key)) return 'Edit';
  return key.length === 1 && !ctrlKey && !metaKey && !altKey ? 'Edit' : null;
}

export function paragraphEnd(text, cursor) {
  if (cursor < 0 || cursor > text.length || (cursor < text.length && text[cursor] !== '\n')) return false;
  const next = text.indexOf('\n', cursor + 1);
  return cursor === text.length || !text.slice(cursor + 1, next < 0 ? text.length : next).trim();
}

// A command is a slash at the start of the line or after a space, running to
// the end of the line. Prose may hold a lone slash ("1 / 2", "and / or") or a
// filesystem/API path ("/etc/hosts", "/api/draft"), which are not commands;
// the command starts at the first non-path slash with a word right after it
// ("/write"); paths and slashes inside the request ("/explain /usr/bin",
// "/compare A / B") stay part of it. With no such slash, a leading slash
// ("/ request") or a bare trailing "/" is the command.
export function slashCommand(line, offset = 0) {
  const starts = [...line.matchAll(/(?:^|\s)\/(?!\/)/gu)]
    .map(match => match.index + match[0].length - 1)
    .filter(at => !/^\/[^\s/]+\//u.test(line.slice(at)));
  if (!starts.length) return null;
  const start = starts.find(at => /\S/u.test(line[at + 1] ?? ''))
    ?? starts.findLast(at => !line.slice(0, at).trim() || !line.slice(at + 1).trim());
  if (start === undefined) return null;
  return { from: offset + start, to: offset + line.length, text: line.slice(start),
    instruction: line.slice(start + 1).trim(), inline: !!line.slice(0, start).trim() };
}

export function ghostRemainder(text, typed) {
  return typed && text.startsWith(typed) ? text.slice(typed.length) : null;
}

export function distinctVariants(variants, quote, previous) {
  if (!Array.isArray(variants) || variants.some(text => typeof text !== 'string' || !text.trim())) throw Error('The model returned invalid replacements.');
  const normalize = text => text.trim().replace(/\s+/g, ' ').toLowerCase();
  const seen = new Set([normalize(quote), ...(previous ? [normalize(previous)] : [])]);
  const result = variants.map(text => text.trim()).filter(text => {
    const key = normalize(text); if (seen.has(key)) return false; seen.add(key); return true;
  });
  if (!result.length) throw Error('The model returned no different replacements.');
  return result;
}
