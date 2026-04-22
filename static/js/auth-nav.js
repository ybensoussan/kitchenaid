(async () => {
  try {
    const res = await fetch('/api/auth/me');

    if (res.status === 401) {
      // Check whether auth is actually enabled before redirecting
      const cfgRes = await fetch('/api/auth/config');
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()).data;
        if (cfg && cfg.enabled) {
          window.location.replace('/login.html?next=' + encodeURIComponent(window.location.pathname));
        }
      }
      return;
    }

    if (!res.ok) return;

    const me = (await res.json()).data;
    if (!me) return;

    const actions = document.querySelector('.editorial-topnav-actions');
    if (!actions) return;

    const name = document.createElement('span');
    name.style.cssText = 'font-size:0.8rem;color:var(--muted);margin-right:0.15rem;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = me.display_name || me.email;

    const btn = document.createElement('button');
    btn.className = 'editorial-icon-btn';
    btn.title = 'Sign out';
    btn.innerHTML = '<span class="material-symbols-outlined">logout</span>';
    btn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });

    actions.prepend(btn);
    actions.prepend(name);
  } catch {}
})();
