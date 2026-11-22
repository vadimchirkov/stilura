import assert from 'node:assert/strict';
import { reviewAction, rewriteInstruction, slashCommand } from '../extension/writing-rules.js';

for (const [event, count, expected] of [
  [{ key: 'Tab' }, 1, 'Accept'],
  [{ key: 'Tab', shiftKey: true }, 1, null],
  [{ key: 'Tab', ctrlKey: true }, 1, null],
  [{ key: 'Escape' }, 1, 'Reject'],
  [{ key: 'r' }, 1, 'Regenerate'],
  [{ key: 'R', shiftKey: true }, 1, 'Edit'],
  [{ key: 'Enter', altKey: true }, 1, 'Regenerate'],
  [{ key: 'Enter' }, 1, 'Edit'],
  [{ key: 'ArrowDown' }, 3, 'Next'],
  [{ key: 'ArrowUp' }, 3, 'Previous'],
  [{ key: 'ArrowDown' }, 1, 'Edit'],
  [{ key: 'ArrowLeft', ctrlKey: true }, 3, 'Edit'],
  [{ key: 'ArrowUp', shiftKey: true }, 3, 'Edit'],
  [{ key: 'Backspace' }, 1, 'Edit'],
  [{ key: 'x' }, 1, 'Edit'],
  [{ key: 'v', metaKey: true }, 1, null],
  [{ key: 'r', isComposing: true }, 1, null],
]) assert.equal(reviewAction(event, count), expected, JSON.stringify(event));
assert.equal(rewriteInstruction('Shorten it.'), 'Shorten it.');
assert.match(rewriteInstruction('Shorten it.', 'Old text.'), /^Shorten it\.\nReplace the previous candidate/);
assert(rewriteInstruction('Shorten it.', 'Old text.').endsWith('Old text.'));
console.log('Shared editor rules passed: review keys, native navigation, IME and regeneration instructions.');

// The command is the slash being typed, not an earlier slash on the line.
for (const [line, from, instruction] of [
  ['/write a haiku', 0, 'write a haiku'],
  ['/ write a haiku', 0, 'write a haiku'],
  ['Ratio 1 / 2 is fine. /write a haiku', 21, 'write a haiku'],
  ['Ratio 1 / 2 is fine. /', 21, ''],
  ['Pick one and / or the other /summarize', 28, 'summarize'],
  ['/compare A / B', 0, 'compare A / B'],
  ['Intro /compare A / B', 6, 'compare A / B'],
  ['/explain /usr/bin', 0, 'explain /usr/bin'],
  ['Existing text. /Explain /usr/bin', 15, 'Explain /usr/bin'],
  ['See /etc/hosts and /write a summary', 19, 'write a summary'],
]) {
  const command = slashCommand(line);
  assert.equal(command?.from, from, line);
  assert.equal(command.instruction, instruction, line);
  assert.equal(command.text, line.slice(from), line);
}
for (const prose of [
  'See https://example.com and/or // note',
  'See /etc/hosts',
  'Check /api/draft',
  'Edit /usr/local/bin/node',
  '/etc/hosts',
  'Ratio 1 / 2 is fine.',
  'Pick one and / or the other.',
]) {
  assert.equal(slashCommand(prose), null, prose);
}
