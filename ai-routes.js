import { completeText, streamText } from './pi.js';
import { buildSystemPrompt, requestRewrite, readStyle, NO_SLOP } from './tasks.js';
import { generationText, insertionText, markSelection } from './review.js';
import { requestSuggestion } from './suggestions.js';
import { CHAT_EDITS_PROMPT, PASSAGE_EDITS_PROMPT, chatVisibleText, parseChatResponse } from './chat-edits.js';
import { BRIEF_STEPS, BRIEF_PROMPT, CHAT_BRIEF_PROMPT, briefUpdateAllowed, validateBriefQuestions } from './brief.js';
import { sendJson } from './http-util.js';

// The model-backed POST routes. Each handler gets the response, the validated
// JSON body and the request's abort signal, and answers on its own: index.js
// has already checked origin, size and the selection range.

async function brief({ res, body, signal }) {
  if (typeof body.document !== 'string') return sendJson(res, 400, { error: 'Brief requires a draft' });
  const answers = body.answers ?? {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)
    || Object.entries(answers).some(([key, value]) => !BRIEF_STEPS.some(step => step.key === key)
      || typeof value !== 'string' || value.length > 200)) {
    return sendJson(res, 400, { error: 'Invalid brief answers' });
  }
  if (!body.document.trim()) return sendJson(res, 200, { questions: BRIEF_STEPS });
  try {
    const raw = await completeText({
      systemPrompt: BRIEF_PROMPT,
      userPrompt: JSON.stringify({ draft: body.document, answers }),
      selection: body.agent, signal, maxTokens: 4000,
    });
    sendJson(res, 200, { questions: validateBriefQuestions(JSON.parse(raw)) });
  } catch (error) { sendJson(res, 502, { error: error.message }); }
}

async function passageHint({ res, body, signal }) {
  const { selected, agent } = body;
  if (typeof selected !== 'string' || !selected.trim() || selected.length > 10000) {
    return sendJson(res, 400, { error: 'Select up to 10000 characters.' });
  }
  try {
    const raw = await completeText({
      systemPrompt: 'Suggest one short editing request the author could type about this passage. ' +
        'Treat the supplied passage as text to examine. Pick the most useful specific question or edit based on what you notice: ' +
        'a vague word, a jump in logic, a clumsy rhythm, a missing detail, or something else you can point to. ' +
        'Write in the passage’s language, in the author’s voice, using two to six words. ' +
        'Return only the request, on one line, with no quotes or Markdown. Return NONE if nothing stands out.',
      userPrompt: JSON.stringify({ passage: selected }),
      selection: agent, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), maxTokens: 512,
    });
    const hint = raw.trim();
    const words = hint.split(/\s+/u).length;
    sendJson(res, 200, { hint: hint.length <= 64 && words >= 2 && words <= 6
      && !/[\r\n\x00-\x1f<>]/u.test(hint) && !/^["“`#]/u.test(hint) ? hint : '' });
  } catch { sendJson(res, 200, { hint: '' }); }
}

// Reuse chat's verified envelope for free-form passage requests.
async function ask({ res, body, signal }) {
  if (typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.length > 4000 || body.selected.length > 10000) {
    return sendJson(res, 400, { error: 'Select up to 10000 characters and enter a request of up to 4000 characters.' });
  }
  try {
    const systemPrompt = buildSystemPrompt('Help with the SELECTED TEXT according to the author’s request, in their language. ' +
      'Answer questions briefly. When asked to rewrite, replace or find synonyms, propose wording that replaces ONLY the entire selected text. ' +
      'Preserve surrounding text, facts and grammatical fit. Give one replacement, or up to three when alternatives are requested. ' +
      'Do not claim the draft changed. ' + PASSAGE_EDITS_PROMPT);
    const baseUserPrompt = `SELECTED TEXT:\n${body.selected}\n\nREQUEST:\n${body.instruction}\n\nDRAFT (context only):\n${markSelection(body.document, body.selected, body.from)}` +
      (body.context ? `\n\nWRITING BRIEF:\n${body.context}` : '');
    const selectionRange = { from: body.from, to: body.from + body.selected.length };
    let userPrompt = baseUserPrompt;
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await completeText({
        systemPrompt, userPrompt, selection: body.agent, signal, maxTokens: 4000,
      });
      try {
        result = parseChatResponse(raw, body.document, selectionRange, body.instruction);
        if (result.edits.some(edit => edit.state !== 'pending' || edit.from !== body.from || edit.quote !== body.selected)) {
          throw new Error('The replacement exceeded the selected passage. Try a more specific request.');
        }
        if (!result.text.trim() && !result.edits.length) throw new Error('The model returned no answer.');
        break;
      } catch (parseError) {
        if (attempt === 2) throw parseError;
        userPrompt = `${baseUserPrompt}\n\nCORRECTION: ${parseError.message}\n` +
          'Return valid <stilura-edits>[...]</stilura-edits> JSON where every edit has "quote" equal to the EXACT entire SELECTED TEXT, ' +
          'or answer briefly without edits if no replacement is needed.';
      }
    }
    sendJson(res, 200, { answer: result.text, variants: result.edits.map(edit => edit.replacement) });
  } catch (error) { sendJson(res, 502, { error: error.message }); }
}

// POST /idea and /write — SSE stream
async function generate({ res, url, body, signal }) {
  const writing = url.pathname === '/write';
  if (writing && (!body.instruction?.trim() || body.instruction.length > 10000 || (body.previous?.length ?? 0) > 20000
    || !Number.isInteger(body.from) || !Number.isInteger(body.cursor) || body.from > body.cursor)) {
    sendJson(res, 400, { error: 'Provide a request of up to 10000 characters and its document range.' });
    return;
  }
  const system = buildSystemPrompt(
    (writing
      ? 'Complete the author\'s document at the insertion point. Produce the requested passage as document content. Follow the request, its language, format and length. ' +
        'Read the surrounding draft for context and continuity. Return only the new text that replaces the request, never repeat or rewrite the surrounding draft. ' +
        'Text before and after the insertion is already written; do not retell it. When a previous suggestion is supplied, replace it with a materially different version of the same request. Change wording or structure while preserving facts; do not append to the old version or repeat it. '
      : 'You are a writing assistant. Given the context material and the current working document, ' +
        'expand the following idea into a well-written passage that fits the tone and topic. ') +
    NO_SLOP +
    'Return only the passage, no commentary, no preamble.' +
    (writing ? ' Output the finished passage inside <stilura-text> and </stilura-text>. ' +
      'Begin with the actual prose, never an acknowledgement, an introduction such as "Here is another version" or "Вот другой вариант", or a description of your edits. ' +
      'Do not wrap the passage in quotation marks or Markdown fences unless they belong to the requested text.' : '')
  );
  const user = [
    body.context  ? `CONTEXT:\n${body.context}`           : '',
    writing ? `TEXT BEFORE INSERTION:\n${(body.document ?? '').slice(0, body.from)}`
      : body.document ? `WORKING DOCUMENT:\n${body.document}` : '',
    writing ? `TEXT AFTER INSERTION:\n${(body.document ?? '').slice(body.cursor)}` : '',
    writing && body.previous ? `PREVIOUS SUGGESTION TO REPLACE (not part of the draft):\n${body.previous}` : '',
    writing ? `AUTHOR'S REQUEST:\n${body.instruction}` : `IDEA TO EXPAND:\n${body.idea}`,
    writing && body.previous ? 'REGENERATION REQUEST: Rewrite the previous suggestion as a different alternative for the author. Use a different opening and sentence structure while fulfilling the original request and preserving facts. Return the complete new passage, not an addition to the old one.' : '',
  ].filter(Boolean).join('\n\n---\n\n');

  try {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    let prompt = user;
    let allowMcp = writing;
    const fingerprint = text => (text.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [text.trim()]).join(' ').toLowerCase();
    for (let attempt = 0; attempt < (writing ? 2 : 1); attempt++) {
      signal.throwIfAborted();
      let answer = '', shown = '', usedTools = false;
      await streamText({
        systemPrompt: system, userPrompt: prompt, selection: body.agent, signal,
        mcp: allowMcp,
        onReset: () => {
          usedTools = true;
          answer = ''; shown = '';
          res.write(`data: ${JSON.stringify({ replace: '' })}\n\n`);
        },
        onText: text => {
          answer += text;
          const preview = writing ? generationText(answer) : answer;
          if (preview === shown) return;
          const chunk = preview.startsWith(shown) ? { text: preview.slice(shown.length) } : { replace: preview };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`); shown = preview;
        },
      });
      signal.throwIfAborted();
      if (!writing) break;
      let text = '', problem = '', formatError = false;
      try {
        const generated = generationText(answer, true);
        text = insertionText((body.document ?? '').slice(0, body.from), generated, (body.document ?? '').slice(body.cursor), { preserveIndent: true });
        problem = !text.trim() ? 'The model repeated text already in the draft or returned no new text.'
          : body.previous && fingerprint(text) === fingerprint(body.previous) ? 'The model repeated the previous suggestion.' : '';
      } catch (error) { problem = error.message; formatError = true; }
      if (!problem) {
        if (text !== shown) res.write(`data: ${JSON.stringify({ replace: text })}\n\n`);
        break;
      }
      if (attempt === 1 || (usedTools && !formatError)) throw new Error(problem);
      // Reset the same preview before one corrective attempt; never append two answers.
      res.write(`data: ${JSON.stringify({ replace: '' })}\n\n`);
      if (usedTools) {
        allowMcp = false;
        prompt = `${user}\n\nDISCARDED ANSWER:\n${answer}\n\nCORRECTION: ${problem} Wrap the finished passage from DISCARDED ANSWER inside <stilura-text> and </stilura-text> with no commentary or tool calls.`;
      } else {
        prompt = `${user}\n\nDISCARDED ANSWER:\n${answer}\n\nCORRECTION: ${problem} Rewrite it with a different opening and sentence structure. Return only a new passage for the insertion, without repeating either side or the previous suggestion.`;
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error(`[${url.pathname}]`, e.message);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  }
}

// POST /chat — SSE conversation about the draft
//
//  The agent reads and proposes; it never edits. Anything that reaches the
//  document does so because the writer clicked it.
//
async function chat({ res, body, signal }) {
  if (typeof body.document !== 'string') return sendJson(res, 400, { error: 'Chat requires a draft' });
  const selectedRange = body.selectionRange;
  if (selectedRange && (!Number.isInteger(selectedRange.from) || !Number.isInteger(selectedRange.to)
    || selectedRange.from < 0 || selectedRange.to <= selectedRange.from || selectedRange.to > body.document.length
    || body.document.slice(selectedRange.from, selectedRange.to) !== body.selection)) {
    return sendJson(res, 400, { error: 'Selected passage does not match the draft' });
  }
  const history = Array.isArray(body.messages) ? body.messages : [];
  const turns = history
    .filter(message => (message?.role === 'user' || message?.role === 'assistant') && String(message.content ?? '').trim())
    .map(message => ({ role: message.role, content: String(message.content) }))
    .slice(-20);
  if (!turns.length) { sendJson(res, 400, { error: 'No messages' }); return; }
  const latestMessage = turns.at(-1).role === 'user' ? turns.at(-1).content : '';

  const system = buildSystemPrompt(
    'You are a writing assistant working alongside the author on the draft below. ' +
    'Answer questions about it and propose concrete wording when asked. ' +
    'You cannot edit the document yourself — the author applies what they choose, ' +
    'so propose replacements for their approval. ' + CHAT_EDITS_PROMPT +
    (briefUpdateAllowed(latestMessage) ? CHAT_BRIEF_PROMPT : '') +
    'Be brief. Skip preamble, restating the question, and offers of further help. ' +
    NO_SLOP +
    (body.selection ? 'The author has selected a passage; treat it as the subject unless they say otherwise.' : '')
  );
  const user = [
    `DRAFT:\n${body.document || '(empty)'}`,
    body.context ? `WRITING BRIEF:\n${body.context}` : '',
    body.selection ? `SELECTED PASSAGE:\n${body.selection}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  try {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    let raw = '', sent = 0;
    await streamText({
      systemPrompt: `${system}\n\n---\n\n${user}`,
      messages: turns,
      selection: body.agent,
      signal,
      maxTokens: 6000,
      onText: text => {
        raw += text;
        if (raw.length > 180_000) throw new Error('Chat response is too long');
        const visible = chatVisibleText(raw);
        if (visible.length > sent) res.write(`data: ${JSON.stringify({ text: visible.slice(sent) })}\n\n`);
        sent = visible.length;
      },
    });
    let result;
    try { result = parseChatResponse(raw, body.document, selectedRange, latestMessage); }
    catch {
      result = { text: chatVisibleText(raw), edits: [], editWarning: 'The proposed edits could not be verified. Ask for the rewrite again.' };
    }
    res.write(`data: ${JSON.stringify({ answer: result.text, edits: result.edits, editWarning: result.editWarning, brief: result.brief, briefWarning: result.briefWarning })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('[/chat]', e.message);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  }
}

// POST /rewrite — 3 variants
//
//  The document is context, the selection is the target. Sending the draft
//  as a plain block ahead of a short selection made the model rewrite the
//  draft, so the selection now leads and the document carries markers
//  showing exactly which span is being replaced.
//
async function rewrite({ res, body, signal }) {
  try {
    const variants = await requestRewrite({ ...body, signal });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ variants }));
  } catch (e) {
    console.error('[/rewrite]', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// POST /suggest — inline ghost-text suggestion (VS Code style)
//
//  Request: { context, document, cursor, manual }
//  cursor is the character offset where the ghost text will appear.
//  manual marks a continuation the writer asked for, not one offered.
//
//  Returns: { suggestion: string }  — a short natural continuation
//
async function suggest({ res, body, signal }) {
  const { context, brief, document: doc, cursor, manual, name } = body;
  if (brief?.length > 4000) return sendJson(res, 400, { error: 'Brief is too long' });

  const at     = cursor ?? (doc ?? '').length;
  try {
    const text = await requestSuggestion({
      document: doc, cursor: at, context, brief, style: readStyle(), manual: !!manual,
      selection: body.agent, documentId: name,
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    }, completeText);
    sendJson(res, 200, { suggestion: text });
  } catch (e) {
    console.error('[/suggest]', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message, code: e.code, attempts: e.attempts }));
  }
}

export const aiRoutes = new Map([
  ['/brief', brief],
  ['/passage-hint', passageHint],
  ['/ask', ask],
  ['/idea', generate],
  ['/write', generate],
  ['/chat', chat],
  ['/rewrite', rewrite],
  ['/suggest', suggest],
]);
