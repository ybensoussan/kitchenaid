// URL/HTML/Text import modal handler.

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
    const overlay      = document.getElementById('import-modal');
    const openBtn      = document.getElementById('import-btn');
    const spinner      = document.getElementById('import-spinner');
    const submitBtn    = document.getElementById('import-submit');
    const form         = document.getElementById('import-form');
    const tabURL       = document.getElementById('tab-url');
    const tabHTML      = document.getElementById('tab-html');
    const tabText      = document.getElementById('tab-text');
    const modeURL      = document.getElementById('mode-url');
    const modeHTML     = document.getElementById('mode-html');
    const modeText     = document.getElementById('mode-text');
    const urlInput     = document.getElementById('import-url');
    const htmlInput    = document.getElementById('import-html');
    const sourceInput  = document.getElementById('import-source-url');
    const textInput    = document.getElementById('import-text-input');
    const parseLocalBtn = document.getElementById('parse-local-btn');
    const parseAIBtn   = document.getElementById('parse-ai-btn');
    const footer       = document.getElementById('import-footer-default');

    if (!overlay) return;

    let mode = 'url'; // 'url' | 'html' | 'text'

    function setTabStyle(btn, active) {
      btn.style.borderBottomColor = active ? 'var(--brand)' : 'transparent';
      btn.style.fontWeight = active ? '600' : '';
    }

    function switchTab(next) {
      mode = next;
      modeURL.style.display  = mode === 'url'  ? '' : 'none';
      modeHTML.style.display = mode === 'html' ? '' : 'none';
      modeText.style.display = mode === 'text' ? '' : 'none';
      setTabStyle(tabURL,  mode === 'url');
      setTabStyle(tabHTML, mode === 'html');
      setTabStyle(tabText, mode === 'text');
      // Hide the standard footer Import button when in text mode
      if (footer) footer.style.display = mode === 'text' ? 'none' : '';
      if (mode === 'url')  urlInput?.focus();
      if (mode === 'html') htmlInput?.focus();
      if (mode === 'text') textInput?.focus();
    }

    tabURL?.addEventListener('click',  () => switchTab('url'));
    tabHTML?.addEventListener('click', () => switchTab('html'));
    tabText?.addEventListener('click', () => switchTab('text'));

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
          if (!url) { showImportToast('Enter a URL', true); resetSubmit(); return; }
          data = await api.importURL(url);
        } else {
          const html = htmlInput.value.trim();
          if (!html) { showImportToast('Paste the page HTML', true); resetSubmit(); return; }
          data = await api.importHTML(html, sourceInput.value.trim());
        }
        sessionStorage.setItem('kitchenaid_import', JSON.stringify(data));
        window.location.href = '/add.html?source=import';
      } catch (err) {
        resetSubmit();
        showImportToast('Import failed: ' + err.message, true);
      }
    }

    function resetSubmit() {
      spinner.style.display = 'none';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Import';
    }

    async function doTextParse(method) {
      const text = textInput?.value.trim();
      if (!text) { showImportToast('Paste some recipe text first', true); return; }

      parseLocalBtn.disabled = true;
      parseAIBtn.disabled = true;
      const activeBtn = method === 'ai' ? parseAIBtn : parseLocalBtn;
      const origText = activeBtn.textContent;
      activeBtn.textContent = 'Parsing…';
      spinner.style.display = 'block';

      try {
        const data = await api.importText(text, method);
        sessionStorage.setItem('kitchenaid_import', JSON.stringify(data));
        window.location.href = '/add.html?source=import';
      } catch (err) {
        spinner.style.display = 'none';
        parseLocalBtn.disabled = false;
        parseAIBtn.disabled = false;
        activeBtn.textContent = origText;
        showImportToast('Parse failed: ' + err.message, true);
      }
    }

    submitBtn?.addEventListener('click', doImport);
    parseLocalBtn?.addEventListener('click', () => doTextParse('local'));
    parseAIBtn?.addEventListener('click',   () => doTextParse('ai'));

    // Also trigger on Enter in the URL field
    urlInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doImport(); });
  }

  return { init };
})();
