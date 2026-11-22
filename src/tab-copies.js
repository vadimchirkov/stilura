// Each tab mirrors the draft under `<doc>wa-working:<tabId>` so another tab's
// unsaved work can be recovered from History. Nothing else removes those
// copies, so each carries a last-write stamp and old ones are pruned.
export const TAB_COPY_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
export const SNAPSHOT_MAX_CHARS = 1_000_000;

const stampKey = (documentKey, tab) => `${documentKey}wa-working-at:${tab}`;

export function writeTabCopy(storage, documentKey, tab, value, now = Date.now()) {
  storage.setItem(`${documentKey}wa-working:${tab}`, value);
  storage.setItem(stampKey(documentKey, tab), String(now));
}

export function removeTabCopy(storage, documentKey, tab) {
  storage.removeItem(`${documentKey}wa-working:${tab}`);
  storage.removeItem(stampKey(documentKey, tab));
}

// Removes other tabs' copies not written for TAB_COPY_MAX_AGE. A copy without
// a stamp (written before stamps existed) starts its clock now.
export function pruneTabCopies(storage, documentKey, ownTab, now = Date.now()) {
  const prefix = `${documentKey}wa-working:`;
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix) && key !== prefix + ownTab) keys.push(key);
  }
  for (const key of keys) {
    const tab = key.slice(prefix.length);
    const wrote = Number(storage.getItem(stampKey(documentKey, tab)));
    if (!Number.isFinite(wrote) || wrote <= 0) storage.setItem(stampKey(documentKey, tab), String(now));
    else if (now - wrote > TAB_COPY_MAX_AGE) removeTabCopy(storage, documentKey, tab);
  }
}

// Newest first. At most `count` checkpoints and `maxChars` of text in total;
// the newest is always kept.
export function limitSnapshots(snapshots, count = 10, maxChars = SNAPSHOT_MAX_CHARS) {
  const kept = [];
  let chars = 0;
  for (const snapshot of snapshots.slice(0, count)) {
    chars += String(snapshot?.text ?? '').length;
    if (kept.length && chars > maxChars) break;
    kept.push(snapshot);
  }
  return kept;
}
