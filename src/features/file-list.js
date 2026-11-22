import { el } from '../dom.js';
import { formatFileSize, timeAgo } from '../format.js';
import { newFileName } from './switcher.js';

// The sidebar's file cards: filter, open, rename in place, move to trash.
// `open`, `rename` and `remove` are the app's file actions, by name.
export function createFileList({ list, filter, files, currentName, open, rename, remove }) {
  function render() {
    const query = filter.value.trim().toLowerCase();
    const shown = files().filter(file => !query || file.name.toLowerCase().includes(query));
    list.replaceChildren();
    if (!files().length) {
      list.append(el('li', 'file-list-empty', 'No Markdown or text files here yet.'));
      return;
    }
    if (!shown.length) {
      list.append(el('li', 'file-list-empty', 'Nothing matches this filter.'));
      return;
    }
    for (const file of shown) {
      const item = document.createElement('li');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'file-card';
      // The card shows name, age and excerpt; the size stays in the tooltip.
      row.title = `${file.name} · ${formatFileSize(file.size)}`;
      if (file.name === currentName()) row.setAttribute('aria-current', 'true');
      const top = el('span', 'file-card-top');
      const name = el('span', 'file-name', '');
      name.textContent = file.name;
      const meta = el('span', 'file-meta', '');
      meta.textContent = timeAgo(file.mtime);
      top.append(name, meta);
      row.append(top);
      if (file.excerpt) {
        const excerpt = el('span', 'file-excerpt', '');
        excerpt.textContent = file.excerpt;
        row.append(excerpt);
      }
      // Opening a file is the end of the visit to the panel, so on a narrow
      // window the overlay gets out of the way of the draft it just replaced.
      row.addEventListener('click', () => open(file.name));
      item.append(row);
      // The home draft is where Stilura opens, so it keeps its name and stays.
      if (!file.home) {
        item.classList.add('has-file-actions');
        item.append(fileActions(file, item));
      }
      list.append(item);
    }
  }
  function fileActions(file, item) {
    const actions = el('span', 'file-actions');
    const toggle = el('button', 'file-more', '⋯');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', `Actions for ${file.name}`);
    toggle.setAttribute('aria-expanded', 'false');
    const panel = el('span', 'file-action-panel');
    panel.setAttribute('popover', 'auto');
    toggle.popoverTargetElement = panel;
    panel.addEventListener('beforetoggle', event => {
      const open = event.newState === 'open';
      item.classList.toggle('file-menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        const bounds = toggle.getBoundingClientRect();
        panel.style.left = `${Math.max(8, bounds.right - 152)}px`;
        panel.style.top = `${Math.min(bounds.bottom + 4, window.innerHeight - 88)}px`;
      }
    });
    const rename = el('button', 'file-action', 'Rename');
    rename.type = 'button';
    rename.autofocus = true;
    rename.addEventListener('click', () => { panel.hidePopover(); startRename(file, item); });
    const trash = el('button', 'file-action', 'Move to Trash');
    trash.type = 'button';
    trash.addEventListener('click', () => { panel.hidePopover(); remove(file.name); });
    panel.append(rename, trash);
    actions.append(toggle, panel);
    return actions;
  }

  // Renaming happens in place: Enter keeps the new name, Escape or leaving
  // the field keeps the old one.
  function startRename(file, item) {
    const input = el('input', 'file-rename');
    Object.assign(input, { type: 'text', value: file.name, spellcheck: false });
    input.setAttribute('aria-label', `New name for ${file.name}`);
    item.classList.add('is-renaming');
    // The field stands in for the card, not inside it: keys typed into a
    // field inside a button would press the button.
    item.querySelector('.file-card').hidden = true;
    item.prepend(input);
    input.focus();
    input.setSelectionRange(0, file.name.replace(/\.(md|markdown|txt)$/i, '').length);
    let done = false;
    const finish = async commit => {
      if (done) return;
      done = true;
      const to = commit ? newFileName(input.value) : null;
      if (!to || to === file.name) { render(); return; }
      await rename(file.name, to);
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(false));
  }
  return render;
}
