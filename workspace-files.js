import fs from 'node:fs';
import path from 'node:path';

// A document is its Markdown file plus the files Stilura keeps beside it:
// shared notes and the history of saved versions. Moving, trashing and
// restoring treat them as one, so a renamed or restored draft keeps its
// notes and its History. The live-session claim is not moved: the caller
// releases the session first, and the next opening makes a new one.
export const companions = file => [`${file}.stilura-notes.json`, `${file}.stilura-history`];

const exists = file => { try { fs.lstatSync(file); return true; } catch { return false; } };
const refuse = (status, message) => Object.assign(new Error(message), { status });

function move(from, to) {
  if (exists(`${from}.stilura-lock`)) throw refuse(409, `${path.basename(from)} is being saved. Try again in a moment.`);
  // Every target must be free before anything moves: half a document must
  // never land on top of another one's notes or history.
  for (const target of [to, ...companions(to)]) {
    if (exists(target)) throw refuse(409, `${path.basename(to)} already exists.`);
  }
  fs.renameSync(from, to);
  companions(from).forEach((item, i) => { if (exists(item)) fs.renameSync(item, companions(to)[i]); });
}

export function renameDocument(from, to) {
  if (!exists(from)) throw refuse(404, 'File no longer exists.');
  move(from, to);
}

// Deleting moves the document into the folder's .trash/, stamped so two
// deletions of the same name never collide. Returns the entry name that
// restoreDocument takes back.
export function trashDocument(file, now = new Date()) {
  if (!exists(file)) throw refuse(404, 'File no longer exists.');
  const trash = path.join(path.dirname(file), '.trash');
  fs.mkdirSync(trash, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const entry = `${stamp} ${path.basename(file)}`;
  move(file, path.join(trash, entry));
  return entry;
}

// Puts a trashed document back under its own name. Refuses when that name
// is taken again, so a restore never overwrites newer work.
export function restoreDocument(folder, entry) {
  const match = /^\d{4}-\d\d-\d\dT[\d-]+Z (.+)$/.exec(entry ?? '');
  if (!match || path.basename(entry) !== entry) throw refuse(400, 'Unknown deleted file.');
  const from = path.join(folder, '.trash', entry);
  if (!exists(from)) throw refuse(404, 'The deleted file is no longer in the trash.');
  move(from, path.join(folder, match[1]));
  return match[1];
}
