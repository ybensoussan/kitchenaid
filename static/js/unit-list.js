// Centralized unit list. Stored in localStorage so users can customize it.
// Used by pantry.html, recipe.html, and add.html to populate unit <select>s.

const unitList = (() => {
  const KEY = 'kitchenaid_unit_list';

  const DEFAULTS = [
    'g', 'kg', 'mg',
    'ml', 'l',
    'oz', 'fl oz', 'lb',
    'cup', 'tsp', 'tbsp',
    '°C', '°F',
    'piece', 'bunch', 'clove', 'slice', 'can', 'sprig',
    'pinch', 'dash',
  ];

  function get() {
    try {
      const stored = localStorage.getItem(KEY);
      return stored ? JSON.parse(stored) : [...DEFAULTS];
    } catch (_) {
      return [...DEFAULTS];
    }
  }

  function _save(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    document.dispatchEvent(new CustomEvent('unitListChanged', { detail: { units: list } }));
  }

  function add(unit) {
    const u = unit.trim();
    if (!u) return false;
    const list = get();
    if (list.includes(u)) return false;
    list.push(u);
    _save(list);
    return true;
  }

  function remove(unit) {
    _save(get().filter(u => u !== unit));
  }

  function reset() {
    _save([...DEFAULTS]);
  }

  // Populate a <select> element with the current unit list.
  // Preserves `selected` value (even if it's not in the list).
  function populateSelect(el, selected = '') {
    const list = get();
    // If the current value isn't in the list, keep it as an extra option
    const extra = selected && !list.includes(selected) ? selected : null;
    el.innerHTML =
      '<option value="">—</option>' +
      (extra ? `<option value="${extra}" selected>${extra}</option>` : '') +
      list.map(u =>
        `<option value="${u}"${u === selected ? ' selected' : ''}>${u}</option>`
      ).join('');
  }

  return { get, add, remove, reset, populateSelect, DEFAULTS };
})();
