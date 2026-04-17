// Meal Planner — vanilla JS, no build step

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let currentWeekStart = getMondayOf(new Date()); // Date object
let allPlans = [];       // MealPlan[] (list, no entries)
let currentPlan = null;  // MealPlan with entries
let allRecipes = [];     // Recipe[] for picker
let groceryItems = [];   // GroceryItem[]

// pending picker state
let pickerDay = null;

// ── In-pantry set (persisted across sessions) ──────────────────────────────
const PANTRY_STORAGE_KEY = 'kitchenaid_grocery_pantry';
let inPantryKeys = new Set(JSON.parse(localStorage.getItem(PANTRY_STORAGE_KEY) || '[]'));

function pantryKey(item) {
  return `${item.name.toLowerCase()}|${item.unit || ''}`;
}
function savePantryKeys() {
  localStorage.setItem(PANTRY_STORAGE_KEY, JSON.stringify([...inPantryKeys]));
}
function togglePantry(item) {
  const k = pantryKey(item);
  if (inPantryKeys.has(k)) inPantryKeys.delete(k);
  else inPantryKeys.add(k);
  savePantryKeys();
  renderGroceryList();
}

// ── Utilities ──────────────────────────────────────────────────────────────

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateShort(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isTodayColumn(dayIndex) {
  const today = getMondayOf(new Date());
  const colDate = addDays(currentWeekStart, dayIndex);
  const todayDate = new Date();
  return colDate.toDateString() === todayDate.toDateString();
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Week navigation ────────────────────────────────────────────────────────

function updateWeekLabel() {
  const end = addDays(currentWeekStart, 6);
  document.getElementById('week-label').textContent =
    `${formatDateShort(currentWeekStart)} – ${formatDateShort(end)}`;

  // Also pre-fill new plan modal date
  document.getElementById('new-plan-week').value = formatDate(currentWeekStart);
}

document.getElementById('prev-week-btn').addEventListener('click', () => {
  currentWeekStart = addDays(currentWeekStart, -7);
  updateWeekLabel();
  syncPlanForWeek();
});

document.getElementById('next-week-btn').addEventListener('click', () => {
  currentWeekStart = addDays(currentWeekStart, 7);
  updateWeekLabel();
  syncPlanForWeek();
});

// ── Plans ──────────────────────────────────────────────────────────────────

async function loadPlans() {
  try {
    allPlans = await api.get('/api/plans');
    populatePlanSelector();
    syncPlanForWeek();
  } catch (e) {
    showToast('Failed to load plans: ' + e.message, 'error');
  }
}

function populatePlanSelector() {
  const select = document.getElementById('plan-select');
  select.innerHTML = '';
  allPlans.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

function syncPlanForWeek() {
  const weekStr = formatDate(currentWeekStart);
  const match = allPlans.find(p => p.week_start === weekStr);
  if (match) {
    document.getElementById('plan-selector-row').style.display = 'flex';
    document.getElementById('plan-select').value = match.id;
    loadPlan(match.id);
  } else {
    currentPlan = null;
    document.getElementById('plan-selector-row').style.display = 'none';
    renderNoPlan();
  }
}

document.getElementById('plan-select').addEventListener('change', (e) => {
  const id = parseInt(e.target.value, 10);
  if (id) loadPlan(id);
});

async function loadPlan(id) {
  try {
    currentPlan = await api.get(`/api/plans/${id}`);
    renderPlanContent();
    // Reset grocery list
    groceryItems = [];
    renderGroceryList();
  } catch (e) {
    showToast('Failed to load plan: ' + e.message, 'error');
  }
}

async function createPlan(name, weekStart) {
  try {
    const plan = await api.post('/api/plans', { name, week_start: weekStart });
    allPlans.unshift(plan);
    populatePlanSelector();
    document.getElementById('plan-selector-row').style.display = 'flex';
    document.getElementById('plan-select').value = plan.id;
    currentPlan = plan;
    renderPlanContent();
    groceryItems = [];
    renderGroceryList();
    showToast('Plan created', 'success');
  } catch (e) {
    showToast('Failed to create plan: ' + e.message, 'error');
  }
}

document.getElementById('delete-plan-btn').addEventListener('click', async () => {
  if (!currentPlan) return;
  if (!confirm(`Delete "${currentPlan.name}"? This cannot be undone.`)) return;
  try {
    await api.delete(`/api/plans/${currentPlan.id}`);
    allPlans = allPlans.filter(p => p.id !== currentPlan.id);
    currentPlan = null;
    populatePlanSelector();
    syncPlanForWeek();
    showToast('Plan deleted', 'success');
  } catch (e) {
    showToast('Failed to delete plan: ' + e.message, 'error');
  }
});

// ── New Plan Modal ─────────────────────────────────────────────────────────

document.getElementById('new-plan-btn').addEventListener('click', () => {
  document.getElementById('new-plan-week').value = formatDate(currentWeekStart);
  document.getElementById('new-plan-name').value = `Week of ${formatDate(currentWeekStart)}`;
  document.getElementById('new-plan-modal').classList.add('open');
});

document.getElementById('no-plan-create-btn').addEventListener('click', () => {
  document.getElementById('new-plan-week').value = formatDate(currentWeekStart);
  document.getElementById('new-plan-name').value = `Week of ${formatDate(currentWeekStart)}`;
  document.getElementById('new-plan-modal').classList.add('open');
});

document.getElementById('new-plan-confirm-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-plan-name').value.trim();
  const weekStart = document.getElementById('new-plan-week').value;
  if (!weekStart) { showToast('Please pick a week start date', 'error'); return; }
  closeModal('new-plan-modal');
  await createPlan(name || `Week of ${weekStart}`, weekStart);
});

// ── Grid rendering ─────────────────────────────────────────────────────────

function renderNoPlan() {
  const content = document.getElementById('planner-content');
  content.innerHTML = `
    <div class="no-plan-state" id="no-plan-state">
      <p>No meal plan for this week yet.</p>
      <button class="btn btn-primary" id="no-plan-create-btn">+ Create Plan for This Week</button>
    </div>`;
  document.getElementById('no-plan-create-btn').addEventListener('click', () => {
    document.getElementById('new-plan-week').value = formatDate(currentWeekStart);
    document.getElementById('new-plan-name').value = `Week of ${formatDate(currentWeekStart)}`;
    document.getElementById('new-plan-modal').classList.add('open');
  });
}

function renderPlanContent() {
  const content = document.getElementById('planner-content');
  content.innerHTML = `
    <div class="planner-main-layout">
      <div class="planner-grid-wrapper">
        <div class="planner-grid" id="planner-grid"></div>
      </div>
      <div class="grocery-section">
        <div class="grocery-header">
          <span class="grocery-title">Grocery List</span>
          <div class="grocery-actions">
            <div class="unit-toggle" id="grocery-unit-toggle">
              <button class="unit-toggle-btn" data-sys="metric">metric</button>
              <button class="unit-toggle-btn" data-sys="imperial">imperial</button>
            </div>
            <button class="btn btn-secondary" id="gen-grocery-btn">Generate</button>
            <button class="btn btn-secondary" id="copy-grocery-btn" style="display:none;">Copy</button>
          </div>
        </div>
        <ul class="grocery-list" id="grocery-list">
          <li class="grocery-empty">Click "Generate" to aggregate ingredients.</li>
        </ul>
        <form class="grocery-add-row" id="grocery-add-form" autocomplete="off">
          <input class="grocery-add-name" id="grocery-add-name" type="text" placeholder="Add item…" required>
          <input class="grocery-add-amount" id="grocery-add-amount" type="number" min="0" step="any" placeholder="qty">
          <input class="grocery-add-unit" id="grocery-add-unit" type="text" placeholder="unit">
          <button class="grocery-add-btn" type="submit">+</button>
        </form>
      </div>
    </div>`;

  document.getElementById('gen-grocery-btn').addEventListener('click', loadGroceryList);
  document.getElementById('copy-grocery-btn').addEventListener('click', copyGroceryList);

  // Unit toggle buttons
  const unitToggle = document.getElementById('grocery-unit-toggle');
  function updateUnitToggle() {
    const sys = units.getSystem();
    unitToggle.querySelectorAll('.unit-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sys === sys);
    });
  }
  unitToggle.querySelectorAll('.unit-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      units.setSystem(btn.dataset.sys);
      updateUnitToggle();
      if (groceryItems.length > 0) renderGroceryList();
    });
  });
  updateUnitToggle();

  document.getElementById('grocery-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('grocery-add-name').value.trim();
    if (!name) return;
    const amount = parseFloat(document.getElementById('grocery-add-amount').value) || 0;
    const unit = document.getElementById('grocery-add-unit').value.trim();
    groceryItems.push({ name, amount, unit, recipes: [] });
    document.getElementById('grocery-add-name').value = '';
    document.getElementById('grocery-add-amount').value = '';
    document.getElementById('grocery-add-unit').value = '';
    renderGroceryList();
    document.getElementById('grocery-add-name').focus();
  });

  renderGrid(currentPlan);
}

function renderGrid(plan) {
  const grid = document.getElementById('planner-grid');
  if (!grid) return;

  const entryMap = {};
  (plan.entries || []).forEach(e => {
    if (!entryMap[e.day]) entryMap[e.day] = [];
    entryMap[e.day].push(e);
  });

  let html = '';

  DAYS.forEach((day, i) => {
    const colDate = addDays(currentWeekStart, i);
    const entry = (entryMap[day] || [])[0] || null;
    const todayClass = isTodayColumn(i) ? ' today-card' : '';

    html += `<div class="day-card${todayClass}" data-day="${day}">`;
    html += `<div class="day-card-header">
      <span class="day-card-label">${DAY_LABELS[i]}</span>
      <span class="day-card-date">${formatDateShort(colDate)}</span>
    </div>`;

    if (entry) {
      const mult = [1, 2, 3, 4].includes(entry.servings) ? entry.servings : 1;
      const multBtns = [1, 2, 3, 4].map(n =>
        `<button class="chip-mult-btn${n === mult ? ' active' : ''}" data-mult="${n}" data-entry-id="${entry.id}" data-day="${day}" data-recipe-id="${entry.recipe_id}">${n}×</button>`
      ).join('');
      html += `<div class="day-card-image">
        ${entry.recipe_image
          ? `<img src="${escHtml(entry.recipe_image)}" alt="" loading="lazy">`
          : `<div class="day-card-image-placeholder"><span class="material-symbols-outlined">restaurant</span></div>`
        }
      </div>
      <div class="day-card-recipe">
        <div class="day-card-recipe-title">${escHtml(entry.recipe_title)}</div>
        <div class="day-card-recipe-actions">
          ${multBtns}
          <button class="day-card-remove" data-entry-id="${entry.id}" title="Remove">×</button>
        </div>
      </div>`;
    } else {
      html += `<div class="day-card-empty">
        <span class="day-card-empty-hint">+ Pick recipe</span>
      </div>`;
    }

    html += `</div>`;
  });

  grid.innerHTML = html;

  grid.querySelectorAll('.day-card-remove').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeEntry(parseInt(btn.dataset.entryId, 10));
    });
  });

  grid.querySelectorAll('.chip-mult-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      updateEntryMultiplier(
        parseInt(btn.dataset.entryId, 10),
        btn.dataset.day,
        parseInt(btn.dataset.recipeId, 10),
        parseInt(btn.dataset.mult, 10)
      );
    });
  });

  grid.querySelectorAll('.day-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      if (!ev.target.closest('.day-card-remove') && !ev.target.closest('.chip-mult-btn')) {
        openRecipePicker(card.dataset.day);
      }
    });
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Entry operations ───────────────────────────────────────────────────────

async function removeEntry(entryId) {
  if (!currentPlan) return;
  try {
    await api.delete(`/api/plans/${currentPlan.id}/entries/${entryId}`);
    currentPlan.entries = currentPlan.entries.filter(e => e.id !== entryId);
    renderGrid(currentPlan);
  } catch (e) {
    showToast('Failed to remove entry: ' + e.message, 'error');
  }
}

async function updateEntryMultiplier(entryId, day, recipeId, newMult) {
  if (!currentPlan) return;
  try {
    await api.delete(`/api/plans/${currentPlan.id}/entries/${entryId}`);
    const entry = await api.post(`/api/plans/${currentPlan.id}/entries`, {
      recipe_id: recipeId,
      day: day,
      meal_type: 'meal',
      servings: newMult,
    });
    currentPlan.entries = currentPlan.entries.filter(e => e.id !== entryId);
    currentPlan.entries.push(entry);
    renderGrid(currentPlan);
    if (groceryItems.length > 0) loadGroceryList();
  } catch (e) {
    showToast('Failed to update multiplier: ' + e.message, 'error');
  }
}

async function pickRecipe(recipeId, day, servings) {
  if (!currentPlan) return;
  try {
    // Remove existing entry for this day before adding the new one
    const existing = currentPlan.entries.find(e => e.day === day);
    if (existing) {
      await api.delete(`/api/plans/${currentPlan.id}/entries/${existing.id}`);
      currentPlan.entries = currentPlan.entries.filter(e => e.id !== existing.id);
    }
    const entry = await api.post(`/api/plans/${currentPlan.id}/entries`, {
      recipe_id: recipeId,
      day: day,
      meal_type: 'meal',
      servings: servings,
    });
    currentPlan.entries.push(entry);
    renderGrid(currentPlan);
    closeModal('picker-modal');
    showToast('Recipe added', 'success');
  } catch (e) {
    showToast('Failed to add recipe: ' + e.message, 'error');
  }
}

// ── Recipe Picker Modal ────────────────────────────────────────────────────

async function openRecipePicker(day) {
  pickerDay = day;
  document.getElementById('picker-modal-title').textContent =
    `Add to ${day.charAt(0).toUpperCase() + day.slice(1)}`;
  document.getElementById('picker-search').value = '';
  document.getElementById('picker-modal').classList.add('open');

  if (allRecipes.length === 0) {
    try {
      allRecipes = await api.get('/api/recipes');
    } catch (e) {
      showToast('Failed to load recipes: ' + e.message, 'error');
    }
  }
  renderPickerGrid(allRecipes);
}

function renderPickerGrid(recipes) {
  const grid = document.getElementById('picker-grid');
  if (recipes.length === 0) {
    grid.innerHTML = '<div class="picker-empty">No recipes found.</div>';
    return;
  }
  grid.innerHTML = recipes.map(r => {
    const imgPart = r.image_url
      ? `<img class="picker-card-img" src="${r.image_url}" alt="" loading="lazy">`
      : `<div class="picker-card-img-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></div>`;
    return `<div class="picker-card" data-recipe-id="${r.id}">
      ${imgPart}
      <div class="picker-card-title" title="${escHtml(r.title)}">${escHtml(r.title)}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.picker-card').forEach(card => {
    card.addEventListener('click', () => {
      const recipeId = parseInt(card.dataset.recipeId, 10);
      pickRecipe(recipeId, pickerDay, 1);
    });
  });
}

document.getElementById('picker-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allRecipes.filter(r => r.title.toLowerCase().includes(q));
  renderPickerGrid(filtered);
});

// ── Grocery List ───────────────────────────────────────────────────────────

async function loadGroceryList() {
  if (!currentPlan) return;
  try {
    groceryItems = await api.get(`/api/plans/${currentPlan.id}/grocery`);
    renderGroceryList();
  } catch (e) {
    showToast('Failed to load grocery list: ' + e.message, 'error');
  }
}

function renderGroceryList() {
  const list = document.getElementById('grocery-list');
  const copyBtn = document.getElementById('copy-grocery-btn');
  if (!list) return;

  if (groceryItems.length === 0) {
    list.innerHTML = '<li class="grocery-empty">No ingredients found. Add recipes to the planner first.</li>';
    if (copyBtn) copyBtn.style.display = 'none';
    return;
  }

  if (copyBtn) copyBtn.style.display = '';

  list.innerHTML = groceryItems.map((item, idx) => {
    const inPantry = inPantryKeys.has(pantryKey(item));
    const recipesStr = item.recipes.join(', ');
    const amtDisplay = item.amount > 0 ? units.formatAmount(item.amount, item.unit) : (item.unit || '');
    const amountControls = item.amount > 0 && !inPantry
      ? `<div class="grocery-amount-ctrl">
          <button class="grocery-amt-btn grocery-amt-minus" data-idx="${idx}">−</button>
          <span class="grocery-amt-display">${escHtml(amtDisplay)}</span>
          <button class="grocery-amt-btn grocery-amt-plus" data-idx="${idx}">+</button>
        </div>`
      : (amtDisplay ? `<span class="grocery-item-amount">${escHtml(amtDisplay)}</span>` : '');
    const imgPart = item.image_url
      ? `<img class="grocery-item-img" src="${escHtml(item.image_url)}" alt="" loading="lazy">`
      : `<div class="grocery-item-img-placeholder"></div>`;
    return `<li class="grocery-item${inPantry ? ' in-pantry' : ''}" data-idx="${idx}">
      <button class="grocery-pantry-btn${inPantry ? ' active' : ''}" data-idx="${idx}" title="${inPantry ? 'Mark as needed' : 'Mark as in pantry'}">✓</button>
      ${imgPart}
      <span class="grocery-item-name">${escHtml(item.name)}</span>
      ${amountControls}
      <span class="grocery-item-recipes">${escHtml(recipesStr)}</span>
    </li>`;
  }).join('');

  list.querySelectorAll('.grocery-pantry-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      togglePantry(groceryItems[parseInt(btn.dataset.idx, 10)]);
    });
  });

  list.querySelectorAll('.grocery-amt-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const item = groceryItems[idx];
      const step = amountStep(item.amount);
      item.amount = Math.max(step, parseFloat((item.amount - step).toFixed(6)));
      renderGroceryList();
    });
  });

  list.querySelectorAll('.grocery-amt-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const item = groceryItems[idx];
      const step = amountStep(item.amount);
      item.amount = parseFloat((item.amount + step).toFixed(6));
      renderGroceryList();
    });
  });
}

function amountStep(n) {
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 0.01) return 1;
  if (n <= 1) return 0.25;
  if (n <= 4) return 0.5;
  return 1;
}

function formatAmount(n) {
  if (!n || n === 0) return '';
  // Common fractions to try, in order of preference
  const fractions = [
    [1,2],[1,3],[2,3],[1,4],[3,4],[1,6],[5,6],[1,8],[3,8],[5,8],[7,8]
  ];
  const whole = Math.floor(n);
  const dec = n - whole;
  if (dec < 0.01) return String(whole);

  let bestFrac = null;
  let bestErr = 0.05; // tolerance
  for (const [num, den] of fractions) {
    const err = Math.abs(dec - num / den);
    if (err < bestErr) { bestErr = err; bestFrac = `${num}/${den}`; }
  }

  if (!bestFrac) return parseFloat(n.toFixed(2)).toString();
  return whole > 0 ? `${whole} ${bestFrac}` : bestFrac;
}

function copyGroceryList() {
  if (groceryItems.length === 0) return;
  const text = groceryItems
    .filter(item => !inPantryKeys.has(pantryKey(item)))
    .map(item => {
      const amtStr = item.amount > 0 ? units.formatAmount(item.amount, item.unit) : (item.unit || '');
      const parts = [item.name];
      if (amtStr) parts.push(`— ${amtStr}`);
      return parts.join(' ');
    }).join('\n');

  navigator.clipboard.writeText(text).then(() => {
    showToast('Grocery list copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// ── Modal helpers ──────────────────────────────────────────────────────────

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const overlay = btn.closest('.modal-overlay');
    if (overlay) overlay.classList.remove('open');
  });
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ── Bootstrap ──────────────────────────────────────────────────────────────

updateWeekLabel();
loadPlans();
