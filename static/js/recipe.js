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
        : `<div class="recipe-hero-image-placeholder">🍽</div>`;
    }

    // Title/desc/meta goes into main #hero
    document.getElementById('hero').innerHTML = `
      <div class="recipe-hero-body">
        <h1 class="recipe-title" id="editable-title">${escHtml(recipe.title)}</h1>
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
        ${recipe.source_url
          ? `<a href="${escHtml(recipe.source_url)}" target="_blank" rel="noopener" class="recipe-source">
               ↗ Original source
             </a>`
          : ''}
      </div>`;
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
        editor.deleteStep(step);
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
    editBtn.textContent = active ? '✓ Done Editing' : '✏ Edit Recipe';
    editBtn.className   = active ? 'btn btn-primary' : 'btn btn-secondary';
  });

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
      altBody.innerHTML = `<div class="alt-list">${alts.map(a => {
        const amtStr = a.amount > 0 ? `<span class="alt-card-amount">${a.amount} ${escHtml(a.unit)}</span>` : '';
        const notesStr = a.notes ? `<span class="alt-card-notes"> — ${escHtml(a.notes)}</span>` : '';
        return `
          <div class="alt-card">
            <div class="alt-card-header">
              ${amtStr}
              <span class="alt-card-name">${escHtml(a.name)}</span>
              ${notesStr}
            </div>
            ${a.tip ? `<div class="alt-card-tip">${escHtml(a.tip)}</div>` : ''}
          </div>`;
      }).join('')}</div>`;
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
    const wakeDot   = document.getElementById('cook-wake-dot');
    let wakeLock    = null;

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

    document.getElementById('cook-exit-btn')?.addEventListener('click', exit);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('active')) exit();
    });

    return { enter };
  })();

  document.getElementById('cook-btn')?.addEventListener('click', () => cookingMode.enter());
})();

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
