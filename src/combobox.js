// ── Combobox ──
//
//  Six hundred models do not fit a <select>, and a native datalist cannot
//  stand in: its popup never reaches the top layer above a modal dialog, and a
//  field that already holds an answer filters the writer's typing against it.
//  So: a trigger that names the choice, and a popover with a search box and a
//  list. The popover API still does the top layer, light dismiss and Escape.
const combos = new WeakMap();
// Hundreds of rows are never all needed: the writer types to narrow, and the
// first screenful plus a count is enough to show the filter is working.
const COMBO_LIMIT = 50;

export function combobox(trigger) {
  const popover = document.getElementById(trigger.getAttribute('popovertarget'));
  const search = popover.querySelector('.combo-search');
  const list = popover.querySelector('.combo-list');
  const empty = popover.querySelector('.combo-empty');
  const count = popover.querySelector('.combo-count');
  const state = { options: [], value: '', render, trigger };
  combos.set(trigger, state);
  // Wire the listbox pattern: the search owns the popup and names the active
  // row, so a screen reader follows ArrowUp/Down/Home/End as well as typing.
  const listId = `${popover.id}-list`;
  list.id = listId;
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-controls', listId);
  search.setAttribute('aria-expanded', 'false');

  function setActive(item) {
    for (const child of list.children) child.classList.remove('is-active');
    if (item) {
      item.classList.add('is-active');
      item.scrollIntoView({ block: 'nearest' });
      search.setAttribute('aria-activedescendant', item.id);
    } else {
      search.removeAttribute('aria-activedescendant');
    }
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const matched = state.options.filter(option => !query
      || option.label.toLowerCase().includes(query)
      || option.value.toLowerCase().includes(query));
    const shown = matched.slice(0, COMBO_LIMIT);
    list.replaceChildren(...shown.map((option, index) => {
      const item = document.createElement('button');
      item.className = 'combo-item';
      item.type = 'button';
      item.id = `${listId}-${index}`;
      item.dataset.value = option.value;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === state.value));
      item.append(Object.assign(document.createElement('span'), { textContent: option.label }));
      return item;
    }));
    empty.hidden = matched.length > 0;
    search.removeAttribute('aria-activedescendant');  // rows were just rebuilt
    if (count) count.textContent = !state.options.length ? ''
      : matched.length > shown.length ? `Showing ${shown.length} of ${matched.length}` : '';
  }

  // The popover is positioned, not anchored: a scroll, resize or dialog move
  // after opening leaves it floating where the trigger was. Re-measure while
  // it is open so it follows the field instead.
  function reposition(force) {
    if (!force && !popover.matches(':popover-open')) return;
    const box = trigger.getBoundingClientRect();
    const width = Math.max(box.width, 260);
    popover.style.left = `${Math.min(box.left, window.innerWidth - width - 8)}px`;
    popover.style.top = `${box.bottom + 4}px`;
    popover.style.width = `${width}px`;
  }
  state.reposition = reposition;

  // beforetoggle is synchronous, before the first paint; toggle fires a task
  // later, which is long enough to flash the popover at its default position.
  popover.addEventListener('beforetoggle', event => {
    if (event.newState === 'open') reposition(true);
  });
  popover.addEventListener('toggle', event => {
    search.setAttribute('aria-expanded', String(event.newState === 'open'));
    if (event.newState !== 'open') { search.removeAttribute('aria-activedescendant'); return; }
    search.value = '';   // the search starts empty, never at the current answer
    render();
    // Open where the writer already is: the current choice, not the top of a
    // list of six hundred. Enter with nothing typed then changes nothing.
    const current = list.querySelector('[aria-selected="true"]');
    setActive(current);
    current?.scrollIntoView({ block: 'center' });
    search.focus();
  });
  search.addEventListener('input', render);
  search.addEventListener('keydown', event => {
    const items = [...list.children];
    if (event.key === 'Enter') {
      event.preventDefault();
      (list.querySelector('.is-active') ?? items[0])?.click();
      return;
    }
    const at = items.findIndex(item => item.classList.contains('is-active'));
    let next;
    if (event.key === 'ArrowDown') next = items[Math.min(at + 1, items.length - 1)] ?? items[0];
    else if (event.key === 'ArrowUp') next = items[Math.max(at - 1, 0)] ?? items[0];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items[items.length - 1];
    else return;
    event.preventDefault();
    setActive(next ?? null);
  });
  list.addEventListener('click', event => {
    const item = event.target.closest('[data-value]');
    if (!item) return;
    state.value = item.dataset.value;
    popover.hidePopover();
    trigger.dispatchEvent(new Event('change', { bubbles: true }));
  });
}


// One open popover at most follows its field; closed ones cost nothing.
for (const event of ['resize', 'scroll']) {
  window.addEventListener(event, () => {
    for (const popover of document.querySelectorAll('.combo:popover-open')) {
      const trigger = document.querySelector(`[popovertarget="${popover.id}"]`);
      combos.get(trigger)?.reposition?.();
    }
  }, { passive: true, capture: true });
}

export function setOptions(field, options, value) {
  const combo = combos.get(field);
  const chosen = options.find(option => option.value === value) ?? options[0];
  field.disabled = !options.length;
  if (!combo) {
    field.replaceChildren(...options.map(({ value: optionValue, label }) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      return option;
    }));
    field.value = chosen?.value ?? '';
    return;
  }
  combo.options = options;
  combo.value = chosen?.value ?? '';
  field.querySelector('.combo-value').textContent = chosen?.label ?? 'None available';
  combo.render();
}

export function fieldValue(field) {
  const combo = combos.get(field);
  return combo ? combo.value : field.value;
}
