// Thin fetch wrapper. All methods return parsed data or throw on error.

const api = {
  async _fetch(method, path, body) {
    const opts = {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);
    const json = await res.json();

    if (json.error) throw new Error(json.error);
    return json.data;
  },

  get:    (path)        => api._fetch('GET',    path),
  post:   (path, body)  => api._fetch('POST',   path, body),
  put:    (path, body)  => api._fetch('PUT',    path, body),
  patch:  (path, body)  => api._fetch('PATCH',  path, body),
  delete: (path)        => api._fetch('DELETE', path),

  // Recipes
  listRecipes:   ()         => api.get('/api/recipes'),
  getRecipe:     (id)       => api.get(`/api/recipes/${id}`),
  createRecipe:  (data)     => api.post('/api/recipes', data),
  updateRecipe:  (id, data) => api.put(`/api/recipes/${id}`, data),
  patchRecipe:   (id, field, value) => api.patch(`/api/recipes/${id}`, { field, value }),
  deleteRecipe:  (id)       => api.delete(`/api/recipes/${id}`),
  setFavorited:  (id, val)  => api.patch(`/api/recipes/${id}`, { field: 'favorited', value: val ? 1 : 0 }),
  reorderRecipes: (ids)     => api.put('/api/recipes/reorder', { ids }),

  // Ingredients
  addIngredient:    (rid, data)       => api.post(`/api/recipes/${rid}/ingredients`, data),
  updateIngredient: (rid, iid, data)  => api.put(`/api/recipes/${rid}/ingredients/${iid}`, data),
  deleteIngredient: (rid, iid)        => api.delete(`/api/recipes/${rid}/ingredients/${iid}`),
  reorderIngredients: (rid, ids)      => api.put(`/api/recipes/${rid}/ingredients/reorder`, { ids }),

  // Steps
  addStep:    (rid, data)      => api.post(`/api/recipes/${rid}/steps`, data),
  updateStep: (rid, sid, data) => api.put(`/api/recipes/${rid}/steps/${sid}`, data),
  deleteStep: (rid, sid)       => api.delete(`/api/recipes/${rid}/steps/${sid}`),

  // Upload
  async upload(file) {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.data;
  },

  // Import
  importURL:  (url)             => api.post('/api/import/url',  { url }),
  importHTML: (html, sourceURL) => api.post('/api/import/html', { html, source_url: sourceURL }),
  importText: (text, method)    => api.post('/api/import/text', { text, method }),

  // Images
  searchImages: (q) => api.get(`/api/images/search?q=${encodeURIComponent(q)}`),

  // Alternatives
  findAlternatives: (data) => api.post('/api/alternatives', data),

  // Models
  listModels: () => api.get('/api/models'),

  // Tags
  listTags:      ()          => api.get('/api/tags'),
  addRecipeTag:  (rid, name) => api.post(`/api/recipes/${rid}/tags`, { name }),
  removeRecipeTag: (rid, name) => api.delete(`/api/recipes/${rid}/tags/${encodeURIComponent(name)}`),
  suggestTags:   (rid)       => api.post(`/api/recipes/${rid}/tags/suggest`),

  // Pantry
  listPantryItems:    ()             => api.get('/api/pantry'),
  createPantryItem:   (data)         => api.post('/api/pantry', data),
  updatePantryItem:   (id, data)     => api.put(`/api/pantry/${id}`, data),
  deletePantryItem:   (id)           => api.delete(`/api/pantry/${id}`),
  batchAddPantryItems: (items)       => api.post('/api/pantry/batch', items),

  // AH price lookup
  searchAH: (q) => api.get(`/api/ah/search?q=${encodeURIComponent(q)}`),
};
