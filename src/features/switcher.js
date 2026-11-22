import { chatEl } from '../dom.js';

// ─── Quick switcher (Cmd/Ctrl+O) ───
// Open any file in the folder by typing a few letters of its name; a name
// that matches no file creates it. The same idea as Quire's switcher.

// Letters of the query in order inside the name. Consecutive letters and
// letters at a word start score higher, so "dr" ranks "draft" above "order".
// -1 when the query does not fit.
function fuzzyScore(query, text) {
  let at = 0, score = 0, last = -2;
  for (let i = 0; i < text.length && at < query.length; i++) {
    if (text[i] !== query[at]) continue;
    score += last === i - 1 ? 3 : 1;
    if (i === 0 || /[\s\-_.]/.test(text[i - 1])) score += 2;
    last = i; at++;
  }
  return at === query.length ? score : -1;
}

// Files for a query: names that fit, best first; then files whose text
// preview contains it. An empty query lists every file, most recent first.
function rankFiles(files, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...files].sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
  const scored = [];
  for (const file of files) {
    const name = fuzzyScore(q, file.name.toLowerCase());
    if (name >= 0) scored.push([name + 100, file]);
    else if (file.excerpt?.toLowerCase().includes(q)) scored.push([0, file]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map(([, file]) => file);
}

// The file a query would create: its own extension if it has one, else .md.
// Slashes are not folders here, so they become spaces.
export function newFileName(query) {
  const name = query.trim().replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ');
  if (!name) return null;
  return /\.(md|markdown|txt)$/i.test(name) ? name : `${name}.md`;
}

export function createSwitcher({ files, refresh, open, create }) {
  const dialog = chatEl('dialog', 'switcher');
  dialog.setAttribute('aria-label', 'Open a file');
  const input = chatEl('input', 'switcher-input');
  Object.assign(input, { type: 'search', placeholder: 'Open or create a file…', autocomplete: 'off', spellcheck: false });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', 'switcher-list');
  input.setAttribute('aria-expanded', 'true');
  const list = chatEl('div', 'switcher-list');
  list.id = 'switcher-list';
  list.setAttribute('role', 'listbox');
  dialog.append(input, list);
  document.body.append(dialog);
  let rows = [], active = 0;

  function render() {
    const query = input.value;
    const matches = rankFiles(files(), query).slice(0, 50);
    const name = newFileName(query);
    const exact = name && files().some(file => file.name.toLowerCase() === name.toLowerCase());
    rows = matches.map(file => ({ label: file.name, detail: file.excerpt || '', run: () => open(file.name) }));
    if (name && !exact) rows.push({ label: `Create “${name}”`, detail: '', create: true, run: () => create(name) });
    active = Math.min(active, Math.max(rows.length - 1, 0));
    list.replaceChildren(...rows.map((row, index) => {
      const item = chatEl('button', `switcher-item${row.create ? ' is-create' : ''}`);
      item.type = 'button';
      item.id = `switcher-item-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === active));
      item.append(chatEl('span', 'switcher-name', row.label));
      if (row.detail) item.append(chatEl('span', 'switcher-detail', row.detail));
      item.addEventListener('click', () => choose(index));
      return item;
    }));
    if (!rows.length) list.append(chatEl('p', 'switcher-empty', 'No files here yet. Type a name to create one.'));
    if (rows.length) input.setAttribute('aria-activedescendant', `switcher-item-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function choose(index) {
    const row = rows[index];
    if (!row) return;
    dialog.close();
    row.run();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', event => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step && rows.length) {
      event.preventDefault();
      active = (active + step + rows.length) % rows.length;
      render();
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
  });
  // A press outside the box closes it, like the browser's own pickers.
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  return {
    async show() {
      input.value = '';
      active = 0;
      render();
      dialog.showModal();
      input.focus();
      await refresh();
      if (dialog.open) render();
    },
    get open() { return dialog.open; },
  };
}
