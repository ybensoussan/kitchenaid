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
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.textContent = dark ? '☀' : '🌙';
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
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
      ?.addEventListener('click', toggle);
  });
})();
