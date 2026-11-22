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

const WORKSPACE_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

// Names are basenames with an approved extension, resolved inside `dir`;
// anything else is null, never a filesystem walk.
export function resolveWorkspaceFile(dir, name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return null;
  if (path.basename(name) !== name) return null;
  if (!WORKSPACE_EXTENSIONS.has(path.extname(name).toLowerCase())) return null;
  const resolved = path.join(dir, name);
  if (path.resolve(dir, name) !== resolved) return null;
  try { if (!fs.lstatSync(resolved).isFile()) return null; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return resolved;
}

// Two-line card preview: the first ~160 chars of actual prose. Markup is
// stripped line by line — headings, links, images, tags, comments and
// frontmatter — so the card never shows `<img …>` or `#` artefacts.
// Cut on a word boundary; a sliced half-word reads as a typo.
function cardExcerpt(text) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, ' ').split('\n');
  let inFrontmatter = false;
  const kept = [];
  let length = 0;
  for (let i = 0; i < lines.length && length < 200; i++) {
    const raw = lines[i].trim();
    if (i === 0 && /^---$/.test(raw)) { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (/^(---|\.\.\.)$/.test(raw)) inFrontmatter = false; continue; }
    const line = raw
      .replace(/<[^>]*>/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(`{1,3})(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^([-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/[*_~`|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || /^[-*_]{3,}$/.test(line)) continue;
    kept.push(line);
    length += line.length + 1;
  }
  const joined = kept.join(' ');
  if (joined.length <= 160) return joined;
  return joined.slice(0, 160).replace(/\s+\S*$/, '').trim();
}

// The sidebar's cards: every Markdown or text file in `dir`, with a preview.
// Throws if the folder itself cannot be read.
export function listWorkspaceFiles(dir, home) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    if (!WORKSPACE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const full = path.join(dir, entry.name);
      const stats = fs.statSync(full);
      // Card excerpt: first meaningful text, not raw markup. Comments,
      // tags, images and markdown markers never reach the two-line preview.
      // Read capped — a 1 MB draft must not be fully read for a preview.
      let excerpt = '';
      try {
        const fd = fs.openSync(full, 'r');
        try {
          const buf = Buffer.alloc(2048);
          const n = fs.readSync(fd, buf, 0, 2048, 0);
          excerpt = cardExcerpt(buf.subarray(0, n).toString('utf8').replace(/\uFFFD+$/g, ''));
        } finally { fs.closeSync(fd); }
      } catch { excerpt = ''; }
      files.push({ name: entry.name, size: stats.size, mtime: stats.mtime.toISOString(), excerpt, ...(full === home ? { home: true } : {}) });
    } catch { /* raced deletion — skip */ }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
