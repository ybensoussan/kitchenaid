// URL/HTML import modal handler.

const importHandler = (() => {
  function showImportToast(msg, isError = false) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function init() {
    const overlay    = document.getElementById('import-modal');
    const openBtn    = document.getElementById('import-btn');
    const spinner    = document.getElementById('import-spinner');
    const submitBtn  = document.getElementById('import-submit');
    const form       = document.getElementById('import-form');
    const tabURL     = document.getElementById('tab-url');
    const tabHTML    = document.getElementById('tab-html');
    const modeURL    = document.getElementById('mode-url');
    const modeHTML   = document.getElementById('mode-html');
    const urlInput   = document.getElementById('import-url');
    const htmlInput  = document.getElementById('import-html');
    const sourceInput= document.getElementById('import-source-url');

    if (!overlay) return;

    let mode = 'url'; // 'url' | 'html'

    function switchTab(next) {
      mode = next;
      if (mode === 'url') {
        modeURL.style.display = '';
        modeHTML.style.display = 'none';
        tabURL.style.borderBottomColor = 'var(--brand)';
        tabURL.style.fontWeight = '600';
        tabHTML.style.borderBottomColor = 'transparent';
        tabHTML.style.fontWeight = '';
        urlInput?.focus();
      } else {
        modeURL.style.display = 'none';
        modeHTML.style.display = '';
        tabURL.style.borderBottomColor = 'transparent';
        tabURL.style.fontWeight = '';
        tabHTML.style.borderBottomColor = 'var(--brand)';
        tabHTML.style.fontWeight = '600';
        htmlInput?.focus();
      }
    }

    tabURL?.addEventListener('click',  () => switchTab('url'));
    tabHTML?.addEventListener('click', () => switchTab('html'));

    openBtn?.addEventListener('click', () => {
      overlay.classList.add('open');
      switchTab('url');
    });

    // Prevent Enter from submitting the form (would reload the page)
    form?.addEventListener('submit', e => e.preventDefault());

    // Wire all close buttons
    overlay.querySelectorAll('.modal-close').forEach(btn =>
      btn.addEventListener('click', () => overlay.classList.remove('open'))
    );
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

    async function doImport() {
      spinner.style.display = 'block';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing…';

      try {
        let data;
        if (mode === 'url') {
          const url = urlInput.value.trim();
          if (!url) { showImportToast('Enter a URL', true); spinner.style.display = 'none'; submitBtn.disabled = false; submitBtn.textContent = 'Import'; return; }
          data = await api.importURL(url);
        } else {
          const html = htmlInput.value.trim();
          if (!html) { showImportToast('Paste the page HTML', true); spinner.style.display = 'none'; submitBtn.disabled = false; submitBtn.textContent = 'Import'; return; }
          data = await api.importHTML(html, sourceInput.value.trim());
        }
        sessionStorage.setItem('kitchenaid_import', JSON.stringify(data));
        window.location.href = '/add.html?source=import';
      } catch (err) {
        spinner.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Import';
        showImportToast('Import failed: ' + err.message, true);
      }
    }

    submitBtn?.addEventListener('click', doImport);

    // Also trigger on Enter in the URL field
    urlInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doImport(); });
  }

  return { init };
})();
