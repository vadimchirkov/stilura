import assert from 'node:assert/strict';
import { reviewAction, rewriteInstruction } from '../extension/writing-rules.js';

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
