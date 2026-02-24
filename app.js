// app.js — runs after appwrite.js and monaco are loaded
// All globals: Auth, Snippets, AI, GroqKey are from appwrite.js

// ── State ──────────────────────────────────────────────────
let currentUser    = null;
let snippets       = [];
let activeId       = null;
let viewEditor     = null;
let formEditor     = null;
let editingId      = null;
let autosaveTimer  = null;
let isDirty        = false;
let aiRunning      = false;
let deferredPrompt = null;

// ── DOM (resolved after DOMContentLoaded) ──────────────────
let el = {};

function resolveDOM() {
  const $ = id => document.getElementById(id);
  el = {
    authScreen:          $('authScreen'),
    appShell:            $('appShell'),
    snippetList:         $('snippetList'),
    searchInput:         $('searchInput'),
    langFilter:          $('langFilter'),
    viewPanel:           $('viewPanel'),
    formPanel:           $('formPanel'),
    welcomeMsg:          $('welcomeMsg'),
    snippetDetail:       $('snippetDetail'),
    snippetTitleDisplay: $('snippetTitleDisplay'),
    toolbarView:         $('toolbarView'),
    toolbarForm:         $('toolbarForm'),
    langBadge:           $('langBadge'),
    visibilityBadge:     $('visibilityBadge'),
    snippetDesc:         $('snippetDesc'),
    tagsWrap:            $('tagsWrap'),
    formTitle:           $('formTitle'),
    formLang:            $('formLang'),
    formTags:            $('formTags'),
    formDesc:            $('formDesc'),
    formPublic:          $('formPublic'),
    visibilityHint:      $('visibilityHint'),
    autosaveStatus:      $('autosaveStatus'),
    aiStatus:            $('aiStatus'),
    aiStatusText:        $('aiStatusText'),
    explainPanel:        $('explainPanel'),
    explainText:         $('explainText'),
    toast:               $('toast'),
    sidebar:             $('sidebar'),
    overlay:             $('sidebarOverlay'),
    userBar:             $('userBar'),
    settingsBackdrop:    $('settingsBackdrop'),
  };
}

// ── Utilities ──────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, type = 'success') {
  el.toast.textContent = msg;
  el.toast.className   = `toast show ${type}`;
  setTimeout(() => { el.toast.className = 'toast'; }, 2800);
}

function isMobile() { return window.innerWidth <= 600; }

// ── Auth display ───────────────────────────────────────────
function showApp(user) {
  currentUser = user;
  el.authScreen.style.display = 'none';
  el.appShell.style.display   = 'flex';
  const initials = user.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase();
  el.userBar.innerHTML = `<div class="user-avatar">${initials}</div><span>${escHtml(user.name || user.email)}</span>`;
  GroqKey.load();
}

function showAuth() {
  el.authScreen.style.display = 'flex';
  el.appShell.style.display   = 'none';
  currentUser = null;
}

// ── Auth setup ─────────────────────────────────────────────
// Auth logic lives in auth.js
// This hook is called by auth.js after successful login/register
window.onAuthSuccess = async function(user) {
  showApp(user);
  await loadSnippets();
};

// ── Settings ───────────────────────────────────────────────
function setupSettings() {
  const $ = id => document.getElementById(id);

  $('settingsBtn').addEventListener('click', () => {
    if (!currentUser) return;
    $('settingsUser').textContent = `${currentUser.name || 'User'}  ${currentUser.email}`;
    $('groqKeyInput').value = GroqKey.get();
    updateGroqStatus();
    el.settingsBackdrop.style.display = 'flex';
  });

  $('closeSettings').addEventListener('click', () => {
    el.settingsBackdrop.style.display = 'none';
  });

  el.settingsBackdrop.addEventListener('click', e => {
    if (e.target === el.settingsBackdrop) el.settingsBackdrop.style.display = 'none';
  });

  $('saveGroqKey').addEventListener('click', async () => {
    const key = $('groqKeyInput').value.trim();
    await GroqKey.save(key);
    updateGroqStatus();
    showToast(key ? 'Groq key saved' : 'Groq key cleared', 'ai');
  });

  $('logoutBtn').addEventListener('click', async () => {
    await Auth.logout();
    el.settingsBackdrop.style.display = 'none';
    showAuth();
    snippets = []; activeId = null;
  });
}

function updateGroqStatus() {
  const statusEl = document.getElementById('groqStatus');
  const key = GroqKey.get();
  if (key) { statusEl.textContent = 'AI features enabled'; statusEl.className = 'groq-status ok'; }
  else     { statusEl.textContent = 'No key - AI disabled'; statusEl.className = 'groq-status err'; }
}

// ── Sidebar ────────────────────────────────────────────────
function openSidebar()  { el.sidebar.classList.remove('hidden'); el.overlay.classList.add('visible'); }
function closeSidebar() { el.sidebar.classList.add('hidden');    el.overlay.classList.remove('visible'); }

function setupSidebar() {
  document.getElementById('sidebarToggle').addEventListener('click', () =>
    el.sidebar.classList.contains('hidden') ? openSidebar() : closeSidebar()
  );
  el.overlay.addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => {
    if (!isMobile()) { el.sidebar.classList.remove('hidden'); el.overlay.classList.remove('visible'); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isMobile() && !el.sidebar.classList.contains('hidden')) closeSidebar();
  });
}

// ── Monaco ─────────────────────────────────────────────────
function createEditor(containerId, value = '', language = 'javascript', readOnly = false) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  return monaco.editor.create(container, {
    value, language, theme: 'vs-dark', readOnly,
    fontSize: 13, minimap: { enabled: false }, lineNumbers: 'on',
    scrollBeyondLastLine: false, automaticLayout: true,
    padding: { top: 12, bottom: 12 },
    fontFamily: "'Fira Code','Cascadia Code',monospace", wordWrap: 'on',
  });
}

// ── UI Helpers ─────────────────────────────────────────────
function setAutosaveStatus(state) {
  const labels = { saving: 'Saving...', saved: 'Saved', error: 'Error' };
  el.autosaveStatus.textContent = labels[state] ?? '';
  el.autosaveStatus.className   = `autosave-status ${state}`;
}

function setAiStatus(visible, text = '') {
  el.aiStatus.style.display   = visible ? 'flex' : 'none';
  el.aiStatusText.textContent = text;
}

function showToolbar(mode) {
  el.toolbarView.style.display = mode === 'view' ? 'flex' : 'none';
  el.toolbarForm.style.display = mode === 'form' ? 'flex' : 'none';
}

function showPanel(mode) {
  el.viewPanel.style.display = mode === 'view' ? 'flex' : 'none';
  el.formPanel.style.display = mode === 'form' ? 'flex' : 'none';
}

// ── Snippet Actions ────────────────────────────────────────
function getFormPayload() {
  return {
    title:       el.formTitle.value.trim(),
    code:        formEditor?.getValue() ?? '',
    language:    el.formLang.value,
    tags:        el.formTags.value.split(',').map(t => t.trim()).filter(Boolean),
    description: el.formDesc.value.trim(),
    isPublic:    el.formPublic.checked,
  };
}

async function saveSnippet(silent = false) {
  const payload = getFormPayload();
  if (!payload.title) { if (!silent) showToast('Title is required', 'error'); return false; }
  if (!payload.code)  { if (!silent) showToast('Code cannot be empty', 'error'); return false; }

  setAutosaveStatus('saving');
  try {
    let result;
    if (editingId) {
      result = await Snippets.update(editingId, currentUser.$id, payload);
    } else {
      result = await Snippets.create(currentUser.$id, payload);
      editingId = result.id;
    }
    isDirty = false;
    setAutosaveStatus('saved');
    if (!silent) showToast('Snippet saved');
    await loadSnippets();
    return result;
  } catch {
    setAutosaveStatus('error');
    if (!silent) showToast('Save failed', 'error');
    return false;
  }
}

function scheduleAutosave() {
  isDirty = true;
  setAutosaveStatus('saving');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveSnippet(true), 2000);
}

async function analyzeCode() {
  if (aiRunning) return;
  const code = formEditor?.getValue()?.trim();
  if (!code) { showToast('Paste some code first', 'error'); return; }
  if (!GroqKey.get()) {
    showToast('Add your Groq key in Settings', 'error');
    document.getElementById('settingsBtn').click();
    return;
  }
  aiRunning = true;
  document.getElementById('analyzeBtn').disabled = true;
  setAiStatus(true, 'AI is analyzing your code...');
  clearTimeout(autosaveTimer);
  try {
    const data = await AI.analyze(code);
    el.formTitle.value = data.title;
    el.formDesc.value  = data.description;
    el.formTags.value  = data.tags.join(', ');
    if (data.language) {
      el.formLang.value = data.language;
      if (formEditor) monaco.editor.setModelLanguage(formEditor.getModel(), data.language);
    }
    showToast('AI filled the form', 'ai');
  } catch (e) {
    if (e.message === 'NO_KEY') { showToast('Add Groq key in Settings', 'error'); document.getElementById('settingsBtn').click(); }
    else if (e.message === 'INVALID_KEY') showToast('Invalid Groq key', 'error');
    else showToast('AI request failed', 'error');
  } finally {
    aiRunning = false;
    document.getElementById('analyzeBtn').disabled = false;
    setAiStatus(false);
    scheduleAutosave();
  }
}

async function explainSnippet() {
  if (aiRunning) return;
  const s = snippets.find(x => x.id === activeId);
  if (!s) return;
  if (!GroqKey.get()) {
    showToast('Add your Groq key in Settings', 'error');
    document.getElementById('settingsBtn').click();
    return;
  }
  aiRunning = true;
  const btn = document.getElementById('explainBtn');
  btn.disabled = true; btn.textContent = 'Thinking...';
  el.explainPanel.style.display = 'none';
  try {
    const explanation = await AI.explain(s.code, s.language);
    el.explainText.textContent    = explanation;
    el.explainPanel.style.display = 'block';
  } catch (e) {
    if (e.message === 'INVALID_KEY') showToast('Invalid Groq key', 'error');
    else showToast('AI request failed', 'error');
  } finally {
    aiRunning = false;
    btn.disabled = false; btn.textContent = 'Explain';
  }
}

async function loadSnippets() {
  if (!currentUser) return;
  try {
    snippets = await Snippets.list(currentUser.$id, {
      search:   el.searchInput.value.trim(),
      language: el.langFilter.value,
    });
    renderList(snippets);
  } catch { showToast('Failed to load snippets', 'error'); }
}

function renderList(data) {
  if (!data.length) {
    el.snippetList.innerHTML = '<li class="empty-state">No snippets yet. Create one!</li>';
    return;
  }
  el.snippetList.innerHTML = data.map(s => `
    <li class="snippet-item ${s.id === activeId ? 'active' : ''}" data-id="${s.id}">
      <div class="item-title">${escHtml(s.title)}</div>
      <div class="item-meta">
        ${escHtml(s.language)}
        ${s.isPublic ? '<span class="item-public-badge">PUBLIC</span>' : ''}
      </div>
    </li>
  `).join('');
  el.snippetList.querySelectorAll('.snippet-item').forEach(item => {
    item.addEventListener('click', () => openSnippet(item.dataset.id));
  });
}

function openSnippet(id) {
  const s = snippets.find(x => x.id === id);
  if (!s) return;
  clearTimeout(autosaveTimer);
  activeId = id;
  showPanel('view'); showToolbar('view');
  renderList(snippets);

  el.snippetTitleDisplay.textContent = s.title;
  el.snippetTitleDisplay.classList.add('active');
  el.langBadge.textContent = s.language;
  el.visibilityBadge.textContent = s.isPublic ? 'Public' : 'Private';
  el.visibilityBadge.className   = `visibility-badge ${s.isPublic ? 'public' : 'private'}`;

  el.welcomeMsg.style.display    = 'none';
  el.snippetDetail.style.display = 'flex';
  el.snippetDesc.textContent     = s.description || '';
  el.explainPanel.style.display  = 'none';

  el.tagsWrap.innerHTML = s.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('');

  if (viewEditor) {
    viewEditor.setValue(s.code);
    monaco.editor.setModelLanguage(viewEditor.getModel(), s.language);
  } else {
    viewEditor = createEditor('viewEditor', s.code, s.language, true);
  }

  if (isMobile()) closeSidebar();
}

function openForm(snippet = null) {
  clearTimeout(autosaveTimer);
  isDirty = false;
  editingId = snippet ? snippet.id : null;
  showPanel('form'); showToolbar('form');
  setAutosaveStatus(''); setAiStatus(false);

  el.snippetTitleDisplay.textContent = snippet ? 'Edit Snippet' : 'New Snippet';
  el.snippetTitleDisplay.classList.remove('active');

  el.formTitle.value    = snippet?.title            ?? '';
  el.formLang.value     = snippet?.language         ?? 'javascript';
  el.formTags.value     = snippet?.tags?.join(', ') ?? '';
  el.formDesc.value     = snippet?.description      ?? '';
  el.formPublic.checked = snippet?.isPublic         ?? false;
  el.visibilityHint.textContent = el.formPublic.checked
    ? 'Anyone with the link can view this'
    : 'Only you can see this snippet';

  const code = snippet?.code     ?? '';
  const lang = snippet?.language ?? 'javascript';

  if (formEditor) {
    formEditor.setValue(code);
    monaco.editor.setModelLanguage(formEditor.getModel(), lang);
  } else {
    formEditor = createEditor('formEditor', code, lang, false);
    formEditor.onDidChangeModelContent(() => scheduleAutosave());
  }

  el.formLang.onchange = () => {
    if (formEditor) {
      monaco.editor.setModelLanguage(formEditor.getModel(), el.formLang.value);
      scheduleAutosave();
    }
  };

  if (isMobile()) closeSidebar();
  el.formTitle.focus();
}

// ── Wire up all app events ─────────────────────────────────
function setupAppEvents() {
  const $ = id => document.getElementById(id);

  el.formPublic.addEventListener('change', () => {
    el.visibilityHint.textContent = el.formPublic.checked
      ? 'Anyone with the link can view this'
      : 'Only you can see this snippet';
    if (editingId) scheduleAutosave();
  });

  $('newSnippetBtn').addEventListener('click', () => openForm());
  $('welcomeNewBtn').addEventListener('click', () => openForm());
  $('analyzeBtn').addEventListener('click', analyzeCode);
  $('explainBtn').addEventListener('click', explainSnippet);
  $('closeExplainBtn').addEventListener('click', () => { el.explainPanel.style.display = 'none'; });

  $('saveBtn').addEventListener('click', async () => {
    clearTimeout(autosaveTimer);
    const result = await saveSnippet(false);
    if (result) openSnippet(result.id ?? editingId);
  });

  $('cancelBtn').addEventListener('click', () => {
    clearTimeout(autosaveTimer);
    isDirty = false;
    showPanel('view');
    if (activeId) { openSnippet(activeId); }
    else {
      showToolbar('none');
      el.snippetTitleDisplay.textContent = 'Select a snippet';
      el.snippetTitleDisplay.classList.remove('active');
    }
  });

  $('editBtn').addEventListener('click', () => {
    const s = snippets.find(x => x.id === activeId);
    if (s) openForm(s);
  });

  $('copyBtn').addEventListener('click', () => {
    const s = snippets.find(x => x.id === activeId);
    if (!s) return;
    navigator.clipboard.writeText(s.code)
      .then(() => showToast('Copied to clipboard'))
      .catch(() => showToast('Copy failed', 'error'));
  });

  $('deleteBtn').addEventListener('click', async () => {
    if (!activeId) return;
    const s = snippets.find(x => x.id === activeId);
    if (!confirm(`Delete "${s?.title}"?`)) return;
    try {
      await Snippets.delete(activeId);
      activeId = null;
      showToast('Snippet deleted');
      el.welcomeMsg.style.display    = 'flex';
      el.snippetDetail.style.display = 'none';
      el.snippetTitleDisplay.textContent = 'Select a snippet';
      el.snippetTitleDisplay.classList.remove('active');
      showPanel('view'); showToolbar('none');
      await loadSnippets();
    } catch { showToast('Delete failed', 'error'); }
  });

  window.addEventListener('beforeunload', e => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } });

  let searchTimer;
  el.searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadSnippets, 300); });
  el.langFilter.addEventListener('change', loadSnippets);

  // Autosave listeners on text inputs
  el.formTitle.addEventListener('input', scheduleAutosave);
  el.formTags.addEventListener('input',  scheduleAutosave);
  el.formDesc.addEventListener('input',  scheduleAutosave);
}

// ── PWA install button ─────────────────────────────────────
function setupPWA() {
  const style = document.createElement('style');
  style.textContent = `
    #snipai-install-btn {
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:linear-gradient(135deg,#7c6af7,#a78bfa); color:#fff; border:none;
      padding:12px 28px; border-radius:50px; font-size:14px; font-weight:600;
      cursor:pointer; box-shadow:0 4px 20px rgba(124,106,247,.4);
      z-index:998; touch-action:manipulation; white-space:nowrap;
    }
  `;
  document.head.appendChild(style);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (document.getElementById('snipai-install-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'snipai-install-btn'; btn.textContent = 'Install SnipAI';
    document.body.appendChild(btn);
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') { btn.remove(); deferredPrompt = null; }
    });
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('snipai-install-btn')?.remove();
  });
}

// ── Entry point ────────────────────────────────────────────
// Called from index.html after Monaco and Appwrite SDK are loaded
window.initApp = function() {
  resolveDOM();
  if (typeof setupAuth === 'function') setupAuth(); // from auth.js
  setupSettings();
  setupSidebar();
  setupAppEvents();
  setupPWA();

  require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
  require(['vs/editor/editor.main'], async () => {

  // Handle OAuth redirect (Google/GitHub redirect back to app)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('oauth') === 'success') {
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    // getUser will pick up the session Appwrite set via cookie
  }

    // Try cached user immediately for instant UI
    const cached = Auth.getCachedUser();
    if (cached) {
      showApp(cached);
      loadSnippets();
    } else {
      showAuth();
    }
    // Verify session with Appwrite in background
    const user = await Auth.getUser();
    if (user) {
      if (!cached) { showApp(user); await loadSnippets(); }
    } else {
      showAuth();
    }
    if (isMobile()) closeSidebar();
    console.log('SnipAI ready');
  });
};