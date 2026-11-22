import { insertionText } from './review.js';

// A continuation needs the nearby text, not the whole draft; a long draft
// overflows small models (413). The window start moves in 2,000-character
// steps so consecutive requests share a prefix the provider can cache.
const BEFORE = 8000, STEP = 2000, AFTER = 1500;
export function cursorWindow(document, cursor) {
  let start = Math.max(0, Math.floor((cursor - BEFORE) / STEP) * STEP);
  if (start) start += Math.max(0, document.slice(start, cursor).search(/\s/u));
  const after = document.slice(cursor, cursor + AFTER);
  return {
    before: (start ? '…' : '') + document.slice(start, cursor),
    after: cursor + AFTER < document.length ? after.replace(/\s\S*$/u, '') + '…' : after,
  };
}

// Shared by the HTTP route and the evaluation runner so they test the same task.
//
// Automatic continuations and an explicit press follow the same rules. With
// the stricter rules automatic ones used to have (abstain when the thought is
// complete or several completions are equally possible), ChatGPT models
// stayed silent at most pauses and the feature looked broken. The grounding
// rules do not move: a continuation may still invent no fact, source,
// number, experience or intention.
export function suggestionPrompts({ document = '', cursor = document.length, context, brief, style }) {
  const thought = 'Stay on the current thought; when it is already finished, open the next sentence its own line of thought calls for.';
  const silence = 'Return an empty text only when continuing would need a fact, number, name, source or quotation the draft does not contain. A finished sentence or an open-ended one is not itself a reason for silence.';
  // After a finished sentence many openings are equally possible; take the
  // likeliest, kept to what the draft already carries.
  const atSentenceEnd = /[.!?…]["”’')\]]*\s*$/u.test(document.slice(0, cursor));
  const choice = atSentenceEnd
    ? 'The sentence before the cursor is finished. Do not return NONE. Return only the first two to six words of the next sentence: a connective or a noun the draft already names, which commits to no new claim and leaves the point to the author. Example after "We rolled back within five minutes." → TEXT: The migration.'
    : 'If several completions are possible, take the one the draft most directly supports.';
  const near = cursorWindow(document, cursor);
  return {
    systemPrompt: [
      style ? `Follow this writing style guide:\n\n${style}` : '',
      `You are an inline writing assistant. Fill the cursor position without changing existing text.
Match the draft's language, voice, vocabulary, rhythm and factual uncertainty. ${thought}
The writing brief sets audience, purpose and constraints, not facts to insert. Use it to guide tone and level of explanation.
The local sentence and surrounding text determine what comes next. A brief never licenses invented claims, a new topic or a forced call to action.
Let the continuation's length follow how well the material supports it, up to 15 words: a word or punctuation when that finishes the thought, a full clause or sentence when the draft or context clearly carries it further.
${silence}
Complete grammar, punctuation or an unfinished word, or finish the current sentence with a plausible clause in the author's voice that carries its own image or argument forward. Offer it as a suggestion the author can ignore; it may not add a fact, number, name, source or quotation the draft does not contain. ${choice}
Specific wording must come from the supplied material. Reuse the objects actually named by the author; do not introduce a more specific type of an object or an unstated way it works. When the existing words in a quotation form a complete phrase, close the quotation instead of inventing more quoted words.
Everything under TEXT BEFORE CURSOR and TEXT AFTER CURSOR is already written and stays in place. Return only the missing insertion, never a rewritten sentence or a copy of either side.
Do not invent evidence, figures or sources, restate the draft, add generic conclusions, or repeat or contradict the text after the cursor.
Return one line using exactly one of these formats, without commentary or Markdown fences:
NONE — when there is no well-supported continuation (return only the word NONE).
TEXT: followed by new words or punctuation. The editor handles word spacing.
WORD: followed by ONLY the missing letters of the unfinished word immediately before the cursor, then any necessary punctuation. Do not repeat the letters already typed.
Examples: an unknown figure after "Revenue grew by" → NONE.
Prefix "The window was already op" → WORD: en.
Prefix ending in an already complete quoted phrase → TEXT: ”.
The format label is not part of the draft. Preserve the author's quotation marks; they need no escaping.`,
    ].filter(Boolean).join('\n\n---\n\n'),
    userPrompt: [
      brief ? `WRITING BRIEF (preferences, not factual evidence):\n${brief}` : '',
      context ? `AUTHOR'S MATERIAL:\n${context}` : '',
      `TEXT BEFORE CURSOR:\n${near.before}`,
      `TEXT AFTER CURSOR:\n${near.after}`,
    ].filter(Boolean).join('\n\n---\n\n'),
  };
}

export function parseSuggestion(prefix, raw, after = '') {
  // Labels avoid making a prose model JSON-escape a closing quotation mark.
  // Invalid output must never become prose in the author's document.
  if (typeof raw !== 'string') throw new Error('Expected TEXT:, WORD:, or NONE from the continuation model');
  const value = raw.trim().replace(/^```(?:text|plaintext)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu, '$1').trim();
  if (!value || /^NONE$/iu.test(value)) return '';
  const match = /^(TEXT|WORD):\s*([^\r\n]+)$/iu.exec(value);
  if (!match) throw new Error('Expected TEXT:, WORD:, or NONE from the continuation model');
  let text = match[2].trim();
  if (match[1].toUpperCase() === 'WORD') {
    if (!/[\p{L}\p{N}\p{M}]$/u.test(prefix) || !/^[\p{L}\p{N}\p{M}]/u.test(text)) {
      throw new Error('Word continuation does not meet an unfinished word');
    }
    text = insertionText('', text, after);
    return text.split(/\s+/u).slice(0, 15).join(' ');
  }
  // Strip echoes before the length cap; a copied sentence can exceed 15 words.
  text = insertionText(prefix, text, after);
  const words = text.match(/\S+/gu) ?? [];
  if (words.length > 15) text = words.slice(0, 15).join(' ');
  if (!text) return '';
  // Preserve the draft's whitespace. Closing punctuation and contractions
  // attach directly; words after opening punctuation do too.
  const quoteOpen = (prefix.match(/"/gu) ?? []).length % 2 === 1;
  const direct = !prefix || /[\s([{«“‘]$/u.test(prefix) || /(?:^|\s)'$/u.test(prefix)
    || (prefix.endsWith('"') && quoteOpen) || (text.startsWith('"') && quoteOpen)
    || /^[,.;:!?…\)\]}»”’']/u.test(text);
  const rightSpace = /[\p{L}\p{N}\p{M}]$/u.test(text) && /^[\p{L}\p{N}\p{M}]/u.test(after) ? ' ' : '';
  return (direct ? '' : ' ') + text + rightSpace;
}

export async function requestSuggestion(input, complete) {
  const { document = '', cursor = document.length, selection, signal, documentId } = input;
  const prompts = suggestionPrompts(input);
  let userPrompt = prompts.userPrompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal?.throwIfAborted();
    // Provider errors are outside format recovery: retrying a key or quota cannot fix it.
    const raw = await complete({ ...prompts, userPrompt, selection, signal, continuation: true, documentId });
    signal?.throwIfAborted();
    try { return parseSuggestion(document.slice(0, cursor), raw, document.slice(cursor)); }
    catch (error) {
      console.warn(`[suggest] invalid format ${attempt}/2; ${selection?.provider || 'default'}/${selection?.model || 'default'}; ${typeof raw === 'string' ? raw.length : 0} characters: ${error.message}`);
      if (attempt === 2) throw Object.assign(error, { code: 'SUGGESTION_FORMAT', attempts: attempt });
      userPrompt = `${prompts.userPrompt}\n\nFORMAT CORRECTION: ${error.message}.\n` +
        'Return exactly one line: TEXT: followed by the continuation, WORD: followed by missing word letters, or NONE. ' +
        'Use WORD only for an unfinished word immediately before the cursor; otherwise use TEXT. ' +
        'No explanation, JSON or Markdown fences. If no continuation is supported, return NONE. Preserve all grounding rules above.';
    }
  }
}
