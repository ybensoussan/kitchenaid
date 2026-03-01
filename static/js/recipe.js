// Recipe detail page: render, wire up units / scaling / editor.

(async () => {
  const params = new URLSearchParams(location.search);
  const recipeId = parseInt(params.get('id'), 10);
  if (!recipeId) { location.href = '/'; return; }

  // ── Load recipe ──────────────────────────────────────────────────────────

  let recipe;
  try {
    recipe = await api.getRecipe(recipeId);
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<p style="color:#dc2626">Failed to load recipe: ${escHtml(e.message)}</p>`;
    return;
  }

  document.title = `${recipe.title} — KitchenAid`;

  // Init scaling
  scaling.setBase(recipe.base_servings || 4);
  scaling.setDesired(recipe.base_servings || 4);

  // Init editor
  editor.init(recipeId, {
    onIngredientChange: async () => {
      const updated = await api.getRecipe(recipeId);
      recipe.ingredients = updated.ingredients;
      renderIngredients();
    },
    onStepChange: async () => {
      const updated = await api.getRecipe(recipeId);
      recipe.steps = updated.steps;
      renderSteps();
    },
  });

  // ── Render helpers ───────────────────────────────────────────────────────

  function formatTime(mins) {
    if (!mins) return '—';
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function renderHero() {
    // Photo goes into sidebar #recipe-photo
    const photoEl = document.getElementById('recipe-photo');

    if (photoEl) {
      photoEl.innerHTML = recipe.image_url
        ? `<img src="${escHtml(recipe.image_url)}" alt="${escHtml(recipe.title)}">`
        : `<div class="recipe-hero-image-placeholder-link" title="Search for images of this recipe" style="cursor:pointer">
             <div class="recipe-hero-image-placeholder">🍽</div>
             <span class="placeholder-search-hint">🔍 Search images</span>
           </div>`;

      if (!recipe.image_url) {
        photoEl.querySelector('.recipe-hero-image-placeholder-link')?.addEventListener('click', openImageSearch);
      }
    }

    // Title/desc/meta goes into main #hero
    document.getElementById('hero').innerHTML = `
      <div class="recipe-hero-body">
        <h1 class="recipe-title" id="editable-title">${escHtml(recipe.title)}</h1>
        
        <div class="recipe-tags-container">
          <div id="recipe-tags-list" class="recipe-tags-list">
            ${(recipe.tags || []).map(t => `
              <span class="recipe-tag">
                ${escHtml(t)}
                <button class="tag-del-btn edit-controls" data-tag="${escHtml(t)}">×</button>
              </span>
            `).join('')}
            <button id="suggest-tags-btn" class="btn btn-secondary btn-sm edit-controls" style="margin-left: 0.5rem" title="Suggest tags using AI">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 19v4"/></svg> Suggest Tags
            </button>
            <button id="add-tag-btn" class="btn btn-secondary btn-sm edit-controls" title="Add tag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>

        ${recipe.description
          ? `<p class="recipe-description" id="editable-desc">${escHtml(recipe.description)}</p>`
          : ''}
        <div class="recipe-meta-row">
          <div class="recipe-meta-item">
            <span class="recipe-meta-label">Prep</span>
            <span class="recipe-meta-value" id="editable-prep">${formatTime(recipe.prep_time)}</span>
          </div>
          <div class="recipe-meta-item">
            <span class="recipe-meta-label">Cook</span>
            <span class="recipe-meta-value" id="editable-cook">${formatTime(recipe.cook_time)}</span>
          </div>
          <div class="recipe-meta-item">
            <span class="recipe-meta-label">Serves</span>
            <span class="recipe-meta-value">${recipe.base_servings}</span>
          </div>
        </div>
        <div class="recipe-external-links">
          ${recipe.source_url
            ? `<a href="${escHtml(recipe.source_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">
                 ↗ Original source
               </a>`
            : ''}
          <button id="hero-image-search-btn" class="btn btn-secondary btn-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Search for Image
          </button>
        </div>
      </div>`;

    document.getElementById('hero-image-search-btn')?.addEventListener('click', openImageSearch);

    // Tag events
    document.getElementById('suggest-tags-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('suggest-tags-btn');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '🪄 Suggesting...';
      try {
        const { tags: suggested } = await api.suggestTags(recipeId);
        const existing = new Set((recipe.tags || []).map(t => t.toLowerCase()));
        const toAdd = suggested.filter(t => !existing.has(t.toLowerCase()));
        for (const tag of toAdd) {
          await api.addRecipeTag(recipeId, tag);
        }
        const updated = await api.getRecipe(recipeId);
        recipe.tags = updated.tags;
        renderHero();
        if (toAdd.length === 0) {
          showToast('No new tags to add');
        } else {
          showToast(`Added ${toAdd.length} tag${toAdd.length !== 1 ? 's' : ''}`);
        }
      } catch (err) {
        showToast('Failed to suggest tags: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });

    document.getElementById('add-tag-btn')?.addEventListener('click', openTagPicker);

    document.querySelectorAll('.tag-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tag = btn.dataset.tag;
        try {
          await fetch(`/api/recipes/${recipeId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
          const updated = await api.getRecipe(recipeId);
          recipe.tags = updated.tags;
          renderHero();
        } catch (err) {
          showToast('Failed to remove tag', true);
        }
      });
    });
  }

  // ── Image Search ─────────────────────────────────────────────────────────

  const imgModal = document.getElementById('image-search-modal');
  const imgBody  = document.getElementById('image-search-body');
  const imgInput = document.getElementById('image-search-input');
  const imgGoBtn = document.getElementById('image-search-go');

  imgModal?.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', () => imgModal.classList.remove('open')));
  imgModal?.addEventListener('click', e => {
    if (e.target === imgModal) imgModal.classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && imgModal?.classList.contains('open'))
      imgModal.classList.remove('open');
  });

  imgGoBtn?.addEventListener('click', () =>
    runImageSearch(imgInput.value.trim() || recipe.title));
  imgInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') imgGoBtn.click();
  });

  async function runImageSearch(query) {
    imgBody.innerHTML = `<div class="alt-loading"><div class="spinner" style="margin:.5rem auto"></div>Searching…</div>`;
    imgGoBtn.disabled = true;

    try {
      const result = await api.searchImages(query);
      const images = result.images || [];

      if (images.length === 0) {
        imgBody.innerHTML = `<p class="image-search-empty">No images found. Try a different search.</p>`;
        return;
      }

      imgBody.innerHTML = '<div class="image-results-grid"></div>';
      const grid = imgBody.querySelector('.image-results-grid');

      images.forEach((img, i) => {
        const item = document.createElement('div');
        item.className = 'image-result-item';

        const image = document.createElement('img');
        image.src = img.url;
        image.loading = 'lazy';
        image.alt = `Result ${i + 1}`;
        image.onerror = () => item.remove();

        item.appendChild(image);
        grid.appendChild(item);

        item.addEventListener('click', async () => {
          item.classList.add('selecting');
          try {
            await api.patchRecipe(recipeId, 'image_url', img.url);
            recipe.image_url = img.url;
            renderHero();
            imgModal.classList.remove('open');
          } catch (err) {
            item.classList.remove('selecting');
            showToast('Failed to set image: ' + err.message, true);
          }
        });
      });
    } catch (err) {
      imgBody.innerHTML = `<p class="image-search-empty" style="color:#dc2626">${escHtml(err.message)}</p>`;
    } finally {
      imgGoBtn.disabled = false;
    }
  }

  // ── Tag picker modal ──────────────────────────────────────────
  const tagModal   = document.getElementById('tag-picker-modal');
  const tagInput   = document.getElementById('tag-picker-input');
  const tagCreate  = document.getElementById('tag-picker-create');
  const tagExisting = document.getElementById('tag-picker-existing');

  tagModal.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', () => tagModal.classList.remove('open'))
  );
  tagModal.addEventListener('click', e => { if (e.target === tagModal) tagModal.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') tagModal.classList.remove('open'); });

  async function openTagPicker() {
    tagInput.value = '';
    tagCreate.disabled = true;
    tagExisting.innerHTML = '<p class="tag-picker-loading">Loading…</p>';
    tagModal.classList.add('open');
    tagInput.focus();

    let allTags = [];
    try {
      const data = await api.listTags();
      allTags = (data.tags || []).filter(t => !(recipe.tags || []).some(rt => rt.toLowerCase() === t.toLowerCase()));
    } catch (_) {}
    renderTagChips(allTags, '');

    tagInput.oninput = () => {
      const q = tagInput.value.trim();
      tagCreate.disabled = !q;
      renderTagChips(allTags, q);
    };

    tagInput.onkeydown = e => { if (e.key === 'Enter' && !tagCreate.disabled) tagCreate.click(); };

    tagCreate.onclick = async () => {
      const name = tagInput.value.trim();
      if (!name) return;
      await applyTag(name);
    };
  }

  function renderTagChips(allTags, q) {
    const lq = q.toLowerCase();
    const filtered = lq ? allTags.filter(t => t.toLowerCase().includes(lq)) : allTags;
    if (filtered.length === 0) {
      tagExisting.innerHTML = q
        ? `<p class="tag-picker-hint">Press Add to create "<strong>${escHtml(q)}</strong>"</p>`
        : `<p class="tag-picker-hint">No existing tags yet.</p>`;
      return;
    }
    tagExisting.innerHTML = `
      <p class="tag-picker-hint">Pick an existing tag or type a new one:</p>
      <div class="tag-picker-chips">
        ${filtered.map(t => `<button class="tag-picker-chip" data-tag="${escHtml(t)}">${escHtml(t)}</button>`).join('')}
      </div>`;
    tagExisting.querySelectorAll('.tag-picker-chip').forEach(chip =>
      chip.addEventListener('click', () => applyTag(chip.dataset.tag))
    );
  }

  async function applyTag(name) {
    tagCreate.disabled = true;
    try {
      await api.addRecipeTag(recipeId, name);
      const updated = await api.getRecipe(recipeId);
      recipe.tags = updated.tags;
      tagModal.classList.remove('open');
      renderHero();
      showToast(`Tag "${name}" added`);
    } catch (err) {
      showToast('Failed to add tag: ' + err.message, true);
      tagCreate.disabled = false;
    }
  }

  function openImageSearch() {
    imgInput.value = recipe.title;
    imgModal.classList.add('open');
    imgInput.select();
    runImageSearch(recipe.title);
  }

  function renderIngredients() {
    const ings = recipe.ingredients || [];
    const list = document.getElementById('ingredients-list');

    list.innerHTML = ings.map(ing => {
      const scaled = scaling.getScaledAmount(ing.amount);
      const fmt = units.formatAmount(scaled, ing.unit);
      return `
        <div class="ingredient-item" data-id="${ing.id}">
          <span class="ingredient-amount">${escHtml(fmt)}</span>
          <span class="ingredient-name">${escHtml(ing.name)}</span>
          ${ing.notes ? `<span class="ingredient-notes">${escHtml(ing.notes)}</span>` : ''}
          <button class="ing-alt-btn" data-id="${ing.id}" title="Find alternatives">⇄</button>
        </div>`;
    }).join('');

    // Wire edit clicks
    list.querySelectorAll('.ingredient-item').forEach(el => {
      el.addEventListener('click', () => {
        if (!editor.isActive()) return;
        const id = parseInt(el.dataset.id, 10);
        const ing = ings.find(i => i.id === id);
        if (ing) editor.openIngredientModal(ing, ings, null);
      });
    });

    // Wire alternatives buttons (stop propagation so edit click doesn't fire)
    list.querySelectorAll('.ing-alt-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const ing = ings.find(i => i.id === id);
        if (ing) openAlternativesModal(ing);
      });
    });
  }

  function renderSteps() {
    const steps = recipe.steps || [];
    const list = document.getElementById('steps-list');

    list.innerHTML = steps.map(step => {
      const text = units.convertStepText(step.instruction);
      return `
        <li class="step-item" data-id="${step.id}">
          <div class="step-number">${step.step_number}</div>
          <div class="step-content" style="flex:1">
            <p class="step-text">${escHtml(text)}</p>
            ${step.duration ? `<p class="step-duration">⏱ ${step.duration} min</p>` : ''}
          </div>
          <div class="step-actions">
            <button class="btn btn-ghost btn-sm btn-icon step-delete-btn" title="Delete step">🗑</button>
          </div>
        </li>`;
    }).join('');

    list.querySelectorAll('.step-item').forEach(el => {
      const id = parseInt(el.dataset.id, 10);
      const step = steps.find(s => s.id === id);

      // Click on step text to edit
      el.querySelector('.step-text')?.addEventListener('click', () => {
        if (!editor.isActive()) return;
        editor.makeStepEditable(el, step, steps, null);
      });

      // Delete button
      el.querySelector('.step-delete-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        editor.deleteStep(step, steps);
      });
    });
  }

  function reRenderAll() {
    renderIngredients();
    renderSteps();
  }

  // ── Initial render ───────────────────────────────────────────────────────

  renderHero();
  renderIngredients();
  renderSteps();

  // ── Wire hero editable fields ─────────────────────────────────────────────

  const titleEl = document.getElementById('editable-title');
  const descEl  = document.getElementById('editable-desc');
  const prepEl  = document.getElementById('editable-prep');
  const cookEl  = document.getElementById('editable-cook');

  editor.makeEditable(titleEl, 'title');
  if (descEl) editor.makeEditable(descEl, 'description');
  if (prepEl) editor.makeEditable(prepEl, 'prep_time', v => parseInt(v, 10) || 0);
  if (cookEl) editor.makeEditable(cookEl, 'cook_time', v => parseInt(v, 10) || 0);

  // ── Edit mode toggle ──────────────────────────────────────────────────────

  const editBtn = document.getElementById('edit-toggle-btn');
  editBtn?.addEventListener('click', () => {
    const active = editor.toggle();
    if (active) {
      editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 11"/></svg><span class="btn-label"> Done Editing</span>`;
      editBtn.className = 'btn btn-primary';
    } else {
      editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span class="btn-label"> Edit Recipe</span>`;
      editBtn.className = 'btn btn-secondary';
    }
  });

  document.getElementById('print-btn')?.addEventListener('click', () => window.print());

  // ── Favorite toggle ───────────────────────────────────────────────────────

  const favBtn = document.getElementById('fav-btn');
  function updateFavBtn() {
    if (!favBtn) return;
    const path = favBtn.querySelector('svg path');
    if (recipe.favorited) {
      favBtn.classList.add('active');
      if (path) path.setAttribute('fill', 'currentColor');
    } else {
      favBtn.classList.remove('active');
      if (path) path.setAttribute('fill', 'none');
    }
  }
  updateFavBtn();
  favBtn?.addEventListener('click', async () => {
    recipe.favorited = !recipe.favorited;
    updateFavBtn();
    try {
      await api.setFavorited(recipeId, recipe.favorited);
    } catch (err) {
      recipe.favorited = !recipe.favorited;
      updateFavBtn();
      showToast('Failed to update favorite', true);
    }
  });

  // ── Overflow dropdown ─────────────────────────────────────────────────────

  const overflowDropdown = document.getElementById('recipe-overflow-dropdown');
  const overflowBtn      = document.getElementById('recipe-overflow-btn');

  overflowBtn?.addEventListener('click', e => {
    e.stopPropagation();
    overflowDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => overflowDropdown?.classList.remove('open'));

  document.getElementById('export-json-link')?.setAttribute('href', `/api/recipes/${recipeId}/export?format=json`);
  document.getElementById('export-html-link')?.setAttribute('href', `/api/recipes/${recipeId}/export?format=html`);
  // ── Photo upload ──────────────────────────────────────────────────────────

  document.getElementById('photo-upload-input')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const uploaded = await api.upload(file);
      await api.patchRecipe(recipeId, 'image_url', uploaded.url);
      recipe.image_url = uploaded.url;
      renderHero();
    } catch (err) {
      showToast('Upload failed: ' + err.message, true);
    }
    e.target.value = '';
  });

  // ── Delete recipe ─────────────────────────────────────────────────────────

  document.getElementById('delete-btn')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${recipe.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteRecipe(recipeId);
      window.location.href = '/';
    } catch (e) {
      showToast('Delete failed: ' + e.message, true);
    }
  });

  // ── Units toggle ──────────────────────────────────────────────────────────

  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      units.setSystem(btn.dataset.system);
      document.querySelectorAll('.unit-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.system === units.getSystem()));
      reRenderAll();
    });
    btn.classList.toggle('active', btn.dataset.system === units.getSystem());
  });

  document.addEventListener('unitsChanged', reRenderAll);

  // ── Serving scale ─────────────────────────────────────────────────────────

  scaling.wireUI(
    document.getElementById('servings-input'),
    document.querySelectorAll('.serving-btn')
  );
  document.addEventListener('scalingChanged', renderIngredients);

  // ── Add ingredient (edit mode) ────────────────────────────────────────────

  document.getElementById('add-ingredient-btn')?.addEventListener('click', () => {
    editor.openIngredientModal(null, recipe.ingredients || [], null);
  });

  // ── From Pantry picker ────────────────────────────────────────────────────

  const pickerModal   = document.getElementById('pantry-picker-modal');
  const pickerList    = document.getElementById('pantry-picker-list');
  const pickerSearch  = document.getElementById('pantry-picker-search');
  const pickerConfirm = document.getElementById('pantry-picker-confirm');

  let pantryItemsCache = null;

  function renderPickerList(items, query = '') {
    const q = query.toLowerCase();
    const filtered = items.filter(it =>
      it.name.toLowerCase().includes(q) || (it.notes || '').toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      pickerList.innerHTML = `<li class="pantry-picker-empty">${items.length === 0 ? 'Your pantry is empty.' : 'No results.'}</li>`;
      return;
    }

    pickerList.innerHTML = '';
    filtered.forEach(item => {
      const li = document.createElement('li');
      li.className = 'pantry-picker-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.name = item.name;
      cb.addEventListener('change', updatePickerBtn);

      const nameEl = document.createElement('span');
      nameEl.className = 'pantry-picker-item-name';
      nameEl.textContent = item.name;

      li.appendChild(cb);
      li.appendChild(nameEl);

      const detail = [item.amount || null, item.unit || null].filter(Boolean).join(' ');
      if (detail) {
        const d = document.createElement('span');
        d.className = 'pantry-picker-item-detail';
        d.textContent = detail;
        li.appendChild(d);
      }

      li.addEventListener('click', e => {
        if (e.target !== cb) { cb.checked = !cb.checked; updatePickerBtn(); }
      });
      pickerList.appendChild(li);
    });
  }

  function updatePickerBtn() {
    const n = pickerList.querySelectorAll('input:checked').length;
    pickerConfirm.textContent = `Add ${n} item${n === 1 ? '' : 's'}`;
    pickerConfirm.disabled = n === 0;
  }

  document.getElementById('from-pantry-btn')?.addEventListener('click', async () => {
    if (!pantryItemsCache) {
      try { pantryItemsCache = await api.listPantryItems(); }
      catch (_) { pantryItemsCache = []; }
    }
    if (pantryItemsCache.length === 0) { showToast('Pantry is empty'); return; }
    pickerSearch.value = '';
    renderPickerList(pantryItemsCache);
    updatePickerBtn();
    pickerModal.classList.add('open');
    pickerSearch.focus();
  });

  pickerSearch?.addEventListener('input', e =>
    renderPickerList(pantryItemsCache || [], e.target.value));

  pickerConfirm?.addEventListener('click', async () => {
    const checked = [...pickerList.querySelectorAll('input:checked')];
    pickerModal.classList.remove('open');
    let added = 0;
    for (const cb of checked) {
      const item = pantryItemsCache.find(it => it.name === cb.dataset.name);
      if (!item) continue;
      try {
        await api.addIngredient(recipeId, {
          name: item.name,
          amount: item.amount || 0,
          unit: item.unit || '',
          notes: item.notes || '',
          sort_order: (recipe.ingredients || []).length + added,
        });
        added++;
      } catch (_) {}
    }
    if (added > 0) {
      const updated = await api.getRecipe(recipeId);
      recipe.ingredients = updated.ingredients;
      renderIngredients();
      showToast(`Added ${added} ingredient${added === 1 ? '' : 's'}`);
    }
  });

  pickerModal?.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', () => pickerModal.classList.remove('open')));
  pickerModal?.addEventListener('click', e => {
    if (e.target === pickerModal) pickerModal.classList.remove('open');
  });

  // ── Add step (edit mode) ──────────────────────────────────────────────────

  document.getElementById('add-step-btn')?.addEventListener('click', () => {
    editor.addStep(recipe.steps || []);
  });

  // ── Ingredient modal close ────────────────────────────────────────────────

  document.getElementById('ingredient-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('ingredient-modal')) {
      document.getElementById('ingredient-modal').classList.remove('open');
    }
  });

  // ── Ingredient alternatives ───────────────────────────────────────────────

  const altModal   = document.getElementById('alternatives-modal');
  const altIngName = document.getElementById('alt-ing-name');
  const altBody    = document.getElementById('alternatives-body');

  altModal?.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', () => altModal.classList.remove('open')));
  altModal?.addEventListener('click', e => {
    if (e.target === altModal) altModal.classList.remove('open');
  });

  async function openAlternativesModal(ing) {
    altIngName.textContent = ing.name;
    altBody.innerHTML = `<div class="alt-loading"><div class="spinner" style="margin:.5rem auto"></div>Finding alternatives…</div>`;
    altModal.classList.add('open');

    try {
      const result = await api.findAlternatives({
        name: ing.name, amount: ing.amount, unit: ing.unit, notes: ing.notes,
      });
      const alts = result.alternatives || [];
      if (alts.length === 0) {
        altBody.innerHTML = `<p style="padding:1rem;color:var(--muted)">No alternatives found.</p>`;
        return;
      }
      altBody.innerHTML = `<div class="alt-list">${alts.map((a, i) => {
        const amtStr = a.amount > 0 ? `<span class="alt-card-amount">${a.amount} ${escHtml(a.unit)}</span>` : '';
        const notesStr = a.notes ? `<span class="alt-card-notes"> — ${escHtml(a.notes)}</span>` : '';
        return `
          <div class="alt-card" data-idx="${i}" style="cursor:pointer">
            <div class="alt-card-header">
              ${amtStr}
              <span class="alt-card-name">${escHtml(a.name)}</span>
              ${notesStr}
            </div>
            ${a.tip ? `<div class="alt-card-tip">${escHtml(a.tip)}</div>` : ''}
          </div>`;
      }).join('')}</div>`;

      altBody.querySelectorAll('.alt-card').forEach(el => {
        el.addEventListener('click', async () => {
          const alt = alts[parseInt(el.dataset.idx, 10)];
          try {
            el.innerHTML = `<div class="spinner" style="margin:0 auto"></div>`;
            await api.updateIngredient(recipeId, ing.id, {
              name: alt.name,
              amount: alt.amount,
              unit: alt.unit,
              notes: alt.notes,
              sort_order: ing.sort_order,
            });
            // Update local state and re-render
            const updated = await api.getRecipe(recipeId);
            recipe.ingredients = updated.ingredients;
            renderIngredients();
            altModal.classList.remove('open');
          } catch (err) {
            alert('Failed to update ingredient: ' + err.message);
          }
        });
      });
    } catch (err) {
      altBody.innerHTML = `<p style="padding:1rem;color:#dc2626">${escHtml(err.message)}</p>`;
    }
  }

  // ── Cooking mode ──────────────────────────────────────────────────────────

  const cookingMode = (() => {
    const overlay   = document.getElementById('cooking-mode');
    const cookTitle = document.getElementById('cook-title');
    const ingList   = document.getElementById('cook-ingredient-list');
    const stepsList = document.getElementById('cook-steps-list');
    const timersList = document.getElementById('cook-timers-list');
    const wakeDot   = document.getElementById('cook-wake-dot');
    let wakeLock    = null;
    let timers      = []; // { id, label, seconds, initial, running }

    function addTimer(initialSeconds = 0, label = 'Timer') {
      const id = Date.now() + Math.random();
      timers.push({ id, label, seconds: initialSeconds, initial: initialSeconds, running: false });
      renderTimers();
    }

    function renderTimers() {
      if (timers.length === 0) {
        timersList.innerHTML = `<p style="font-size:0.8rem;color:var(--muted);text-align:center;padding:1rem">No active timers.</p>`;
        return;
      }

      timersList.innerHTML = timers.map(t => {
        const mm = Math.floor(t.seconds / 60);
        const ss = t.seconds % 60;
        const timeStr = `${mm}:${ss.toString().padStart(2, '0')}`;
        const isDone = t.seconds <= 0;

        return `
          <div class="cook-timer-card${isDone ? ' done' : ''}${t.running ? ' running' : ''}" data-id="${t.id}">
            <div class="timer-top">
              <input type="text" class="timer-label" value="${escHtml(t.label)}" placeholder="Label">
              <button class="timer-del-btn">✕</button>
            </div>
            <div class="timer-display">${timeStr}</div>
            <div class="timer-controls">
              ${!isDone ? `
                <button class="timer-toggle-btn btn btn-secondary btn-sm">
                  ${t.running ? 'Pause' : 'Start'}
                </button>
              ` : ''}
              <button class="timer-reset-btn btn btn-secondary btn-sm">Reset</button>
            </div>
          </div>`;
      }).join('');

      // Wire up timer events
      timersList.querySelectorAll('.cook-timer-card').forEach(el => {
        const id = parseFloat(el.dataset.id);
        const timer = timers.find(t => t.id === id);

        el.querySelector('.timer-label').addEventListener('change', e => {
          timer.label = e.target.value;
        });

        el.querySelector('.timer-del-btn').addEventListener('click', () => {
          timers = timers.filter(t => t.id !== id);
          renderTimers();
        });

        el.querySelector('.timer-toggle-btn')?.addEventListener('click', () => {
          timer.running = !timer.running;
          renderTimers();
        });

        el.querySelector('.timer-reset-btn').addEventListener('click', () => {
          timer.seconds = timer.initial;
          timer.running = false;
          renderTimers();
        });

        el.querySelector('.timer-display').addEventListener('click', () => {
          if (timer.running) return;
          const newMinutes = prompt('Enter minutes:', Math.floor(timer.seconds / 60));
          if (newMinutes !== null) {
            const mins = parseInt(newMinutes, 10) || 0;
            timer.seconds = mins * 60;
            timer.initial = timer.seconds;
            renderTimers();
          }
        });
      });
    }

    // Run every second
    setInterval(() => {
      let changed = false;
      timers.forEach(t => {
        if (t.running && t.seconds > 0) {
          t.seconds--;
          changed = true;
          if (t.seconds === 0) {
            t.running = false;
            try { new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play(); } catch(_) {}
          }
        }
      });
      if (changed) renderTimers();
    }, 1000);

    function populateIngredients() {
      const ings = recipe.ingredients || [];
      ingList.innerHTML = ings.map((ing, i) => {
        const scaled = scaling.getScaledAmount(ing.amount);
        const fmt    = units.formatAmount(scaled, ing.unit);
        return `
          <li class="cook-ingredient-item" data-idx="${i}">
            <div class="cook-check-box"></div>
            <div>
              <span class="cook-ingredient-amount">${escHtml(fmt)}</span>
              <span> ${escHtml(ing.name)}</span>
              ${ing.notes ? `<div class="cook-ingredient-notes">${escHtml(ing.notes)}</div>` : ''}
            </div>
          </li>`;
      }).join('');

      ingList.querySelectorAll('.cook-ingredient-item').forEach(el => {
        el.addEventListener('click', () => {
          el.classList.toggle('checked');
          el.querySelector('.cook-check-box').textContent =
            el.classList.contains('checked') ? '✓' : '';
        });
      });
    }

    function populateSteps() {
      const steps = recipe.steps || [];
      stepsList.innerHTML = steps.map((step, i) => {
        const text = units.convertStepText(step.instruction);
        return `
          <li class="cook-step-item${i === 0 ? ' current' : ''}" data-idx="${i}">
            <div class="cook-step-num">${step.step_number}</div>
            <p class="cook-step-text">${escHtml(text)}</p>
            <div class="cook-step-tick">✓</div>
          </li>`;
      }).join('');

      stepsList.querySelectorAll('.cook-step-item').forEach(el => {
        el.addEventListener('click', () => {
          el.classList.toggle('checked');
          el.classList.remove('current');
          advanceCurrentStep();
        });
      });
    }

    function advanceCurrentStep() {
      const items = [...stepsList.querySelectorAll('.cook-step-item')];
      let found = false;
      items.forEach(el => {
        el.classList.remove('current');
        if (!found && !el.classList.contains('checked')) {
          el.classList.add('current');
          found = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }

    function syncUnitBtns() {
      overlay.querySelectorAll('.cook-unit-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.system === units.getSystem()));
    }

    async function enter() {
      cookTitle.textContent = recipe.title;
      populateIngredients();
      populateSteps();
      syncUnitBtns();
      if (timers.length === 0) addTimer(0, 'Timer 1');
      renderTimers();
      overlay.classList.add('active');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeDot.classList.add('on');
          document.addEventListener('visibilitychange', reacquireWakeLock);
        }
      } catch (_) {}
    }

    function exit() {
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      wakeLock?.release().catch(() => {});
      wakeLock = null;
      wakeDot.classList.remove('on');
      document.removeEventListener('visibilitychange', reacquireWakeLock);
    }

    async function reacquireWakeLock() {
      if (wakeLock === null && document.visibilityState === 'visible') {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeDot.classList.add('on');
        } catch (_) {}
      }
    }

    // Units toggle inside cook mode
    overlay.querySelectorAll('.cook-unit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        units.setSystem(btn.dataset.system);
        syncUnitBtns();
        populateIngredients();
        populateSteps();
        // Re-apply checked state is lost on re-render — that's acceptable
      });
    });

    document.getElementById('add-timer-btn')?.addEventListener('click', () => addTimer(0, `Timer ${timers.length + 1}`));
    document.getElementById('cook-exit-btn')?.addEventListener('click', exit);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('active')) exit();
    });

    return { enter };
  })();

  document.getElementById('cook-btn')?.addEventListener('click', () => cookingMode.enter());

  document.getElementById('add-to-pantry-btn')
    ?.addEventListener('click', () => pantryReview.open(recipe.ingredients || []));
})();

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
