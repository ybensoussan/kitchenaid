// Standing grocery list: fed from recipes, from a week's plan, or typed here.

(function () {
  const listEl     = document.getElementById('gl-list');
  const countEl    = document.getElementById('gl-count');
  const addForm    = document.getElementById('gl-add-form');
  const nameInput  = document.getElementById('gl-add-name');
  const amtInput   = document.getElementById('gl-add-amount');
  const unitInput  = document.getElementById('gl-add-unit');
  const copyKeepBtn = document.getElementById('copy-keep-btn');
  const clearBtn   = document.getElementById('clear-done-btn');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const addWeekBtn = document.getElementById('add-week-btn');

  let items = [];

  // ── Rendering ─────────────────────────────────────────────────────────────

  function fmtAmount(item) {
    if (!item.amount) return item.unit || '';
    if (typeof units !== 'undefined' && units.formatAmount) {
      return units.formatAmount(item.amount, item.unit || '');
    }
    const rounded = Math.round(item.amount * 100) / 100;
    return item.unit ? `${rounded} ${item.unit}` : String(rounded);
  }

  function render() {
    const outstanding = items.filter(i => !i.checked).length;
    countEl.textContent = items.length === 0
      ? ''
      : `${outstanding} to buy${items.length - outstanding ? ` · ${items.length - outstanding} done` : ''}`;
    clearBtn.disabled = items.length === outstanding;
    clearAllBtn.disabled = items.length === 0;
    copyKeepBtn.disabled = outstanding === 0;

    if (items.length === 0) {
      listEl.innerHTML = `
        <li class="gl-empty">
          <p class="gl-empty-title">Nothing on the list</p>
          <p class="gl-empty-hint">Add an item above, pull in a week from the planner,
             or use “Add to list” on any recipe.</p>
        </li>`;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <li class="gl-item${item.checked ? ' checked' : ''}" data-id="${item.id}">
        <button class="gl-check" aria-label="${item.checked ? 'Mark as not bought' : 'Mark as bought'}"
                aria-pressed="${item.checked}">
          <span class="material-symbols-outlined">check</span>
        </button>
        <div class="gl-body">
          <span class="gl-name">${escHtml(item.name)}</span>
          ${item.source ? `<span class="gl-source">${escHtml(item.source)}</span>` : ''}
        </div>
        <span class="gl-amount">${escHtml(fmtAmount(item))}</span>
        <button class="gl-del" aria-label="Remove ${escHtml(item.name)}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </li>`).join('');

    listEl.querySelectorAll('.gl-item').forEach(el => {
      const id = parseInt(el.dataset.id, 10);
      el.querySelector('.gl-check').addEventListener('click', () => toggle(id));
      el.querySelector('.gl-del').addEventListener('click', () => remove(id));
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function load() {
    try {
      items = await api.listGrocery();
      render();
    } catch (e) {
      listEl.innerHTML = `<li class="gl-empty"><p class="gl-empty-title">Could not load the list</p>
        <p class="gl-empty-hint">${escHtml(e.message)}</p></li>`;
    }
  }

  async function toggle(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    // Optimistic: ticking things off should feel instant in a shop.
    item.checked = !item.checked;
    items = [...items.filter(i => !i.checked), ...items.filter(i => i.checked)];
    render();
    try {
      await api.updateGrocery(id, { checked: item.checked });
    } catch (e) {
      item.checked = !item.checked;
      render();
      showToast(`Could not save: ${e.message}`, true);
    }
  }

  async function remove(id) {
    const before = items;
    items = items.filter(i => i.id !== id);
    render();
    try {
      await api.deleteGrocery(id);
    } catch (e) {
      items = before;
      render();
      showToast(`Could not remove: ${e.message}`, true);
    }
  }

  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      items = await api.addGrocery([{
        name,
        amount: parseFloat(amtInput.value) || 0,
        unit: unitInput.value.trim(),
        source: '',
      }]);
      addForm.reset();
      nameInput.focus();
      render();
    } catch (err) {
      showToast(`Could not add: ${err.message}`, true);
    }
  });

  clearBtn.addEventListener('click', async () => {
    const done = items.filter(i => i.checked).length;
    if (!done) return;
    try {
      await api.clearCheckedGrocery();
      items = items.filter(i => !i.checked);
      render();
      showToast(`Cleared ${done} item${done === 1 ? '' : 's'}`);
    } catch (e) {
      showToast(`Could not clear: ${e.message}`, true);
    }
  });

  // Wiping items you have not bought yet is not recoverable, so confirm first.
  clearAllBtn.addEventListener('click', async () => {
    const total = items.length;
    if (!total) return;
    if (!confirm(`Remove all ${total} item${total === 1 ? '' : 's'} from the list?`)) return;
    const before = items;
    try {
      await api.clearAllGrocery();
      items = [];
      render();
      showToast(`Cleared ${total} item${total === 1 ? '' : 's'}`);
    } catch (e) {
      items = before;
      render();
      showToast(`Could not clear: ${e.message}`, true);
    }
  });

  // Pull the current week's plan in, so the planner stays the place you plan
  // and this stays the place you shop.
  addWeekBtn.addEventListener('click', async () => {
    addWeekBtn.disabled = true;
    try {
      const plans = await api.listPlans();
      if (!plans.length) {
        showToast('No meal plans yet');
        return;
      }
      const weekStart = mondayOf(new Date());
      const plan = plans.find(p => p.week_start === weekStart) || plans[0];
      const aggregate = await api.getGroceryList(plan.id);
      if (!aggregate.length) {
        showToast(`${plan.name} has no ingredients`);
        return;
      }
      items = await api.addGrocery(aggregate.map(g => ({
        name: g.name,
        amount: g.amount,
        unit: g.unit,
        source: (g.recipes || []).join(', '),
      })));
      render();
      showToast(`Added ${aggregate.length} items from ${plan.name}`);
    } catch (e) {
      showToast(`Could not add the week: ${e.message}`, true);
    } finally {
      addWeekBtn.disabled = false;
    }
  });

  function mondayOf(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7; // Monday = 0
    date.setDate(date.getDate() - day);
    return date.toISOString().slice(0, 10);
  }

  // ── Copy to Keep ──────────────────────────────────────────────────────────
  // Google Keep has no write API for personal accounts, so the OS share sheet
  // is the route into it. Keep receives this as a plain note; turning it into
  // a checklist is one tap (＋ → Checkboxes), and that conversion makes EVERY
  // line an item. So the body has to be item lines and nothing else — no
  // heading, no blank line, no "☐" prefixes, all of which would otherwise
  // become checklist entries or end up inside the item text. The heading goes
  // in the share title, which Android hands to Keep as the note title.

  function listTitle() {
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    return `Grocery list — ${date}`;
  }

  // One item per line, nothing else.
  function listAsText() {
    return items
      .filter(i => !i.checked)
      .map(i => {
        const amt = fmtAmount(i);
        return amt ? `${i.name} — ${amt}` : i.name;
      })
      .join('\n');
  }

  copyKeepBtn.addEventListener('click', async () => {
    const outstanding = items.filter(i => !i.checked);
    if (!outstanding.length) {
      showToast('Nothing left to buy');
      return;
    }
    const text = listAsText();

    if (navigator.share) {
      try {
        await navigator.share({ title: listTitle(), text });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user dismissed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied — paste into Keep, then ＋ → Checkboxes');
    } catch (_) {
      showToast('Could not copy the list on this device', true);
    }
  });

  load();
})();

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
