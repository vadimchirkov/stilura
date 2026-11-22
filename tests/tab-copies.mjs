import assert from 'node:assert/strict';
import { TAB_COPY_MAX_AGE, limitSnapshots, pruneTabCopies, removeTabCopy, writeTabCopy } from '../src/tab-copies.js';

const memory = () => {
  const map = new Map();
  return Object.defineProperty(Object.assign(map, {
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  }), 'length', { get: () => map.size });
};

// Stale copies from other tabs are pruned; fresh ones, this tab's and other documents' stay.
{
  const storage = memory(), now = 10 * TAB_COPY_MAX_AGE, doc = 'stilura:a:';
  writeTabCopy(storage, doc, 'old', 'old text', now - TAB_COPY_MAX_AGE - 1);
  writeTabCopy(storage, doc, 'fresh', 'fresh text', now - 1000);
  writeTabCopy(storage, doc, 'me', 'my text', now - 2 * TAB_COPY_MAX_AGE);
  writeTabCopy(storage, 'stilura:b:', 'old', 'other document', now - TAB_COPY_MAX_AGE - 1);
  storage.setItem(doc + 'wa-working:legacy', 'no stamp');
  storage.setItem(doc + 'wa-working', 'base');
  pruneTabCopies(storage, doc, 'me', now);
  assert.equal(storage.getItem(doc + 'wa-working:old'), null);
  assert.equal(storage.getItem(doc + 'wa-working-at:old'), null);
  assert.equal(storage.getItem(doc + 'wa-working:fresh'), 'fresh text');
  assert.equal(storage.getItem(doc + 'wa-working:me'), 'my text');
  assert.equal(storage.getItem('stilura:b:wa-working:old'), 'other document');
  assert.equal(storage.getItem(doc + 'wa-working'), 'base');
  assert.equal(storage.getItem(doc + 'wa-working:legacy'), 'no stamp', 'an unstamped copy gets a grace period');
  pruneTabCopies(storage, doc, 'me', now + TAB_COPY_MAX_AGE + 1);
  assert.equal(storage.getItem(doc + 'wa-working:legacy'), null, 'and expires after it');
  removeTabCopy(storage, doc, 'me');
  assert.equal(storage.getItem(doc + 'wa-working:me'), null);
  assert.equal(storage.getItem(doc + 'wa-working-at:me'), null);
}

// Checkpoints are capped by count and by total size; the newest always stays.
{
  const make = (n, size) => Array.from({ length: n }, (_, i) => ({ text: 'x'.repeat(size), at: String(i) }));
  assert.equal(limitSnapshots(make(15, 10)).length, 10);
  assert.equal(limitSnapshots(make(10, 400_000)).length, 2);
  assert.equal(limitSnapshots(make(3, 2_000_000)).length, 1);
  assert.deepEqual(limitSnapshots([]), []);
}
console.log('Tab copy checks passed: stale pruning, grace for unstamped copies, snapshot count and size limits.');
