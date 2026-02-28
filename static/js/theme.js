// Theme (dark/light) toggle. Load in <head> to avoid flash.
(function () {
  const KEY = 'kitchenaid_theme';
  const saved = localStorage.getItem(KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  function applyTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const cb = document.getElementById('theme-toggle-btn');
    if (cb) cb.checked = dark;
  }

  function toggle() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem(KEY, 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem(KEY, 'dark');
    }
    applyTheme();
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle-btn')
      ?.addEventListener('change', toggle);
  });
})();
