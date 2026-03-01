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
    const tabPhoto     = document.getElementById('tab-photo');
    const tabFile      = document.getElementById('tab-file');
    const modeURL      = document.getElementById('mode-url');
    const modeHTML     = document.getElementById('mode-html');
    const modeText     = document.getElementById('mode-text');
    const modePhoto    = document.getElementById('mode-photo');
    const modeFile     = document.getElementById('mode-file');
    const urlInput     = document.getElementById('import-url');
    const htmlInput    = document.getElementById('import-html');
    const sourceInput  = document.getElementById('import-source-url');
    const textInput    = document.getElementById('import-text-input');
    const parseLocalBtn = document.getElementById('parse-local-btn');
    const parseAIBtn   = document.getElementById('parse-ai-btn');
    const footer       = document.getElementById('import-footer-default');

    if (!overlay) return;

    let mode = 'url'; // 'url' | 'html' | 'text' | 'photo' | 'file'

    function switchTab(next) {
      mode = next;
      modeURL.style.display   = mode === 'url'   ? '' : 'none';
      modeHTML.style.display  = mode === 'html'  ? '' : 'none';
      modeText.style.display  = mode === 'text'  ? '' : 'none';
      modePhoto.style.display = mode === 'photo' ? '' : 'none';
      modeFile.style.display  = mode === 'file'  ? '' : 'none';
      [tabURL, tabHTML, tabText, tabPhoto, tabFile].forEach(t => t?.classList.remove('active'));
      ({ url: tabURL, html: tabHTML, text: tabText, photo: tabPhoto, file: tabFile })[mode]?.classList.add('active');
      // Hide the standard footer Import button when in text, photo, or file mode
      if (footer) footer.style.display = (mode === 'text' || mode === 'photo' || mode === 'file') ? 'none' : '';
      if (mode === 'url')  urlInput?.focus();
      if (mode === 'html') htmlInput?.focus();
      if (mode === 'text') textInput?.focus();
    }

    tabURL?.addEventListener('click',   () => switchTab('url'));
    tabHTML?.addEventListener('click',  () => switchTab('html'));
    tabText?.addEventListener('click',  () => switchTab('text'));
    tabPhoto?.addEventListener('click', () => switchTab('photo'));
    tabFile?.addEventListener('click',  () => switchTab('file'));

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

    // --- Photo tab wiring ---
    const photoFileInput   = document.getElementById('photo-file-input');
    const photoDropzone    = document.getElementById('photo-dropzone');
    const photoPreview     = document.getElementById('photo-preview');
    const photoPlaceholder = document.getElementById('photo-placeholder');
    const photoParseBtn    = document.getElementById('photo-parse-btn');

    let selectedPhotoFile = null;

    function setPhotoFile(file) {
      if (!file) return;
      selectedPhotoFile = file;
      photoPreview.src = URL.createObjectURL(file);
      photoPreview.hidden = false;
      photoPlaceholder.hidden = true;
      photoParseBtn.disabled = false;
    }

    photoFileInput?.addEventListener('change', e => setPhotoFile(e.target.files[0]));

    photoDropzone?.addEventListener('dragover', e => {
      e.preventDefault();
      photoDropzone.classList.add('dragover');
    });
    photoDropzone?.addEventListener('dragleave', () => photoDropzone.classList.remove('dragover'));
    photoDropzone?.addEventListener('drop', e => {
      e.preventDefault();
      photoDropzone.classList.remove('dragover');
      setPhotoFile(e.dataTransfer.files[0]);
    });

    photoParseBtn?.addEventListener('click', async () => {
      if (!selectedPhotoFile) return;
      photoParseBtn.disabled = true;
      photoParseBtn.textContent = 'Parsing…';
      try {
        const formData = new FormData();
        formData.append('image', selectedPhotoFile);
        const resp = await fetch('/api/import/image', { method: 'POST', body: formData });
        const json = await resp.json();
        if (json.error) throw new Error(json.error);
        sessionStorage.setItem('kitchenaid_import', JSON.stringify(json.data));
        window.location.href = '/add.html?source=import';
      } catch (err) {
        showImportToast(err.message, true);
      } finally {
        photoParseBtn.disabled = false;
        photoParseBtn.textContent = 'Parse Recipe';
      }
    });

    // --- Recipe File tab wiring ---
    const recipeFileInput = document.getElementById('recipe-file-input');
    const fileDropzone    = document.getElementById('file-dropzone');
    const fileImportName  = document.getElementById('file-import-name');
    const fileImportBtn   = document.getElementById('file-import-btn');

    let parsedFileData = null;

    function handleRecipeFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.title) throw new Error('Missing title field');
          parsedFileData = data;
          fileImportName.textContent = file.name;
          fileImportName.style.display = '';
          fileImportBtn.disabled = false;
        } catch (err) {
          showImportToast('Invalid recipe file: ' + err.message, true);
          parsedFileData = null;
          fileImportBtn.disabled = true;
        }
      };
      reader.readAsText(file);
    }

    recipeFileInput?.addEventListener('change', e => handleRecipeFile(e.target.files[0]));

    fileDropzone?.addEventListener('dragover', e => {
      e.preventDefault();
      fileDropzone.classList.add('dragover');
    });
    fileDropzone?.addEventListener('dragleave', () => fileDropzone.classList.remove('dragover'));
    fileDropzone?.addEventListener('drop', e => {
      e.preventDefault();
      fileDropzone.classList.remove('dragover');
      handleRecipeFile(e.dataTransfer.files[0]);
    });

    fileImportBtn?.addEventListener('click', () => {
      if (!parsedFileData) return;
      sessionStorage.setItem('kitchenaid_import', JSON.stringify(parsedFileData));
      window.location.href = '/add.html?source=import';
    });
  }

  return { init };
})();
