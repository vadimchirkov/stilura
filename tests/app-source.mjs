import assert from 'node:assert/strict';
import fs from 'node:fs';

// Some tests run a section of src/app.js cut out by text markers. A marker
// that moved or was renamed must fail loudly here, not hand the test an empty
// or truncated slice that then checks nothing.
export const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

export function appSection(start, end, { last = false } = {}) {
  const from = last ? appSource.lastIndexOf(start) : appSource.indexOf(start);
  assert(from >= 0, `src/app.js has no section start: ${JSON.stringify(start)}`);
  const to = appSource.indexOf(end, from);
  assert(to > from, `src/app.js has no section end after ${JSON.stringify(start)}: ${JSON.stringify(end)}`);
  return appSource.slice(from, to);
}
