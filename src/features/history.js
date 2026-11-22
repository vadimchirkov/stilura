import { wordDiff } from '../../editing.js';
import { el } from '../dom.js';
import { safeJson } from '../format.js';

// The Document history dialog: the disk versions the server keeps, the
// browser's own checkpoints, and copies left by other tabs of this draft.
export function createHistory({ dialog, api, draftUrl, docStorage, localStorage, tabId, documentKey, currentText, replaceDraft }) {
  return async function openHistory() {
    const modal = dialog('Document history');
    modal.classList.add('history-dialog');
    const current = currentText();
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'history-search';
    search.placeholder = 'Search versions';
    search.setAttribute('aria-label', 'Search versions');
    search.autocomplete = 'off';
    search.spellcheck = false;
    const list = el('div', 'history-list');
    const toolbar = el('div', 'history-toolbar');
    toolbar.append(search);
    modal.append(toolbar, list);
    search.focus();
    let versions = [];
    function renderHistory() {
      const query = search.value.trim();
      const matchQuery = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu') : null;
      const shown = versions.map((item, index) => ({
        item, newer: index ? versions[index - 1].text : current,
        match: matchQuery?.exec(item.text),
      })).filter(({ item, match }) => !matchQuery || match || matchQuery.test(item.label || 'Saved to disk'));
      list.replaceChildren();
      for (const { item, newer, match } of shown) {
        const row = el('div', 'history-item');
        const words = item.text.match(/\S+/g)?.length ?? 0;
        row.append(el('div', 'history-when',
          `${new Date(item.at).toLocaleString()} · ${item.label || 'Saved to disk'} · ${words} ${words === 1 ? 'word' : 'words'}`));
        if (match) {
          const matchEnd = match.index + match[0].length;
          const start = Math.max(0, match.index - 60);
          const end = Math.min(item.text.length, matchEnd + 90);
          const excerpt = el('div', 'history-match');
          excerpt.append(
            (start ? '…' : '') + item.text.slice(start, match.index),
            el('mark', '', match[0]),
            item.text.slice(matchEnd, end) + (end < item.text.length ? '…' : ''),
          );
          row.append(excerpt);
        }
        if (item.text !== newer) {
          const diff = el('div', 'history-diff');
          diff.setAttribute('aria-label', 'Changes in the next version');
          const ops = wordDiff(item.text, newer);
          const first = ops.findIndex(op => op.type !== 'keep');
          const last = ops.findLastIndex(op => op.type !== 'keep');
          let remaining = 1400;
          for (let index = Math.max(0, first - 1); index <= Math.min(ops.length - 1, last + 1); index++) {
            const { type, text } = ops[index];
            const context = type === 'keep' && text.length > 100
              ? index < first ? '…' + text.slice(-50) : index > last ? text.slice(0, 50) + '…' : text.slice(0, 50) + ' … ' + text.slice(-50)
              : text;
            const excerpt = context.slice(0, remaining);
            if (type === 'keep') diff.append(excerpt);
            else diff.append(el(type === 'del' ? 'del' : 'ins', type === 'del' ? 'drift-del' : 'drift-ins', excerpt));
            remaining -= excerpt.length;
            if (!remaining) { if (excerpt.length < context.length || index < last) diff.append('…'); break; }
          }
          row.append(diff);
        } else {
          row.append(el('div', 'history-current', 'No changes in the next version'));
        }
        if (item.text !== current) {
          const full = document.createElement('details');
          const preview = el('pre', 'passage-preview', '');
          full.append(el('summary', '', 'Full text'), preview);
          full.addEventListener('toggle', () => {
            if (full.open && !preview.textContent) preview.textContent = item.text;
          }, { once: true });
          const restore = el('button', '', 'Restore');
          restore.addEventListener('click', () => { modal.close(); replaceDraft(item.text, 'Version restored'); });
          row.append(full, restore);
        }
        list.append(row);
      }
      if (!versions.length) list.append(el('p', '', 'No previous versions yet. One is kept before every save, import, and AI replacement.'));
      else if (!shown.length) list.append(el('p', '', 'Nothing matches this search.'));
    }
    search.addEventListener('input', renderHistory);
    try {
      const { snapshots } = await api(draftUrl('/history'));
      const local = safeJson(docStorage.getItem('snapshots'), []);
      if (!Array.isArray(local)) throw new Error('Local history is corrupt');
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(documentKey() + 'wa-working:') || key.endsWith(':' + tabId)) continue;
        let text = null;
        try { text = localStorage.getItem(key); } catch {}
        if (typeof text === 'string' && text !== current) local.push({ text, at: new Date().toISOString(), label: 'Copy from another tab' });
      }
      versions = [...local, ...snapshots].sort((a, b) => b.at.localeCompare(a.at));
      renderHistory();
      list.after(el('small', 'history-note',
        'Last 20 disk versions and 10 browser checkpoints. Disk copies sit beside the draft in .stilura-history and are never deleted automatically.'));
    } catch (error) { list.append(el('p', 'history-note', error.message)); }
  };
}
