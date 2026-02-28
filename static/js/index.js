// Main page: load recipes, render grid, wire search + import.

(async () => {
  const grid    = document.getElementById('recipe-grid');
  const search  = document.getElementById('search-input');
  const countEl = document.getElementById('recipe-count');

  let allRecipes = [];

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
          <h2>No recipes yet</h2>
          <p>Add your first recipe or import one from a URL.</p>
          <a href="/add.html" class="btn btn-primary">+ Add Recipe</a>
        </div>`;
    } else {
      grid.innerHTML = recipes.map(renderCard).join('');
    }
    if (countEl) countEl.textContent = `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`;
  }

  function filter(q) {
    if (!q) return allRecipes;
    const lq = q.toLowerCase();
    return allRecipes.filter(r =>
      r.title.toLowerCase().includes(lq) ||
      r.description.toLowerCase().includes(lq)
    );
  }

  // Load
  try {
    allRecipes = await api.listRecipes() || [];
    renderGrid(allRecipes);
  } catch (e) {
    grid.innerHTML = `<p style="color:#dc2626">Failed to load recipes: ${escHtml(e.message)}</p>`;
  }

  // Search
  search?.addEventListener('input', () => renderGrid(filter(search.value)));

  // Import modal
  importHandler.init();
})();

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
