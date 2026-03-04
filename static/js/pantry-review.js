// Pantry review modal: lets users pick which recipe ingredients to add in bulk,
// and optionally link each ingredient to an existing pantry item.

const pantryReview = (() => {
  const modal    = document.getElementById('pantry-review-modal');
  const list     = document.getElementById('pantry-review-list');
  const confirm  = document.getElementById('pantry-review-confirm');

  // ── helpers ──────────────────────────────────────────────────────────────

  function normalise(name) {
    return String(name || '').trim().toLowerCase();
  }

  function formatLabel(ing) {
    const parts = [];
    if (ing.amount) parts.push(ing.amount);
    if (ing.unit)   parts.push(ing.unit);
    parts.push(ing.name);
    return parts.join(' ');
  }

  function updateConfirmBtn() {
    let newCount = 0, linkCount = 0;
    list.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
      const li  = cb.closest('li');
      const sel = li && li.querySelector('.pantry-link-select');
      if (!sel || sel.value === 'new') newCount++;
      else linkCount++;
    });
    const total = newCount + linkCount;
    const parts = [];
    if (newCount > 0)  parts.push(`${newCount} new`);
    if (linkCount > 0) parts.push(`${linkCount} link${linkCount === 1 ? '' : 's'}`);
    confirm.textContent = total > 0 ? `Confirm (${parts.join(', ')})` : 'Confirm';
    confirm.disabled = total === 0;
  }

  // ── open ─────────────────────────────────────────────────────────────────

  async function open(ingredients, opts = {}) {
    if (!ingredients || ingredients.length === 0) {
      showToast('No ingredients to add');
      return;
    }

    _currentIngredients = ingredients || [];
    _opts = opts;

    // Fetch existing pantry items for dropdown + dedup detection
    let pantryItems = [];
    try {
      pantryItems = await api.listPantryItems();
    } catch (_) {
      // non-fatal
    }

    const existingByName = new Map();
    (pantryItems || []).forEach(it => existingByName.set(normalise(it.name), it));

    // Render list
    list.innerHTML = '';
    ingredients.forEach((ing, idx) => {
      const matchedItem = existingByName.get(normalise(ing.name));
      const id = `pr-ing-${idx}`;

      const li = document.createElement('li');
      li.className = 'pantry-review-item';

      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.id      = id;
      cb.checked = true;
      cb.addEventListener('change', updateConfirmBtn);

      const lbl = document.createElement('label');
      lbl.htmlFor = id;
      lbl.textContent = formatLabel(ing);
      if (ing.notes) {
        const detail = document.createElement('span');
        detail.className   = 'pantry-item-detail';
        detail.textContent = ` (${ing.notes})`;
        lbl.appendChild(detail);
      }

      // Dropdown: "Create new" + all pantry items
      const sel = document.createElement('select');
      sel.className = 'pantry-link-select form-input';
      sel.style.cssText = 'font-size:.82rem;padding:.2rem .4rem;min-width:0;flex:1;max-width:160px';

      const optNew = document.createElement('option');
      optNew.value = 'new';
      optNew.textContent = '— Create new —';
      sel.appendChild(optNew);

      (pantryItems || [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(it => {
          const opt = document.createElement('option');
          opt.value = String(it.id);
          opt.textContent = it.name;
          sel.appendChild(opt);
        });

      // Pre-select matching item if found
      if (matchedItem) {
        sel.value = String(matchedItem.id);
      }

      sel.addEventListener('change', updateConfirmBtn);

      const badge = document.createElement('span');
      badge.className = matchedItem ? 'pantry-badge in-pantry' : 'pantry-badge new';
      badge.textContent = matchedItem ? 'In pantry' : 'New';

      li.appendChild(cb);
      li.appendChild(lbl);
      li.appendChild(sel);
      li.appendChild(badge);
      list.appendChild(li);
    });

    updateConfirmBtn();
    modal.classList.add('open');
  }

  // ── confirm ───────────────────────────────────────────────────────────────

  confirm.addEventListener('click', async () => {
    const checkedItems = [];
    list.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
      const idx = parseInt(cb.id.replace('pr-ing-', ''), 10);
      const li  = cb.closest('li');
      const sel = li && li.querySelector('.pantry-link-select');
      checkedItems.push({
        ing:    _currentIngredients[idx],
        action: sel ? sel.value : 'new',  // 'new' or pantry item id string
      });
    });

    confirm.disabled = true;
    let created = 0, linked = 0;

    try {
      for (const { ing, action } of checkedItems) {
        if (action === 'new') {
          // Create pantry item and optionally link
          const newItem = await api.createPantryItem({ name: ing.name });
          created++;
          if (_opts.recipeId && ing.id) {
            await api.linkIngredientPantry(_opts.recipeId, ing.id, newItem.id);
            linked++;
          }
        } else {
          // Link to existing pantry item
          const pantryId = parseInt(action, 10);
          if (_opts.recipeId && ing.id) {
            await api.linkIngredientPantry(_opts.recipeId, ing.id, pantryId);
            linked++;
          }
        }
      }

      const parts = [];
      if (created > 0) parts.push(`${created} item${created === 1 ? '' : 's'} added`);
      if (linked > 0)  parts.push(`${linked} linked`);
      showToast(parts.join(', ') || 'Done');

      closeModal();
      if (_opts.onDone) _opts.onDone();
    } catch (e) {
      showToast(`Error: ${e.message}`, true);
      confirm.disabled = false;
    }
  });

  // ── close ─────────────────────────────────────────────────────────────────

  function closeModal() {
    modal.classList.remove('open');
  }

  modal.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', closeModal)
  );
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  // ── internal state ────────────────────────────────────────────────────────

  let _currentIngredients = [];
  let _opts = {};

  return { open };
})();
