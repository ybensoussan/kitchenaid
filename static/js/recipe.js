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

  // Load pantry for cost estimation (best-effort)
  let pantryItems = [];
  try { pantryItems = await api.listPantryItems(); } catch(_) {}

  // Init scaling
  scaling.setBase(recipe.base_servings || 4);
  scaling.setDesired(recipe.base_servings || 4);

  // Shared ingredient refresh callback (used by editor and pantry modal)
  async function refreshIngredients() {
    const [updated, freshPantry] = await Promise.all([
      api.getRecipe(recipeId),
      api.listPantryItems().catch(() => pantryItems),
    ]);
    recipe.ingredients = updated.ingredients;
    pantryItems = freshPantry;
    renderIngredients();
  }

  // Init editor
  editor.init(recipeId, {
    onIngredientChange: refreshIngredients,
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

  // ── Recipe cost helpers ───────────────────────────────────────────────────

  function parseAHUnitSize(sizeStr) {
    if (!sizeStr) return null;
    const s = sizeStr.trim().replace(',', '.');

    // Handle "per stuk / per piece / per st" → 1 piece
    if (/^per\s+(stuk|piece|st)\b/i.test(s)) return { amount: 1, unit: 'piece' };

    // Handle "N x M unit" multi-pack format (e.g. "6 x 15 g", "5 x 5 g")
    const mx = s.match(/^(\d+)\s*x\s*([\d.]+)\s*(.+)$/i);
    if (mx) {
      const count = parseFloat(mx[1]), each = parseFloat(mx[2]);
      const rawx = mx[3].toLowerCase().trim();
      const unitMap2 = { 'kg': {unit:'g', factor:1000}, 'g': {unit:'g', factor:1}, 'l': {unit:'ml', factor:1000}, 'ml': {unit:'ml', factor:1} };
      const ex = unitMap2[rawx];
      if (ex && count > 0 && each > 0) return { amount: count * each * ex.factor, unit: ex.unit };
    }

    const m = s.match(/^([\d.]+)\s*(.+)$/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    const raw = m[2].toLowerCase().trim();
    if (isNaN(num) || num <= 0) return null;

    const unitMap = {
      // weight
      'kg': { unit: 'g',  factor: 1000  }, 'g':  { unit: 'g',  factor: 1     }, 'mg': { unit: 'g',  factor: 0.001 },
      // volume — metric
      'l':  { unit: 'ml', factor: 1000  }, 'ml': { unit: 'ml', factor: 1     },
      // volume — cooking measures
      'tsp':         { unit: 'ml', factor: 5   }, 'teaspoon':   { unit: 'ml', factor: 5   }, 'teaspoons':  { unit: 'ml', factor: 5   },
      'tbsp':        { unit: 'ml', factor: 15  }, 'tablespoon': { unit: 'ml', factor: 15  }, 'tablespoons':{ unit: 'ml', factor: 15  },
      'cup':         { unit: 'ml', factor: 240 }, 'cups':       { unit: 'ml', factor: 240 },
      'fl oz':       { unit: 'ml', factor: 30  }, 'floz':       { unit: 'ml', factor: 30  },
      // count
      'stuks': { unit: 'piece', factor: 1 }, 'stuk': { unit: 'piece', factor: 1 }, 'st': { unit: 'piece', factor: 1 },
    };
    const entry = unitMap[raw];
    if (!entry) return null;
    return { amount: num * entry.factor, unit: entry.unit };
  }

  // Density table: grams per teaspoon for common dry ingredients.
  // Lets tsp/tbsp/cup ingredients cost against g-based pantry sizes.
  const DRY_G_PER_TSP = {
    'salt': 5.7, 'sea salt': 5.7, 'fine sea salt': 5.7, 'kosher salt': 4.8, 'coarse salt': 5.0,
    'sugar': 4.2, 'white sugar': 4.2, 'granulated sugar': 4.2,
    'brown sugar': 3.6, 'powdered sugar': 2.5, 'icing sugar': 2.5, "confectioners' sugar": 2.5, 'confectioners sugar': 2.5,
    'flour': 2.6, 'all-purpose flour': 2.6, 'bread flour': 2.9, 'whole wheat flour': 2.9,
    'baking soda': 4.6, 'bicarbonate of soda': 4.6,
    'baking powder': 4.0,
    'cornstarch': 2.7, 'corn starch': 2.7, 'arrowroot': 2.6, 'arrowroot powder': 2.6,
    'cocoa powder': 2.5, 'unsweetened cocoa': 2.5,
    'cinnamon': 2.3, 'ground cinnamon': 2.3,
    'cumin': 2.5, 'ground cumin': 2.5,
    'coriander': 1.8, 'ground coriander': 1.8,
    'turmeric': 2.8, 'ground turmeric': 2.8,
    'paprika': 2.3, 'smoked paprika': 2.3, 'sweet paprika': 2.3,
    'cayenne': 2.7, 'cayenne pepper': 2.7, 'cayenne powder': 2.7,
    'chili powder': 2.7, 'chilli powder': 2.7, 'chile powder': 2.7,
    'black pepper': 2.1, 'pepper': 2.1, 'white pepper': 2.4,
    'garlic powder': 3.1, 'onion powder': 2.4,
    'garam masala': 2.5, 'curry powder': 2.5,
    'oregano': 0.9, 'dried oregano': 0.9,
    'thyme': 1.1, 'dried thyme': 1.1,
    'basil': 0.7, 'dried basil': 0.7,
    'rosemary': 1.2, 'dried rosemary': 1.2,
    'nutmeg': 2.2, 'ground nutmeg': 2.2,
    'cardamom': 2.0, 'ground cardamom': 2.0,
    'cloves': 2.1, 'ground cloves': 2.1,
    'allspice': 1.9, 'ground allspice': 1.9,
    'mustard powder': 2.8, 'dry mustard': 2.8,
    // Seeds & nuts
    'poppy seeds': 2.9, 'sesame seeds': 3.0, 'flax seeds': 3.7, 'chia seeds': 4.0,
    'fennel seeds': 2.0, 'caraway seeds': 2.2, 'celery seeds': 2.5,
    // Fats (for tsp-based measures of solid fats)
    'butter': 4.7, 'ghee': 4.5, 'coconut oil': 4.5, 'lard': 4.5,
  };

  function toBaseUnit(amount, unit) {
    const u = (unit || '').toLowerCase().trim();
    const map = {
      // weight
      'g': ['g', amount], 'kg': ['g', amount * 1000], 'mg': ['g', amount * 0.001],
      // volume — metric
      'ml': ['ml', amount], 'l': ['ml', amount * 1000],
      // volume — cooking measures (to ml)
      'tsp': ['ml', amount * 5], 'teaspoon': ['ml', amount * 5], 'teaspoons': ['ml', amount * 5],
      'tbsp': ['ml', amount * 15], 'tablespoon': ['ml', amount * 15], 'tablespoons': ['ml', amount * 15],
      'cup': ['ml', amount * 240], 'cups': ['ml', amount * 240],
      'fl oz': ['ml', amount * 30], 'floz': ['ml', amount * 30],
      // count
      'piece': ['piece', amount], 'pieces': ['piece', amount],
      'stuks': ['piece', amount], 'stuk': ['piece', amount], 'st': ['piece', amount],
      // empty unit = dimensionless count (e.g. "3 eggs", "2 lemons")
      '': ['piece', amount],
    };
    return map[u] || null;
  }

  function calcIngredientCost(ingAmount, ingUnit, ingName, pkgPrice, pkgSizeStr) {
    const pkg = parseAHUnitSize(pkgSizeStr);
    if (!pkg || pkg.amount <= 0) return null;

    // Standard unit-compatible path
    const ingBase = toBaseUnit(ingAmount, ingUnit);
    if (ingBase && ingBase[0] === pkg.unit) {
      return (ingBase[1] / pkg.amount) * pkgPrice;
    }

    // Density fallback: tsp/tbsp/cup of a dry ingredient → grams
    if (pkg.unit === 'g') {
      const u = (ingUnit || '').toLowerCase().trim();
      const tspFactor = { 'tsp': 1, 'teaspoon': 1, 'teaspoons': 1, 'tbsp': 3, 'tablespoon': 3, 'tablespoons': 3, 'cup': 48, 'cups': 48 }[u];
      if (tspFactor) {
        const name = (ingName || '').toLowerCase().trim();
        const density = DRY_G_PER_TSP[name];
        if (density) {
          const ingGrams = ingAmount * tspFactor * density;
          return (ingGrams / pkg.amount) * pkgPrice;
        }
      }
    }

    // Liquid density fallback: volume ingredient → g-based pantry
    // (e.g. "3 tbsp lemon juice" linked to "Lemons 500g")
    if (pkg.unit === 'g') {
      const ingMl = toBaseUnit(ingAmount, ingUnit);
      if (ingMl && ingMl[0] === 'ml') {
        const name = (ingName || '').toLowerCase().trim();
        const LIQUID_G_PER_ML = {
          'lemon juice': 1.03, 'lime juice': 1.03, 'orange juice': 1.04,
          'water': 1.0, 'milk': 1.03, 'buttermilk': 1.03, 'cream': 1.01,
          'vinegar': 1.05, 'apple cider vinegar': 1.06, 'white vinegar': 1.05,
          'honey': 1.43, 'maple syrup': 1.32, 'molasses': 1.40,
          'soy sauce': 1.08, 'fish sauce': 1.1,
        };
        const density = LIQUID_G_PER_ML[name];
        if (density) return (ingMl[1] * density / pkg.amount) * pkgPrice;
      }
    }

    // Piece-weight fallback: count ingredient → g-based pantry
    // (e.g. "2 lemons" linked to "Lemons 500g")
    if (pkg.unit === 'g') {
      const ingBase2 = toBaseUnit(ingAmount, ingUnit);
      if (ingBase2 && ingBase2[0] === 'piece') {
        const name = (ingName || '').toLowerCase().trim();
        const PIECE_WEIGHT_G = {
          'lemon': 130, 'lemons': 130, 'zest of lemon': 130, 'zest of lemons': 130, 'lemon zest': 130,
          'lime': 80, 'limes': 80, 'orange': 180, 'oranges': 180,
          'onion': 150, 'yellow onion': 150, 'white onion': 150, 'red onion': 120,
          'garlic clove': 5, 'garlic': 5,
          'tomato': 120, 'tomatoes': 120,
          'carrot': 80, 'carrots': 80,
          'potato': 170, 'potatoes': 170,
          'apple': 180, 'apples': 180,
          'banana': 120, 'bananas': 120,
          'avocado': 200, 'avocados': 200,
        };
        const weight = PIECE_WEIGHT_G[name];
        if (weight) return (ingBase2[1] * weight / pkg.amount) * pkgPrice;
      }
    }

    return null;
  }

  function computeRecipeCost(ingredients, pantry) {
    const byId = new Map(pantry.map(p => [p.id, p]));
    let total = 0, costed = 0, linked = 0;
    for (const ing of ingredients) {
      if (!ing.pantry_item_id) continue;
      linked++;
      const p = byId.get(ing.pantry_item_id);
      if (!p || p.price <= 0) continue;
      const cost = calcIngredientCost(ing.amount, ing.unit, ing.name, p.price, p.price_unit_size);
      if (cost !== null) { total += cost; costed++; }
    }
    return { total, costed, linked, of: ingredients.length };
  }

  function renderCost() {
    const el = document.getElementById('recipe-cost-display');
    if (!el) return;
    const cost = computeRecipeCost(recipe.ingredients || [], pantryItems);
    if (cost.linked === 0) { el.innerHTML = ''; return; }
    const perServing = recipe.base_servings > 0 ? cost.total / recipe.base_servings : 0;
    el.innerHTML = `<div class="recipe-cost-row">
      <span class="recipe-cost-label">Est. cost</span>
      <span class="recipe-cost-value">
        ~€${cost.total.toFixed(2)}
        ${perServing > 0 ? `<span class="recipe-cost-per"> · ~€${perServing.toFixed(2)}/serving</span>` : ''}
        <span class="recipe-cost-coverage">(${cost.linked}/${cost.of} linked)</span>
      </span>
    </div>`;
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

        <p class="recipe-description${recipe.description ? '' : ' recipe-description--empty'}" id="editable-desc">${recipe.description ? escHtml(recipe.description) : ''}</p>
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
        <div id="recipe-cost-display"></div>
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

    // Wire editable fields — must be re-done each time renderHero replaces the DOM
    const _titleEl = document.getElementById('editable-title');
    const _descEl  = document.getElementById('editable-desc');
    const _prepEl  = document.getElementById('editable-prep');
    const _cookEl  = document.getElementById('editable-cook');
    if (_titleEl) editor.makeEditable(_titleEl, 'title');
    if (_descEl)  {
      editor.makeEditable(_descEl, 'description');
      _descEl.addEventListener('blur', () => {
        const v = _descEl.textContent.trim();
        recipe.description = v;
        _descEl.classList.toggle('recipe-description--empty', !v);
      });
    }
    if (_prepEl) editor.makeEditable(_prepEl, 'prep_time', v => parseInt(v, 10) || 0);
    if (_cookEl) editor.makeEditable(_cookEl, 'cook_time', v => parseInt(v, 10) || 0);

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

    renderCost();
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
      const linked = ing.pantry_item_id ? pantryItems.find(p => p.id === ing.pantry_item_id) : null;
      const linkTitle = linked ? `Linked: ${linked.name}` : 'Link to pantry item';
      return `
        <div class="ingredient-item" data-id="${ing.id}">
          <span class="ingredient-amount">${escHtml(fmt)}</span>
          <span class="ingredient-name">${escHtml(ing.name)}</span>
          ${ing.notes ? `<span class="ingredient-notes">${escHtml(ing.notes)}</span>` : ''}
          ${!linked ? `<button class="ing-add-pantry-btn" data-id="${ing.id}" title="Add to pantry &amp; link">+P</button>` : ''}
          <button class="ing-link-btn${linked ? ' linked' : ''}" data-id="${ing.id}" title="${escHtml(linkTitle)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
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

    // Wire quick "add to pantry" buttons (unlinked ingredients only)
    list.querySelectorAll('.ing-add-pantry-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const ing = ings.find(i => i.id === id);
        if (!ing) return;
        btn.disabled = true;
        try {
          const newItem = await api.createPantryItem({ name: ing.name });
          await api.linkIngredientPantry(recipeId, ing.id, newItem.id);
          await refreshIngredients();
          showToast(`"${ing.name}" added to pantry`);
        } catch (err) {
          showToast('Failed: ' + err.message, true);
          btn.disabled = false;
        }
      });
    });

    // Wire link buttons
    list.querySelectorAll('.ing-link-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const ing = ings.find(i => i.id === id);
        if (ing) openLinkModal(ing);
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

    renderCost();
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

  // ── Edit mode toggle ──────────────────────────────────────────────────────

  const editBtn = document.getElementById('edit-toggle-btn');
  editBtn?.addEventListener('click', () => {
    const active = editor.toggle();
    if (active) {
      editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 11"/></svg>`;
      editBtn.className = 'btn btn-primary btn-icon';
      editBtn.title = 'Done Editing';
    } else {
      editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      editBtn.className = 'btn btn-secondary btn-icon';
      editBtn.title = 'Edit Recipe';
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
    const filtered = items.filter(it => it.name.toLowerCase().includes(q));

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

      if (item.price_unit_size) {
        const d = document.createElement('span');
        d.className = 'pantry-picker-item-detail';
        d.textContent = item.price > 0 ? `€${item.price.toFixed(2)} / ${item.price_unit_size}` : item.price_unit_size;
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
          amount: 0,
          unit: '',
          notes: '',
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

  // ── Pantry link modal (link ingredient → pantry item) ─────────────────────

  const linkModal   = document.getElementById('pantry-link-modal');
  const linkSearch  = document.getElementById('pantry-link-search');
  const linkList    = document.getElementById('pantry-link-list');
  const linkConfirm = document.getElementById('pantry-link-confirm');
  const linkClear   = document.getElementById('pantry-link-clear');

  let _linkIngredientId     = null;
  let _linkSelectedPantryId = null;

  function renderLinkList(items, query) {
    const q = (query || '').toLowerCase();
    const filtered = items.filter(it => it.name.toLowerCase().includes(q));
    if (filtered.length === 0) {
      linkList.innerHTML = `<li class="pantry-picker-empty">No pantry items found.</li>`;
      return;
    }
    linkList.innerHTML = '';
    filtered.forEach(item => {
      const li = document.createElement('li');
      li.className = 'pantry-picker-item';

      const rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = 'pantry-link-item';
      rb.dataset.id = item.id;

      // Pre-select the currently linked item
      if (item.id === _linkSelectedPantryId) {
        rb.checked = true;
      }

      rb.addEventListener('change', () => {
        _linkSelectedPantryId = item.id;
        linkConfirm.disabled = false;
      });

      const nameEl = document.createElement('span');
      nameEl.className = 'pantry-picker-item-name';
      nameEl.textContent = item.name;

      li.appendChild(rb);
      li.appendChild(nameEl);

      if (item.price_unit_size) {
        const d = document.createElement('span');
        d.className = 'pantry-picker-item-detail';
        d.textContent = item.price > 0
          ? `€${item.price.toFixed(2)} / ${item.price_unit_size}`
          : item.price_unit_size;
        li.appendChild(d);
      }

      li.addEventListener('click', e => {
        if (e.target !== rb) {
          rb.checked = true;
          _linkSelectedPantryId = item.id;
          linkConfirm.disabled = false;
        }
      });
      linkList.appendChild(li);
    });
  }

  async function openLinkModal(ing) {
    _linkIngredientId = ing.id;
    // Pre-populate with current link so the button is immediately enabled
    _linkSelectedPantryId = ing.pantry_item_id || null;
    linkConfirm.disabled  = !_linkSelectedPantryId;
    linkSearch.value      = '';

    if (!pantryItemsCache) {
      try { pantryItemsCache = await api.listPantryItems(); }
      catch (_) { pantryItemsCache = []; }
    }

    renderLinkList(pantryItemsCache, ing.name);
    linkModal.classList.add('open');
    linkSearch.focus();
  }

  linkSearch?.addEventListener('input', e =>
    renderLinkList(pantryItemsCache || [], e.target.value));

  linkConfirm?.addEventListener('click', async () => {
    if (!_linkIngredientId || !_linkSelectedPantryId) return;
    linkConfirm.disabled = true;
    try {
      await api.linkIngredientPantry(recipeId, _linkIngredientId, _linkSelectedPantryId);
      const [updated, freshPantry] = await Promise.all([
        api.getRecipe(recipeId),
        api.listPantryItems().catch(() => pantryItems),
      ]);
      recipe.ingredients = updated.ingredients;
      pantryItems = freshPantry;
      renderIngredients();
      linkModal.classList.remove('open');
      showToast('Pantry item linked');
    } catch (e) {
      showToast('Failed to link: ' + e.message, true);
      linkConfirm.disabled = false;
    }
  });

  linkClear?.addEventListener('click', async () => {
    if (!_linkIngredientId) return;
    try {
      await api.linkIngredientPantry(recipeId, _linkIngredientId, null);
      const updated = await api.getRecipe(recipeId);
      recipe.ingredients = updated.ingredients;
      renderIngredients();
      linkModal.classList.remove('open');
      showToast('Pantry link cleared');
    } catch (e) {
      showToast('Failed to clear link: ' + e.message, true);
    }
  });

  linkModal?.querySelectorAll('.modal-close').forEach(btn =>
    btn.addEventListener('click', () => linkModal.classList.remove('open')));
  linkModal?.addEventListener('click', e => {
    if (e.target === linkModal) linkModal.classList.remove('open');
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
    ?.addEventListener('click', () => pantryReview.open(recipe.ingredients || [], {
      recipeId,
      onDone: refreshIngredients,
    }));
})();

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
