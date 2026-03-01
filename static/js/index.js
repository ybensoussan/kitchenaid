// Main page: load recipes, render grid, wire search + import.

(async () => {
  const grid    = document.getElementById('recipe-grid');
  const search  = document.getElementById('search-input');
  const countEl = document.getElementById('recipe-count');

  let allRecipes = [];
  let activeTag = null;

  function formatTime(mins) {
    if (!mins) return null;
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function renderCard(r) {
    const prep = formatTime(r.prep_time);
    const cook = formatTime(r.cook_time);
    const times = [prep && `Prep ${prep}`, cook && `Cook ${cook}`].filter(Boolean);
    const draggable = !activeTag ? 'draggable="true"' : '';

    return `
      <article class="recipe-card" ${draggable} data-id="${r.id}" onclick="window.location='/recipe.html?id=${r.id}'">
        <div class="recipe-card-image">
          ${r.image_url
            ? `<img src="${escHtml(r.image_url)}" alt="${escHtml(r.title)}" loading="lazy">`
            : `<span class="recipe-card-image-placeholder">🍽</span>`
          }
          <button class="card-fav-btn${r.favorited ? ' active' : ''}" data-id="${r.id}" title="Favorite">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${r.favorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
        </div>
        <div class="recipe-card-body">
          <h2 class="recipe-card-title">${escHtml(r.title)}</h2>
          ${(r.tags || []).length > 0 ? `
            <div class="card-tags">
              ${r.tags.slice(0, 3).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('')}${r.tags.length > 3 ? `<span class="card-tag card-tag-more">+${r.tags.length - 3}</span>` : ''}
            </div>
          ` : ''}
          ${r.description ? `<p class="recipe-card-desc">${escHtml(r.description)}</p>` : ''}
          <div class="recipe-card-meta">
            ${times.map(t => `<span class="recipe-card-meta-item">${escHtml(t)}</span>`).join('')}
            ${r.base_servings ? `<span class="recipe-card-meta-item">Serves ${r.base_servings}</span>` : ''}
          </div>
        </div>
      </article>`;
  }

  function renderGrid(recipes) {
    if (recipes.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <h2>No recipes found</h2>
          <p>Try a different search or tag.</p>
        </div>`;
    } else {
      grid.innerHTML = recipes.map(renderCard).join('');
      wireFavButtons();
      wireDragDrop();
    }
    if (countEl) countEl.textContent = `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`;
  }

  function wireFavButtons() {
    grid.querySelectorAll('.card-fav-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const recipe = allRecipes.find(r => r.id === id);
        if (!recipe) return;
        recipe.favorited = !recipe.favorited;
        btn.classList.toggle('active', recipe.favorited);
        btn.querySelector('svg path').setAttribute('fill', recipe.favorited ? 'currentColor' : 'none');
        // If favorites filter is active and recipe was unfavorited, re-filter
        if (activeTag === '__favorites__' && !recipe.favorited) filter();
        try {
          await api.setFavorited(id, recipe.favorited);
        } catch (err) {
          // revert on failure
          recipe.favorited = !recipe.favorited;
          btn.classList.toggle('active', recipe.favorited);
          btn.querySelector('svg path').setAttribute('fill', recipe.favorited ? 'currentColor' : 'none');
        }
      });
    });
  }

  let dragSrc = null;

  function wireDragDrop() {
    if (activeTag) return; // disable drag when filtered

    grid.querySelectorAll('.recipe-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', e => {
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        grid.querySelectorAll('.recipe-card').forEach(c => c.classList.remove('drag-over'));
        // Persist new order
        const ids = [...grid.querySelectorAll('.recipe-card[data-id]')]
          .map(c => parseInt(c.dataset.id, 10));
        // Update allRecipes order to match DOM
        const byId = Object.fromEntries(allRecipes.map(r => [r.id, r]));
        allRecipes = ids.map(id => byId[id]).filter(Boolean);
        api.reorderRecipes(ids).catch(() => {});
        dragSrc = null;
      });
      card.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!dragSrc || card === dragSrc) return;
        grid.querySelectorAll('.recipe-card').forEach(c => c.classList.remove('drag-over'));
        card.classList.add('drag-over');
        const cards = [...grid.querySelectorAll('.recipe-card[data-id]')];
        const srcIdx = cards.indexOf(dragSrc);
        const dstIdx = cards.indexOf(card);
        if (srcIdx < dstIdx) {
          card.after(dragSrc);
        } else {
          card.before(dragSrc);
        }
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });
    });
  }

  function filter() {
    const q = search.value || '';
    const lq = q.toLowerCase();
    
    let filtered = allRecipes;
    
    if (activeTag === '__favorites__') {
      filtered = filtered.filter(r => r.favorited);
    } else if (activeTag) {
      filtered = filtered.filter(r => (r.tags || []).some(t => t.toLowerCase() === activeTag.toLowerCase()));
    }
    
    if (lq) {
      filtered = filtered.filter(r =>
        r.title.toLowerCase().includes(lq) ||
        (r.description || '').toLowerCase().includes(lq) ||
        (r.tags || []).some(t => t.toLowerCase().includes(lq))
      );
    }
    
    renderGrid(filtered);
  }

  async function loadTags() {
    const container = document.getElementById('tag-filters');
    if (!container) return;
    try {
      const res = await fetch('/api/tags');
      const json = await res.json();
      const tags = json.data.tags || [];
      
      if (tags.length === 0) {
        container.style.display = 'none';
        return;
      }
      
      container.style.display = 'flex';
      container.innerHTML = `
        <button class="tag-filter-btn${!activeTag ? ' active' : ''}" data-tag="">All</button>
        <button class="tag-filter-btn fav-filter-btn${activeTag === '__favorites__' ? ' active' : ''}" data-tag="__favorites__">♥ Favorites</button>
        ${tags.map(t => `
          <button class="tag-filter-btn${activeTag === t ? ' active' : ''}" data-tag="${escHtml(t)}">
            ${escHtml(t)}
          </button>
        `).join('')}
      `;
      
      container.querySelectorAll('.tag-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          activeTag = btn.dataset.tag || null;
          container.querySelectorAll('.tag-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
          filter();
        });
      });
    } catch (err) {
      console.error('Failed to load tags', err);
    }
  }

  // Load
  try {
    allRecipes = await api.listRecipes() || [];
    renderGrid(allRecipes);
    loadTags();
  } catch (e) {
    grid.innerHTML = `<p style="color:#dc2626">Failed to load recipes: ${escHtml(e.message)}</p>`;
  }

  // Search
  search?.addEventListener('input', filter);

  // Dropdown logic
  const dropdown = document.getElementById('add-recipe-dropdown');
  const dropdownBtn = document.getElementById('add-recipe-btn');
  if (dropdown && dropdownBtn) {
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => {
      dropdown.classList.remove('open');
    });
  }

  // Import modal
  importHandler.init();
})();

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
