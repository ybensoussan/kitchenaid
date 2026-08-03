(async () => {
  let items = [];

  function showToast(msg, isError = false) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Strip leading quantity + unit tokens from an ingredient name.
  // e.g. "2 cups flour" → "Flour", "100g chicken" → "Chicken"
  function normalizeName(raw) {
    let s = raw.trim();
    // Remove leading number (including fractions like 1/2) followed by optional unit
    const units = 'cups?|tbsps?|tsps?|tablespoons?|teaspoons?|kg|g|mg|ml|l|oz|lbs?|pounds?|ounces?|pieces?|cans?|cloves?|bunche?s?|slices?|sprigs?|pinch(?:es)?|dashes?|stuks?|stuk';
    s = s.replace(new RegExp(`^[\\d¼½¾⅓⅔⅛⅜⅝⅞][\\d\\s/.]*(${units})\\.?\\s*`, 'i'), '');
    // Remove any remaining leading plain number
    s = s.replace(/^[\d][[\d\s/.]*\s+/, '');
    // Remove parenthetical size info like "(14 oz)"
    s = s.replace(/\s*\([^)]*\)/g, '');
    s = s.trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  let activeFilter = 'all';
  const grid        = document.getElementById('pantry-grid');
  const searchInput = document.getElementById('search-input');

  async function loadItems() {
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state pantry-empty-state" style="grid-column:1/-1">Loading pantry…</div>`;
    }
    try {
      items = await api.listPantryItems();
    } catch (e) {
      showToast('Failed to load pantry: ' + e.message, true);
      items = [];
    }
    renderGrid();
  }

  // Route remote (http/https) image URLs through our caching proxy so they
  // come off local disk on subsequent loads, downscaled to a thumbnail.
  // The v= tag lets us invalidate the browser's immutable HTTP cache when we
  // change proxy logic (e.g. thumbnail size). Bump on proxy behavior changes.
  const IMG_PROXY_V = '2';
  function proxyImg(u) {
    if (!u) return '';
    if (u[0] === '/') return u;
    return '/img?u=' + encodeURIComponent(u) + '&v=' + IMG_PROXY_V;
  }

  // Build the inner HTML of a card (no outer wrapper — dataset lives on the wrapper).
  function cardInner(it) {
    return `<div class="pantry-card-image" title="Change image">
        ${it.image_url
          ? `<img src="${escHtml(proxyImg(it.image_url))}" alt="${escHtml(it.name)}" loading="lazy" decoding="async">`
          : `<span class="pantry-card-img-placeholder"><span class="material-symbols-outlined">grocery</span></span>`
        }
        <button class="pantry-img-btn change-img-btn" title="Change image">
          <span class="material-symbols-outlined">photo_camera</span>
        </button>
      </div>
      <div class="pantry-card-body pantry-item-view">
        <div class="pantry-card-name">${escHtml(it.name)}</div>
        <div class="pantry-card-price">${it.price > 0 ? `€${it.price.toFixed(2)} / ${escHtml(it.price_unit_size)}` : '—'}</div>
        <div class="pantry-card-actions">
          <button class="price-lookup-btn btn btn-ghost btn-icon btn-sm" title="AH Price">€</button>
          <button class="btn btn-ghost btn-icon btn-sm edit-btn" title="Edit"><span class="material-symbols-outlined" style="font-size:0.9rem">edit</span></button>
          <button class="btn btn-ghost btn-icon btn-sm delete-btn" title="Delete" style="color:#dc2626"><span class="material-symbols-outlined" style="font-size:0.9rem">delete</span></button>
        </div>
      </div>
      <div class="pantry-card-edit pantry-item-edit" style="display:none">
        <input type="text" class="form-input edit-name" value="${escHtml(it.name)}" placeholder="Name" style="width:100%;font-size:0.8rem;padding:0.25rem 0.4rem">
        <div style="display:flex;gap:0.3rem;margin-top:0.3rem">
          <input type="number" class="form-input edit-price" value="${it.price > 0 ? it.price : ''}" step="0.01" placeholder="€" style="flex:1;font-size:0.8rem;padding:0.25rem 0.4rem">
          <input type="text" class="form-input edit-price-size" value="${escHtml(it.price_unit_size)}" placeholder="300 g" style="flex:1;font-size:0.8rem;padding:0.25rem 0.4rem">
        </div>
        <div style="display:flex;gap:0.3rem;margin-top:0.3rem">
          <button class="btn btn-primary btn-sm save-edit-btn" style="flex:1;font-size:0.75rem">Save</button>
          <button class="btn btn-secondary btn-sm cancel-edit-btn" style="flex:1;font-size:0.75rem">Cancel</button>
        </div>
      </div>`;
  }

  function buildCard(it) {
    const card = document.createElement('div');
    card.className = 'pantry-card';
    card.dataset.id     = it.id;
    card.dataset.name   = it.name.toLowerCase();
    card.dataset.priced = it.price > 0 ? '1' : '0';
    card.innerHTML = cardInner(it);
    return card;
  }

  function patchCard(card, it) {
    card.dataset.name   = it.name.toLowerCase();
    card.dataset.priced = it.price > 0 ? '1' : '0';
    card.classList.remove('editing');
    card.innerHTML = cardInner(it);
  }

  function renderGrid() {
    if (items.length === 0) {
      grid.innerHTML = `<div class="empty-state pantry-empty-state" style="grid-column:1/-1">No pantry items yet. Add one above.</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const it of items) frag.appendChild(buildCard(it));
    grid.replaceChildren(frag);
    applyVisibility();
  }

  // Filter via display toggling — no DOM rebuild on search keystroke.
  function applyVisibility() {
    const q = (searchInput.value || '').toLowerCase().trim();
    let visible = 0;
    for (const card of grid.children) {
      if (!card.dataset.id) continue;
      let show = !q || card.dataset.name.includes(q);
      if (show && activeFilter === 'unpriced') show = card.dataset.priced === '0';
      else if (show && activeFilter === 'priced') show = card.dataset.priced === '1';
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    }

    let emptyEl = grid.querySelector('.pantry-empty-state');
    if (visible === 0 && items.length > 0) {
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'empty-state pantry-empty-state';
        emptyEl.style.gridColumn = '1/-1';
        grid.appendChild(emptyEl);
      }
      emptyEl.textContent = activeFilter !== 'all'
        ? `No ${activeFilter} items${q ? ' matching your search' : ''}.`
        : 'No results.';
    } else if (emptyEl) {
      emptyEl.remove();
    }
  }

  function insertCardSorted(it) {
    const lower = it.name.toLowerCase();
    const card  = buildCard(it);
    for (const ref of grid.children) {
      if (!ref.dataset.id) continue;
      if (ref.dataset.name > lower) {
        grid.insertBefore(card, ref);
        return card;
      }
    }
    grid.appendChild(card);
    return card;
  }

  function findCard(id) {
    return grid.querySelector(`.pantry-card[data-id="${id}"]`);
  }

  // ── Single delegated click handler for the whole grid ─────────────────────
  grid.addEventListener('click', async (e) => {
    const card = e.target.closest('.pantry-card');
    if (!card) return;
    const id = parseInt(card.dataset.id, 10);
    const item = items.find(it => it.id === id);
    if (!item) return;

    if (e.target.closest('.edit-btn')) {
      card.classList.add('editing');
      card.querySelector('.edit-name')?.focus();
      return;
    }
    if (e.target.closest('.cancel-edit-btn')) {
      const nameEl  = card.querySelector('.edit-name');
      const priceEl = card.querySelector('.edit-price');
      const sizeEl  = card.querySelector('.edit-price-size');
      if (nameEl)  nameEl.value  = item.name;
      if (priceEl) priceEl.value = item.price > 0 ? item.price : '';
      if (sizeEl)  sizeEl.value  = item.price_unit_size;
      card.classList.remove('editing');
      return;
    }
    if (e.target.closest('.save-edit-btn')) {
      const name            = normalizeName(card.querySelector('.edit-name').value);
      const price           = parseFloat(card.querySelector('.edit-price').value) || 0;
      const price_unit_size = card.querySelector('.edit-price-size').value.trim();
      if (!name) { showToast('Name is required', true); return; }
      try {
        const updated = await api.updatePantryItem(id, { name, price, price_unit_size, image_url: item.image_url });
        if (updated) {
          const idx = items.findIndex(i => i.id === id);
          if (idx >= 0) items[idx] = updated;
          patchCard(card, updated);
          applyVisibility();
        }
      } catch (err) {
        showToast('Update failed: ' + err.message, true);
      }
      return;
    }
    if (e.target.closest('.price-lookup-btn')) {
      openAHPicker(id, item.name);
      return;
    }
    if (e.target.closest('.delete-btn')) {
      if (!confirm(`Delete "${item.name}" from pantry?`)) return;
      try {
        await api.deletePantryItem(id);
        const idx = items.findIndex(i => i.id === id);
        if (idx >= 0) items.splice(idx, 1);
        card.remove();
        applyVisibility();
      } catch (err) {
        showToast('Delete failed: ' + err.message, true);
      }
      return;
    }
    if (e.target.closest('.change-img-btn')) {
      e.stopPropagation();
      openImgSearch(id, item.name);
      return;
    }
    // Clicking the name opens the detail modal
    if (e.target.closest('.pantry-card-name')) {
      openPantryDetail(item);
      return;
    }
  });

  // Enter inside edit fields saves.
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.pantry-card.editing');
    if (!card) return;
    if (e.target.matches('.edit-name, .edit-price, .edit-price-size')) {
      e.preventDefault();
      card.querySelector('.save-edit-btn')?.click();
    }
  });

  // ── Add new item ──────────────────────────────────────────────────────────

  document.getElementById('add-btn').addEventListener('click', async () => {
    const nameIn = document.getElementById('new-name');
    const name   = normalizeName(nameIn.value);
    if (!name) { showToast('Name is required', true); nameIn.focus(); return; }
    try {
      const added = await api.createPantryItem({ name });
      nameIn.value = '';
      nameIn.focus();
      if (!added) return;
      const idx = items.findIndex(it => it.id === added.id);
      if (idx >= 0) {
        items[idx] = added;
        const card = findCard(added.id);
        if (card) patchCard(card, added);
      } else {
        let pos = items.findIndex(it => it.name.toLowerCase() > added.name.toLowerCase());
        if (pos === -1) pos = items.length;
        items.splice(pos, 0, added);
        grid.querySelector('.pantry-empty-state')?.remove();
        insertCardSorted(added);
      }
      applyVisibility();
    } catch (e) {
      showToast('Add failed: ' + e.message, true);
    }
  });

  document.getElementById('new-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-btn').click();
  });

  // ── Search (debounced, CSS-based filter — no DOM rebuild) ─────────────────

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(applyVisibility, 40);
  });

  document.getElementById('pantry-filters').addEventListener('click', e => {
    const btn = e.target.closest('.pantry-filter-btn');
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    document.querySelectorAll('.pantry-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyVisibility();
  });

  // ── AH Price Picker ───────────────────────────────────────────────────────

  const ahModal       = document.getElementById('ah-picker-modal');
  const ahPickerName  = document.getElementById('ah-picker-name');
  const ahPickerBody  = document.getElementById('ah-picker-body');
  const ahSearchInput = document.getElementById('ah-search-input');
  const ahSearchBtn   = document.getElementById('ah-search-btn');
  let ahTargetId   = null;
  let ahTargetItem = null;

  ahModal.querySelector('.modal-close').addEventListener('click', () => ahModal.classList.remove('open'));
  ahModal.addEventListener('click', e => { if (e.target === ahModal) ahModal.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ahModal.classList.remove('open'); });

  function setAHResults(html) {
    ahPickerBody.innerHTML = html;
  }

  function renderAHProducts(products) {
    setAHResults(`<div class="ah-product-list">${products.map((p, i) =>
      `<div class="ah-product-item" data-idx="${i}">
        ${p.imageUrl
          ? `<img class="ah-product-thumb" src="${escHtml(p.imageUrl)}" alt="" loading="lazy">`
          : `<div class="ah-product-thumb-placeholder"></div>`}
        <div class="ah-product-info">
          <div class="ah-product-title">${escHtml(p.title)}</div>
          <div class="ah-product-size">${escHtml(p.salesUnitSize)}${p.unitPriceDesc ? ' · ' + escHtml(p.unitPriceDesc) : ''}</div>
        </div>
        <div class="ah-product-price">€${p.price.toFixed(2)}</div>
      </div>`
    ).join('')}</div>`);

    ahPickerBody.querySelectorAll('.ah-product-item').forEach(el => {
      const p = products[parseInt(el.dataset.idx, 10)];
      el.addEventListener('click', async () => {
        ahModal.classList.remove('open');
        try {
          const name = ahTargetItem?.name || '';
          const updated = await api.updatePantryItem(ahTargetId, {
            name,
            price:           p.price,
            price_unit_size: p.salesUnitSize,
            image_url:       ahTargetItem?.image_url || '',
          });
          if (updated) {
            const idx = items.findIndex(i => i.id === ahTargetId);
            if (idx >= 0) items[idx] = updated;
            const card = findCard(ahTargetId);
            if (card) patchCard(card, updated);
            applyVisibility();
          }
          showToast(`Price set: €${p.price.toFixed(2)} / ${p.salesUnitSize}`);
        } catch (e) {
          showToast('Failed to set price: ' + e.message, true);
        }
      });
    });
  }

  async function runAHSearch(q) {
    if (!q) return;
    setAHResults(`<div class="ah-picker-loading"><div class="spinner"></div> Searching AH…</div>`);
    try {
      const data = await api.searchAH(q);
      const products = data.products || [];
      if (products.length === 0) {
        setAHResults(`<p style="padding:1.5rem;color:var(--muted);text-align:center;font-size:.9rem">No results found on AH.</p>`);
      } else {
        renderAHProducts(products);
      }
    } catch (e) {
      setAHResults(`<p style="padding:1.5rem;color:#dc2626;text-align:center;font-size:.9rem">${escHtml(e.message)}</p>`);
    }
  }

  ahSearchBtn.addEventListener('click', () => runAHSearch(ahSearchInput.value.trim()));
  ahSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAHSearch(ahSearchInput.value.trim()); });

  // ── Pantry Detail Modal ───────────────────────────────────────────────────
  const detailModal     = document.getElementById('pantry-detail-modal');
  const detailTitle     = document.getElementById('detail-modal-title');
  const detailImgWrap   = document.getElementById('detail-modal-img-wrap');
  const detailImg       = document.getElementById('detail-modal-img');
  const detailPrice     = document.getElementById('detail-modal-price');
  const detailRecipes   = document.getElementById('detail-modal-recipes');

  document.getElementById('detail-modal-close').addEventListener('click', () => detailModal.classList.remove('open'));
  detailModal.addEventListener('click', e => { if (e.target === detailModal) detailModal.classList.remove('open'); });

  async function openPantryDetail(item) {
    detailTitle.textContent = item.name;
    if (item.image_url) {
      detailImg.src = proxyImg(item.image_url);
      detailImgWrap.style.display = '';
    } else {
      detailImgWrap.style.display = 'none';
    }
    detailPrice.textContent = item.price > 0 ? `€${item.price.toFixed(2)} / ${item.price_unit_size}` : '';
    detailRecipes.innerHTML = '<span style="color:var(--muted);font-size:.85rem">Loading…</span>';
    detailModal.classList.add('open');

    try {
      const recipes = await api.get(`/api/pantry/${item.id}/recipes`);
      if (!recipes || recipes.length === 0) {
        detailRecipes.innerHTML = '<span style="color:var(--muted);font-size:.85rem">Not linked to any recipes yet.</span>';
        return;
      }
      detailRecipes.innerHTML = recipes.map(r => `
        <a href="/recipe.html?id=${r.id}" style="display:flex;align-items:center;gap:.65rem;padding:.5rem .1rem;text-decoration:none;color:var(--text);border-bottom:1px solid var(--border)">
          ${r.image_url
            ? `<img src="${escHtml(proxyImg(r.image_url))}" alt="" style="width:2.5rem;height:2.5rem;object-fit:cover;border-radius:.35rem;flex-shrink:0">`
            : `<div style="width:2.5rem;height:2.5rem;border-radius:.35rem;background:var(--surface-low);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--outline)"><span class="material-symbols-outlined" style="font-size:1rem">skillet</span></div>`}
          <span style="font-size:.875rem;font-weight:600">${escHtml(r.title)}</span>
          <span class="material-symbols-outlined" style="font-size:.9rem;color:var(--muted);margin-left:auto">chevron_right</span>
        </a>`).join('');
    } catch {
      detailRecipes.innerHTML = '<span style="color:var(--muted);font-size:.85rem">Failed to load recipes.</span>';
    }
  }

  async function openAHPicker(itemId, itemName) {
    ahTargetId   = itemId;
    ahTargetItem = items.find(it => it.id === itemId);
    ahPickerName.textContent = itemName;
    ahSearchInput.value = itemName;
    ahModal.classList.add('open');
    ahSearchInput.select();
    await runAHSearch(itemName);
  }

  // ── Image Search ──────────────────────────────────────────────────────────
  const imgModal         = document.getElementById('img-search-modal');
  const imgSearchName    = document.getElementById('img-search-name');
  const imgSearchInput   = document.getElementById('img-search-input');
  const imgSearchBtn     = document.getElementById('img-search-btn');
  const imgSearchResults = document.getElementById('img-search-results');
  let imgTargetId = null;

  document.getElementById('img-search-close').addEventListener('click', () => imgModal.classList.remove('open'));
  imgModal.addEventListener('click', e => { if (e.target === imgModal) imgModal.classList.remove('open'); });

  async function runImgSearch(q) {
    if (!q) return;
    imgSearchResults.innerHTML = `<div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:.5rem;padding:2rem;color:var(--muted)"><div class="spinner"></div> Searching…</div>`;
    try {
      const data = await api.searchImages(q);
      const images = data.images || [];
      if (images.length === 0) {
        imgSearchResults.innerHTML = `<p style="grid-column:1/-1;color:var(--muted);text-align:center;font-size:.9rem">No images found.</p>`;
        return;
      }
      imgSearchResults.innerHTML = images.map((img, i) =>
        `<div class="img-result-thumb" data-idx="${i}" style="cursor:pointer;border-radius:.5rem;overflow:hidden;aspect-ratio:1;background:var(--surface-low)">
          <img src="${escHtml(img.url)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:opacity .15s" onerror="this.parentElement.style.display='none'">
        </div>`
      ).join('');
      imgSearchResults.querySelectorAll('.img-result-thumb').forEach((el, i) => {
        el.addEventListener('click', async () => {
          const url = images[i].url;
          const item = items.find(it => it.id === imgTargetId);
          if (!item) return;
          imgModal.classList.remove('open');
          try {
            const updated = await api.updatePantryItem(imgTargetId, {
              name: item.name,
              price: item.price || 0,
              price_unit_size: item.price_unit_size || '',
              image_url: url,
            });
            if (updated) {
              const idx = items.findIndex(i => i.id === imgTargetId);
              if (idx >= 0) items[idx] = updated;
              const card = findCard(imgTargetId);
              if (card) patchCard(card, updated);
              applyVisibility();
            }
            showToast('Image updated');
          } catch(e) {
            showToast('Failed to update image: ' + e.message, true);
          }
        });
      });
    } catch(e) {
      imgSearchResults.innerHTML = `<p style="grid-column:1/-1;color:#dc2626;text-align:center;font-size:.9rem">${escHtml(e.message)}</p>`;
    }
  }

  imgSearchBtn.addEventListener('click', () => runImgSearch(imgSearchInput.value.trim()));
  imgSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runImgSearch(imgSearchInput.value.trim()); });

  function openImgSearch(itemId, itemName) {
    imgTargetId = itemId;
    imgSearchName.textContent = itemName;
    imgSearchInput.value = itemName;
    imgModal.classList.add('open');
    runImgSearch(itemName);
  }

  // ── Smart Match ───────────────────────────────────────────────────────────

  const smModal  = document.getElementById('smart-match-modal');
  const smBody   = document.getElementById('smart-match-body');
  const smFooter = document.getElementById('smart-match-footer');
  const smApply  = document.getElementById('smart-match-apply');
  const smCancel = document.getElementById('smart-match-cancel');

  document.getElementById('smart-match-close').addEventListener('click', () => smModal.classList.remove('open'));
  smModal.addEventListener('click', e => { if (e.target === smModal) smModal.classList.remove('open'); });
  smCancel.addEventListener('click', () => smModal.classList.remove('open'));

  // State: arrays of enriched match/duplicate objects used when applying
  let _smMatches    = []; // {ingredient, recipe_title, suggestions, selectedPantryId, checked, showSearch, manualId, searchQuery}
  let _smDuplicates = []; // {keep, merge, keep_id, merge_id, reason, confidence, checked, userKeepId}
  let _smAllPantry  = [];

  function smLoading(msg) {
    smFooter.style.display = 'none';
    smBody.innerHTML = `<div style="padding:2rem;display:flex;flex-direction:column;align-items:center;gap:1rem;color:var(--muted)">
      <div class="spinner"></div>
      <div style="font-size:.9rem">${escHtml(msg)}</div>
    </div>`;
  }

  function smError(msg) {
    smBody.innerHTML = `<p style="padding:1.5rem;color:#dc2626;font-size:.9rem">${escHtml(msg)}</p>`;
  }

  async function openSmartMatch() {
    smModal.classList.add('open');
    smLoading('Fetching ingredients and pantry items…');

    let unlinked, pantry;
    try {
      [unlinked, pantry] = await Promise.all([api.getUnlinkedIngredients(), api.listPantryItems()]);
    } catch(e) { smError(e.message); return; }

    _smAllPantry = pantry;

    if (unlinked.length === 0 && pantry.length < 2) {
      smBody.innerHTML = `<p style="padding:1.5rem;color:var(--muted);font-size:.9rem">All ingredients are already linked and no duplicate pantry items found.</p>`;
      return;
    }

    smLoading(`Asking AI to match ${unlinked.length} unlinked ingredient${unlinked.length===1?'':'s'} with ${pantry.length} pantry item${pantry.length===1?'':'s'}…`);

    let result;
    try {
      result = await api.smartMatch({
        ingredients: unlinked.map(i => ({ id: i.id, recipe_id: i.recipe_id, name: i.name, amount: i.amount, unit: i.unit })),
        pantry_items: pantry.map(p => ({ id: p.id, name: p.name })),
      });
    } catch(e) { smError('AI matching failed: ' + e.message); return; }

    const pantryById = new Map(pantry.map(p => [p.id, p]));
    const ingById    = new Map(unlinked.map(i => [i.id, i]));

    _smMatches = (result.matches || [])
      .filter(m => m.suggestions && m.suggestions.length > 0)
      .map(m => {
        const ing = ingById.get(m.ingredient_id);
        if (!ing) return null;
        const suggestions = m.suggestions
          .map(s => ({ ...s, pantry: pantryById.get(s.pantry_item_id) }))
          .filter(s => s.pantry);
        if (!suggestions.length) return null;
        return { ingredient: ing, suggestions, selectedPantryId: suggestions[0].pantry_item_id,
                 checked: true, showSearch: false, manualId: null, searchQuery: '' };
      })
      .filter(Boolean);

    _smDuplicates = (result.duplicates || [])
      .map(d => {
        const keep = pantryById.get(d.keep_id), merge = pantryById.get(d.merge_id);
        if (!keep || !merge) return null;
        return { keep, merge, keep_id: d.keep_id, merge_id: d.merge_id,
                 reason: d.reason, confidence: d.confidence,
                 keepRecipes: d.keep_recipes || [], mergeRecipes: d.merge_recipes || [],
                 checked: d.confidence === 'high', userKeepId: d.keep_id };
      })
      .filter(Boolean);

    renderSmReview();
  }

  function confBadge(c) {
    const cls = c === 'high' ? 'conf-high' : c === 'medium' ? 'conf-medium' : 'conf-low';
    return `<span class="conf-badge ${cls}">${escHtml(c)}</span>`;
  }

  function renderSmReview() {
    if (_smMatches.length === 0 && _smDuplicates.length === 0) {
      smBody.innerHTML = `<p style="padding:1.5rem;color:var(--muted);font-size:.9rem">No matches or duplicates found. Your pantry is already well-organised!</p>`;
      smFooter.style.display = 'none';
      return;
    }

    smBody.innerHTML = '';

    // ── Duplicates section ─────────────────────────────────────────────────
    if (_smDuplicates.length > 0) {
      const sec = document.createElement('div');
      sec.innerHTML = `<div class="sm-section-title">⚠ Possible Pantry Duplicates (${_smDuplicates.length})</div>`;

      _smDuplicates.forEach((d, di) => {
        const row = document.createElement('div');
        row.className = 'sm-row';
        row.style.opacity = d.checked ? '1' : '.55';

        const topLine = document.createElement('div');
        topLine.style.cssText = 'display:flex;align-items:center;gap:.5rem';

        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = d.checked;
        cb.addEventListener('change', () => { d.checked = cb.checked; row.style.opacity = d.checked ? '1' : '.55'; });

        const nameDiv = document.createElement('div');
        nameDiv.className = 'sm-dup-names';
        nameDiv.innerHTML = `<strong>${escHtml(d.keep.name)}</strong><span style="color:var(--muted)">+</span><strong>${escHtml(d.merge.name)}</strong>${confBadge(d.confidence)}`;

        const reason = document.createElement('div');
        reason.style.cssText = 'font-size:.78rem;color:var(--muted);padding-left:1.4rem;margin-bottom:.25rem';
        reason.textContent = d.reason;

        topLine.appendChild(cb);
        topLine.appendChild(nameDiv);

        const keepRow = document.createElement('div');
        keepRow.className = 'sm-dup-keep';
        keepRow.innerHTML = `<span style="color:var(--muted);font-size:.78rem;flex-shrink:0">Keep:</span>`;

        [
          { id: d.keep_id,  name: d.keep.name,  recipes: d.keepRecipes },
          { id: d.merge_id, name: d.merge.name, recipes: d.mergeRecipes },
        ].forEach(opt => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;gap:.1rem';

          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:flex;align-items:center;gap:.3rem;cursor:pointer';
          const radio = document.createElement('input');
          radio.type = 'radio'; radio.name = `dup-keep-${di}`; radio.value = opt.id;
          radio.checked = opt.id === d.userKeepId;
          radio.addEventListener('change', () => { d.userKeepId = opt.id; });
          lbl.appendChild(radio);
          lbl.appendChild(document.createTextNode(opt.name));
          wrap.appendChild(lbl);

          if (opt.recipes.length > 0) {
            const recipeHint = document.createElement('div');
            recipeHint.style.cssText = 'font-size:.72rem;color:var(--muted);padding-left:1.2rem;line-height:1.4';
            recipeHint.textContent = opt.recipes.join(', ');
            wrap.appendChild(recipeHint);
          }

          keepRow.appendChild(wrap);
        });

        row.appendChild(topLine);
        row.appendChild(reason);
        row.appendChild(keepRow);
        sec.appendChild(row);
      });

      smBody.appendChild(sec);
    }

    // ── Ingredient matches section ─────────────────────────────────────────
    if (_smMatches.length > 0) {
      const sec = document.createElement('div');
      sec.innerHTML = `<div class="sm-section-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.3rem"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Ingredient Links (${_smMatches.length})</div>`;

      _smMatches.forEach((m, mi) => {
        const ing = m.ingredient;
        const row = document.createElement('div');
        row.className = 'sm-row';
        row.style.opacity = m.checked ? '1' : '.55';

        // ── Top line: checkbox + ingredient label + re-search button ──────
        const topLine = document.createElement('div');
        topLine.style.cssText = 'display:flex;align-items:flex-start;gap:.5rem';

        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = m.checked; cb.style.marginTop = '.2rem';
        cb.addEventListener('change', () => { m.checked = cb.checked; row.style.opacity = m.checked ? '1' : '.55'; });

        const labelWrap = document.createElement('div');
        labelWrap.style.flex = '1';
        labelWrap.innerHTML = `<div class="sm-ingredient-label">${escHtml([ing.amount && ing.amount > 0 ? ing.amount : '', ing.unit, ing.name].filter(Boolean).join(' '))}</div>
          <div class="sm-recipe-label">${escHtml(ing.recipe_title)}</div>`;

        const reSearchBtn = document.createElement('button');
        reSearchBtn.className = 'btn btn-ghost btn-sm';
        reSearchBtn.style.cssText = 'font-size:.75rem;white-space:nowrap;flex-shrink:0;margin-top:.05rem';
        reSearchBtn.title = 'Re-run AI search for this ingredient';
        reSearchBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.25rem"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>Re-search';

        topLine.appendChild(cb);
        topLine.appendChild(labelWrap);
        topLine.appendChild(reSearchBtn);
        row.appendChild(topLine);

        // ── Radio options ──────────────────────────────────────────────────
        const optList = document.createElement('div');
        optList.className = 'sm-options';
        const radioName = `sm-match-${mi}`;

        // Helper: hide/show extra boxes
        let searchBox, addBox;

        function selectMode(mode) {
          if (searchBox) searchBox.style.display = mode === 'search' ? '' : 'none';
          if (addBox)    addBox.style.display    = mode === 'add'    ? '' : 'none';
        }

        // AI suggestions
        m.suggestions.forEach(s => {
          const opt = document.createElement('label');
          opt.className = 'sm-option';
          const r = document.createElement('input');
          r.type = 'radio'; r.name = radioName; r.value = s.pantry_item_id;
          r.checked = s.pantry_item_id === m.selectedPantryId && !m.showSearch && !m.showAdd;
          r.addEventListener('change', () => {
            m.selectedPantryId = s.pantry_item_id; m.showSearch = false; m.showAdd = false;
            m.manualId = null; selectMode('none');
          });
          opt.appendChild(r);
          opt.innerHTML += `${escHtml(s.pantry.name)} ${confBadge(s.confidence)} <span style="font-size:.75rem;color:var(--muted)">${escHtml(s.reason)}</span>`;
          optList.appendChild(opt);
        });

        // "Search existing pantry" option
        const manualOpt = document.createElement('label');
        manualOpt.className = 'sm-option';
        const manualRadio = document.createElement('input');
        manualRadio.type = 'radio'; manualRadio.name = radioName; manualRadio.value = 'manual';
        manualRadio.checked = m.showSearch;
        manualRadio.addEventListener('change', () => {
          m.showSearch = true; m.showAdd = false; m.selectedPantryId = null; m.manualId = null;
          selectMode('search'); searchInput.focus();
        });
        manualOpt.appendChild(manualRadio);
        manualOpt.appendChild(document.createTextNode('Search existing pantry…'));
        optList.appendChild(manualOpt);

        // "Add new pantry item" option
        const addOpt = document.createElement('label');
        addOpt.className = 'sm-option';
        const addRadio = document.createElement('input');
        addRadio.type = 'radio'; addRadio.name = radioName; addRadio.value = 'add';
        addRadio.checked = m.showAdd;
        addRadio.addEventListener('change', () => {
          m.showAdd = true; m.showSearch = false; m.selectedPantryId = null; m.manualId = null;
          selectMode('add'); addNameInput.focus(); addNameInput.select();
        });
        addOpt.appendChild(addRadio);
        addOpt.appendChild(document.createTextNode('Add new pantry item…'));
        optList.appendChild(addOpt);

        // ── Search box ──────────────────────────────────────────────────────
        searchBox = document.createElement('div');
        searchBox.className = 'sm-search-box';
        searchBox.style.display = m.showSearch ? '' : 'none';

        const searchInput = document.createElement('input');
        searchInput.type = 'text'; searchInput.className = 'form-input';
        searchInput.placeholder = 'Filter pantry items…';
        searchInput.style.cssText = 'font-size:.85rem;padding:.3rem .5rem;width:100%';
        searchInput.value = m.searchQuery;

        const resultsList = document.createElement('ul');
        resultsList.className = 'sm-search-results';

        function renderSearchResults(q) {
          m.searchQuery = q;
          const filtered = _smAllPantry.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
          resultsList.innerHTML = filtered.length
            ? filtered.map(p => `<li class="sm-search-result${m.manualId===p.id?' style="font-weight:600"':''}" data-id="${p.id}">${escHtml(p.name)}</li>`).join('')
            : `<li class="sm-search-result" style="color:var(--muted)">No results</li>`;
          resultsList.querySelectorAll('[data-id]').forEach(li => {
            li.addEventListener('click', () => {
              m.manualId = parseInt(li.dataset.id, 10); m.selectedPantryId = m.manualId;
              searchInput.value = _smAllPantry.find(p => p.id === m.manualId)?.name || '';
              m.searchQuery = searchInput.value;
              renderSearchResults(searchInput.value);
            });
          });
        }

        searchInput.addEventListener('input', e => renderSearchResults(e.target.value));
        if (m.showSearch) renderSearchResults(m.searchQuery);
        searchBox.appendChild(searchInput);
        searchBox.appendChild(resultsList);

        // ── Add new pantry item box ─────────────────────────────────────────
        addBox = document.createElement('div');
        addBox.className = 'sm-search-box';
        addBox.style.display = m.showAdd ? '' : 'none';

        const addNameInput = document.createElement('input');
        addNameInput.type = 'text'; addNameInput.className = 'form-input';
        addNameInput.placeholder = 'Pantry item name';
        addNameInput.style.cssText = 'font-size:.85rem;padding:.3rem .5rem;width:100%';
        addNameInput.value = m.newPantryName !== undefined ? m.newPantryName : ing.name;
        addNameInput.addEventListener('input', () => { m.newPantryName = addNameInput.value; });
        addBox.appendChild(addNameInput);

        // ── Re-search handler ───────────────────────────────────────────────
        reSearchBtn.addEventListener('click', async () => {
          reSearchBtn.disabled = true;
          reSearchBtn.textContent = '…';
          try {
            const result = await api.smartMatch({
              ingredients: [{ id: ing.id, recipe_id: ing.recipe_id, name: ing.name, amount: ing.amount, unit: ing.unit }],
              pantry_items: _smAllPantry.map(p => ({ id: p.id, name: p.name })),
            });
            const pantryById = new Map(_smAllPantry.map(p => [p.id, p]));
            const matchResult = (result.matches || []).find(r => r.ingredient_id === ing.id);
            if (matchResult && matchResult.suggestions.length > 0) {
              m.suggestions = matchResult.suggestions
                .map(s => ({ ...s, pantry: pantryById.get(s.pantry_item_id) }))
                .filter(s => s.pantry);
              m.selectedPantryId = m.suggestions[0]?.pantry_item_id || null;
              m.showSearch = false; m.showAdd = false; m.manualId = null;
            } else {
              m.suggestions = [];
              m.selectedPantryId = null;
            }
            renderSmReview();
          } catch(e) {
            showToast('Re-search failed: ' + e.message, true);
            reSearchBtn.disabled = false;
            reSearchBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:.25rem"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>Re-search';
          }
        });

        row.appendChild(optList);
        row.appendChild(searchBox);
        row.appendChild(addBox);
        sec.appendChild(row);
      });

      smBody.appendChild(sec);
    }

    smFooter.style.display = 'flex';
  }

  smApply.addEventListener('click', async () => {
    smApply.disabled = true;
    let linked = 0, merged = 0, errors = 0;

    try {
      // Apply merges first (dedup)
      for (const d of _smDuplicates) {
        if (!d.checked) continue;
        const keepId  = d.userKeepId;
        const mergeId = keepId === d.keep_id ? d.merge_id : d.keep_id;
        try {
          await api.mergePantryItems(keepId, mergeId);
          merged++;
        } catch(_) { errors++; }
      }

      // Reload pantry after merges (IDs may have changed)
      if (merged > 0) await loadItems();

      // Apply ingredient links (create new pantry items where needed first)
      for (const m of _smMatches) {
        if (!m.checked) continue;
        const ing = m.ingredient;
        try {
          let pantryId = m.selectedPantryId;
          if (m.showAdd) {
            const name = (m.newPantryName || ing.name).trim();
            if (!name) continue;
            const newItem = await api.createPantryItem({ name });
            pantryId = newItem.id;
          }
          if (!pantryId) continue;
          await api.linkIngredientPantry(ing.recipe_id, ing.id, pantryId);
          linked++;
        } catch(_) { errors++; }
      }

      const parts = [];
      if (linked > 0) parts.push(`${linked} ingredient${linked===1?'':'s'} linked`);
      if (merged > 0) parts.push(`${merged} duplicate${merged===1?'':'s'} merged`);
      if (errors > 0) parts.push(`${errors} error${errors===1?'':'s'}`);
      showToast(parts.join(', ') || 'Nothing applied');
      smModal.classList.remove('open');
      if (merged > 0 || linked > 0) await loadItems();
    } catch(e) {
      showToast('Apply failed: ' + e.message, true);
    } finally {
      smApply.disabled = false;
    }
  });

  document.getElementById('smart-match-btn').addEventListener('click', openSmartMatch);

  // ── Price Refresh ─────────────────────────────────────────────────────────

  const priceRefreshModal  = document.getElementById('price-refresh-modal');
  const priceRefreshBody   = document.getElementById('price-refresh-body');
  const priceRefreshFooter = document.getElementById('price-refresh-footer');
  const priceRefreshApply  = document.getElementById('price-refresh-apply');
  const priceRefreshCancel = document.getElementById('price-refresh-cancel');

  document.getElementById('price-refresh-close').addEventListener('click', () => priceRefreshModal.classList.remove('open'));
  priceRefreshModal.addEventListener('click', e => { if (e.target === priceRefreshModal) priceRefreshModal.classList.remove('open'); });
  priceRefreshCancel.addEventListener('click', () => priceRefreshModal.classList.remove('open'));

  let _refreshResults = [];

  function formatPrice(item) {
    if (!item || item.price <= 0) return '—';
    return `€${item.price.toFixed(2)} / ${escHtml(item.price_unit_size || '?')}`;
  }

  function renderRefreshResults(results) {
    _refreshResults = results;

    const ul = document.createElement('ul');
    ul.style.cssText = 'list-style:none;padding:0;margin:0;max-height:460px;overflow-y:auto';

    results.forEach((r, i) => {
      const li = document.createElement('li');
      li.style.cssText = 'border-bottom:1px solid var(--border)';

      if (r.status === 'notfound' || r.status === 'error') {
        li.style.opacity = '.55';
        li.innerHTML = `<div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .75rem">
          <input type="checkbox" disabled style="flex-shrink:0">
          <span style="flex:1;font-size:.9rem;font-weight:500">${escHtml(r.item.name)}</span>
          ${r.status === 'error'
            ? `<span style="font-size:.82rem;color:#dc2626">Error</span>`
            : `<span style="font-size:.82rem;color:var(--muted)">— No match found —</span>
               <button class="btn btn-ghost btn-sm search-↗-btn" style="font-size:.78rem;white-space:nowrap">Search ↗</button>`}
        </div>`;
        if (r.status === 'notfound') {
          li.querySelector('.search-↗-btn').addEventListener('click', () => {
            priceRefreshModal.classList.remove('open');
            openAHPicker(r.item.id, r.item.name);
          });
        }
        ul.appendChild(li);
        return;
      }

      // ── found row ──
      const cur = formatPrice(r.item);

      function productLabel(p) {
        return `€${p.price.toFixed(2)} / ${p.salesUnitSize}`;
      }

      function isChanged() {
        return r.best.price !== r.item.price || r.best.salesUnitSize !== r.item.price_unit_size;
      }

      // Main row
      const mainRow = document.createElement('div');
      mainRow.style.cssText = 'display:flex;align-items:center;gap:.6rem;padding:.55rem .75rem';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'refresh-cb';
      cb.dataset.idx = i;
      cb.checked = true;
      cb.style.flexShrink = '0';

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'flex:1;font-size:.9rem;font-weight:500;min-width:80px';
      nameSpan.textContent = r.item.name;

      const curSpan = document.createElement('span');
      curSpan.style.cssText = 'font-size:.82rem;color:var(--muted);white-space:nowrap';
      curSpan.textContent = cur;

      const arrow = document.createElement('span');
      arrow.style.cssText = 'font-size:.82rem;color:var(--muted)';
      arrow.textContent = '→';

      const selectedProduct = document.createElement('div');
      selectedProduct.style.cssText = 'display:flex;align-items:center;gap:.4rem;min-width:0';

      function renderSelectedProduct() {
        const p = r.best;
        const changed = isChanged();
        selectedProduct.innerHTML = '';
        if (p.imageUrl) {
          const img = document.createElement('img');
          img.src = p.imageUrl;
          img.style.cssText = 'width:28px;height:28px;object-fit:contain;border-radius:3px;flex-shrink:0;background:#f5f5f5';
          img.loading = 'lazy';
          selectedProduct.appendChild(img);
        }
        const info = document.createElement('div');
        info.style.cssText = 'min-width:0';
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:.78rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px';
        titleEl.textContent = p.title;
        const priceEl = document.createElement('div');
        priceEl.style.cssText = `font-size:.82rem;font-weight:600;white-space:nowrap;${changed ? 'color:var(--brand)' : 'color:var(--muted)'}`;
        priceEl.textContent = productLabel(p);
        info.appendChild(titleEl);
        info.appendChild(priceEl);
        selectedProduct.appendChild(info);
      }
      renderSelectedProduct();

      const changeBtn = document.createElement('button');
      changeBtn.className = 'btn btn-ghost btn-sm';
      changeBtn.style.cssText = 'font-size:.78rem;white-space:nowrap;flex-shrink:0';
      changeBtn.textContent = '▾ Change';

      mainRow.appendChild(cb);
      mainRow.appendChild(nameSpan);
      mainRow.appendChild(curSpan);
      mainRow.appendChild(arrow);
      mainRow.appendChild(selectedProduct);
      mainRow.appendChild(changeBtn);

      // Picker sub-row (hidden by default)
      const pickerRow = document.createElement('div');
      pickerRow.style.cssText = 'display:none;flex-direction:column;gap:0;border-top:1px solid var(--border);background:var(--hover-bg, #f9f9f9)';

      r.products.forEach(p => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:.6rem;padding:.4rem .75rem .4rem 2.4rem;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s';
        row.addEventListener('mouseenter', () => row.style.background = 'var(--hover-bg)');
        row.addEventListener('mouseleave', () => row.style.background = '');

        if (p.imageUrl) {
          const img = document.createElement('img');
          img.src = p.imageUrl;
          img.style.cssText = 'width:32px;height:32px;object-fit:contain;border-radius:3px;flex-shrink:0;background:#f5f5f5';
          img.loading = 'lazy';
          row.appendChild(img);
        } else {
          const ph = document.createElement('div');
          ph.style.cssText = 'width:32px;height:32px;flex-shrink:0;background:var(--border);border-radius:3px';
          row.appendChild(ph);
        }

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0';
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        titleEl.textContent = p.title;
        const sizeEl = document.createElement('div');
        sizeEl.style.cssText = 'font-size:.78rem;color:var(--muted)';
        sizeEl.textContent = p.salesUnitSize + (p.unitPriceDesc ? ' · ' + p.unitPriceDesc : '');
        info.appendChild(titleEl);
        info.appendChild(sizeEl);

        const priceEl = document.createElement('div');
        priceEl.style.cssText = 'font-size:.9rem;font-weight:600;color:var(--brand);white-space:nowrap';
        priceEl.textContent = `€${p.price.toFixed(2)}`;

        const tickEl = document.createElement('div');
        tickEl.style.cssText = 'font-size:.9rem;width:1rem;text-align:center;flex-shrink:0';

        function refreshTick() {
          tickEl.textContent = r.best === p ? '✓' : '';
        }
        refreshTick();

        tickEl.dataset.tick = '1';
        row.appendChild(info);
        row.appendChild(priceEl);
        row.appendChild(tickEl);

        row.addEventListener('click', () => {
          r.best = p;
          renderSelectedProduct();
          pickerRow.querySelectorAll('[data-tick]').forEach(el => el.textContent = '');
          tickEl.textContent = '✓';
          pickerRow.style.display = 'none';
          changeBtn.textContent = '▾ Change';
        });

        pickerRow.appendChild(row);
      });

      changeBtn.addEventListener('click', () => {
        const open = pickerRow.style.display !== 'none';
        pickerRow.style.display = open ? 'none' : 'flex';
        pickerRow.style.flexDirection = 'column';
        changeBtn.textContent = open ? '▾ Change' : '▴ Close';
      });

      li.appendChild(mainRow);
      li.appendChild(pickerRow);
      ul.appendChild(li);
    });

    priceRefreshBody.innerHTML = '';
    priceRefreshBody.appendChild(ul);
    priceRefreshFooter.style.display = 'flex';
  }

  async function openPriceRefresh(subset) {
    const target = subset || items;
    if (target.length === 0) { showToast('No items to price'); return; }

    _refreshResults = [];
    priceRefreshFooter.style.display = 'none';
    priceRefreshBody.innerHTML = `<div style="padding:1.5rem;display:flex;flex-direction:column;gap:1rem">
      <div id="refresh-progress-text" style="font-size:.9rem;color:var(--muted)">Preparing…</div>
      <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
        <div id="refresh-progress-bar" style="height:100%;background:var(--brand);width:0%;transition:width .2s"></div>
      </div>
    </div>`;
    priceRefreshModal.classList.add('open');

    const results = [];
    for (let i = 0; i < target.length; i++) {
      const item = target[i];
      const pct  = Math.round((i / target.length) * 100);
      const progressText = document.getElementById('refresh-progress-text');
      const progressBar  = document.getElementById('refresh-progress-bar');
      if (progressText) progressText.textContent = `Searching ${i + 1} / ${target.length}: ${item.name}`;
      if (progressBar)  progressBar.style.width  = pct + '%';

      try {
        const data     = await api.searchAH(item.name);
        const products = data.products || [];
        results.push(products.length
          ? { item, products, best: products[0], status: 'found' }
          : { item, products: [], best: null, status: 'notfound' });
      } catch (_) {
        results.push({ item, products: [], best: null, status: 'error' });
      }
    }

    renderRefreshResults(results);
  }

  priceRefreshApply.addEventListener('click', async () => {
    const toUpdate = [];
    priceRefreshBody.querySelectorAll('.refresh-cb:checked').forEach(cb => {
      const r = _refreshResults[parseInt(cb.dataset.idx, 10)];
      if (r && r.status === 'found') toUpdate.push(r);
    });

    if (toUpdate.length === 0) { showToast('Nothing selected'); return; }

    priceRefreshApply.disabled = true;
    try {
      for (const r of toUpdate) {
        await api.updatePantryItem(r.item.id, {
          name:            r.item.name,
          price:           r.best.price,
          price_unit_size: r.best.salesUnitSize,
          image_url:       r.item.image_url || '',
        });
      }
      await loadItems();
      priceRefreshModal.classList.remove('open');
      showToast(`Updated ${toUpdate.length} item${toUpdate.length === 1 ? '' : 's'}`);
    } catch (e) {
      showToast('Update failed: ' + e.message, true);
    } finally {
      priceRefreshApply.disabled = false;
    }
  });

  document.getElementById('refresh-prices-btn').addEventListener('click', () => openPriceRefresh());
  document.getElementById('refresh-unpriced-btn').addEventListener('click', () => {
    const unpriced = items.filter(it => !(it.price > 0));
    openPriceRefresh(unpriced);
  });

  // ── Find All Images ───────────────────────────────────────────────────────

  document.getElementById('find-all-images-btn').addEventListener('click', async () => {
    const missing = items.filter(it => !it.image_url);
    if (missing.length === 0) { showToast('All items already have images'); return; }

    const btn = document.getElementById('find-all-images-btn');
    btn.disabled = true;

    let done = 0, failed = 0;
    for (const item of missing) {
      btn.textContent = `Finding… ${done + failed + 1}/${missing.length}`;
      try {
        const data = await api.searchImages(item.name);
        const images = (data.images || []).filter(img => img.url);
        if (images.length === 0) { failed++; continue; }
        const url = images[0].url;
        const updated = await api.updatePantryItem(item.id, {
          name: item.name,
          price: item.price || 0,
          price_unit_size: item.price_unit_size || '',
          image_url: url,
        });
        const next = updated || { ...item, image_url: url };
        const idx = items.findIndex(i => i.id === item.id);
        if (idx >= 0) items[idx] = next;
        const card = findCard(item.id);
        if (card) patchCard(card, next);
        done++;
      } catch(_) {
        failed++;
      }
    }

    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle;margin-right:.35rem">image_search</span>Find All Images';
    showToast(`Done: ${done} images found${failed ? `, ${failed} failed` : ''}`);
  });

  // ── Init ─────────────────────────────────────────────────────────────────

  await loadItems();
})();
