// Pantry review modal: lets users pick which recipe ingredients to add in bulk.

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
    const checked = list.querySelectorAll('input[type=checkbox]:checked').length;
    confirm.textContent = `Add ${checked} item${checked === 1 ? '' : 's'}`;
    confirm.disabled = checked === 0;
  }

  // ── open ─────────────────────────────────────────────────────────────────

  async function open(ingredients) {
    if (!ingredients || ingredients.length === 0) {
      showToast('No ingredients to add');
      return;
    }

    // Fetch existing pantry to detect duplicates
    let existing = new Set();
    try {
      const items = await api.listPantryItems();
      existing = new Set((items || []).map(it => normalise(it.name)));
    } catch (_) {
      // non-fatal: proceed without dedup
    }

    // Render list
    list.innerHTML = '';
    ingredients.forEach((ing, idx) => {
      const isDupe = existing.has(normalise(ing.name));
      const id     = `pr-ing-${idx}`;

      const li = document.createElement('li');
      li.className = 'pantry-review-item';

      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.id      = id;
      cb.checked = !isDupe;
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

      const badge = document.createElement('span');
      badge.className   = isDupe ? 'pantry-badge in-pantry' : 'pantry-badge new';
      badge.textContent = isDupe ? 'In pantry' : 'New';

      li.appendChild(cb);
      li.appendChild(lbl);
      li.appendChild(badge);
      list.appendChild(li);
    });

    updateConfirmBtn();
    modal.classList.add('open');
  }

  // ── confirm ───────────────────────────────────────────────────────────────

  confirm.addEventListener('click', async () => {
    const checked = [...list.querySelectorAll('input[type=checkbox]:checked')];
    const indices = checked.map(cb => parseInt(cb.id.replace('pr-ing-', ''), 10));

    // We need to recover the ingredient objects — store them on the list items
    const items = indices.map(i => ({ name: _currentIngredients[i].name }));

    confirm.disabled = true;
    try {
      const result = await api.batchAddPantryItems(items);
      showToast(`Added ${result.added} item${result.added === 1 ? '' : 's'} to pantry`);
      closeModal();
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

  // Wrap open to capture current ingredients for confirm handler
  const _open = open;
  function openWithState(ingredients) {
    _currentIngredients = ingredients || [];
    return _open(_currentIngredients);
  }

  return { open: openWithState };
})();
