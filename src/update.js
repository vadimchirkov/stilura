import { api } from './api.js';
import { newerVersion } from '../editing.js';

// Off unless the writer turns it on. Every other request Stilura sends is one
// they started, and a background call to npm on every launch would quietly
// make that untrue. Once a day is generous for a package that `npx` already
// updates on its own — the badge is for the globally installed case.
export function createUpdateCheck({ storage, checkbox, badge, status, section }) {
  const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
  let updateCheckOn = storage.getItem('wa-updatecheck') !== 'off';
  checkbox.checked = updateCheckOn;

  function renderUpdate({ current, latest, error, managed }) {
    // The desktop shell checks, verifies a signature, and installs. Offering an
    // npm command next to that would name a second, wrong way to update.
    if (managed) {
      section.hidden = true;
      badge.hidden = true;
      return;
    }
    const stale = newerVersion(latest, current);
    badge.hidden = !stale;
    if (stale) {
      badge.textContent = `${latest} available`;
      badge.title = 'Copy npx stilura to update';
    }
    status.textContent =
      error  ? `Running ${current} — npm could not be reached.` :
      stale  ? `Running ${current}; npm publishes ${latest}.` :
      latest ? `Running ${current} — the published version.` :
               `Running ${current}.`;
  }

  badge.addEventListener('click', async () => {
    if (badge.hidden) return;
    const command = 'npx stilura';
    try {
      await navigator.clipboard.writeText(command);
      badge.textContent = `Copied: ${command}`;
    } catch {
      badge.textContent = `Run: ${command}`;
    }
    badge.title = command;
  });

  async function refreshUpdate({ force = false } = {}) {
    let cached = null;
    try { cached = JSON.parse(storage.getItem('wa-update') || 'null'); } catch {}
    const check = updateCheckOn && (force || !(cached && Date.now() - cached.at < UPDATE_INTERVAL));
    try {
      const info = await api(`/api/version${check ? '?check=1' : ''}`);
      if (info.latest) storage.setItem('wa-update', JSON.stringify({ latest: info.latest, at: Date.now() }));
      // A cached answer still counts while it is fresh, but only while the check
      // is on: switching it off hides the badge instead of leaving a stale one.
      renderUpdate({ ...info, latest: info.latest ?? (updateCheckOn ? cached?.latest : undefined) });
    } catch {
      // The server that just served this page is not worth an error card.
    }
  }

  checkbox.addEventListener('change', () => {
    updateCheckOn = checkbox.checked;
    storage.setItem('wa-updatecheck', updateCheckOn ? 'on' : 'off');
    refreshUpdate({ force: updateCheckOn });
  });

  refreshUpdate();

  return { refreshUpdate };
}
