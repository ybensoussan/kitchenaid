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

    return `
      <article class="recipe-card" onclick="window.location='/recipe.html?id=${r.id}'">
        <div class="recipe-card-image">
          ${r.image_url
            ? `<img src="${escHtml(r.image_url)}" alt="${escHtml(r.title)}" loading="lazy">`
            : `<span class="recipe-card-image-placeholder">🍽</span>`
          }
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
    }
    if (countEl) countEl.textContent = `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`;
  }

  function filter() {
    const q = search.value || '';
    const lq = q.toLowerCase();
    
    let filtered = allRecipes;
    
    if (activeTag) {
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

  // Import modal
  importHandler.init();
})();

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
