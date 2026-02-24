// ── Config ─────────────────────────────────────────────────
const API = "https://snipai-backend-production.up.railway.app";
const AUTOSAVE_DELAY = 2000;

// ── State ──────────────────────────────────────────────────
let snippets = [];
let activeId = null;
let viewEditor = null;
let formEditor = null;
let editingId = null;
let autosaveTimer = null;
let isDirty = false;
let aiRunning = false;
let installPrompt = null; // holds the deferred PWA install event

// ── DOM Refs ───────────────────────────────────────────────
const snippetList = document.getElementById("snippetList");
const searchInput = document.getElementById("searchInput");
const langFilter = document.getElementById("langFilter");
const viewPanel = document.getElementById("viewPanel");
const formPanel = document.getElementById("formPanel");
const welcomeMsg = document.getElementById("welcomeMsg");
const snippetDetail = document.getElementById("snippetDetail");
const snippetTitleDisplay = document.getElementById("snippetTitleDisplay");
const toolbarView = document.getElementById("toolbarView");
const toolbarForm = document.getElementById("toolbarForm");
const langBadge = document.getElementById("langBadge");
const snippetDesc = document.getElementById("snippetDesc");
const tagsWrap = document.getElementById("tagsWrap");
const formTitle = document.getElementById("formTitle");
const formLang = document.getElementById("formLang");
const formTags = document.getElementById("formTags");
const formDesc = document.getElementById("formDesc");
const autosaveStatus = document.getElementById("autosaveStatus");
const aiStatus = document.getElementById("aiStatus");
const aiStatusText = document.getElementById("aiStatusText");
const explainPanel = document.getElementById("explainPanel");
const explainText = document.getElementById("explainText");
const toast = document.getElementById("toast");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("sidebarOverlay");

// ── Sidebar ────────────────────────────────────────────────
function openSidebar() {
    sidebar.classList.remove("hidden");
    overlay.classList.add("visible");
}

function closeSidebar() {
    sidebar.classList.add("hidden");
    overlay.classList.remove("visible");
}

function isMobile() {
    return window.innerWidth <= 600;
}

// ── Monaco ─────────────────────────────────────────────────
require.config({
    paths: {
        vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs"
    }
});

function initMonaco(cb) {
    require(["vs/editor/editor.main"], cb);
}

function createEditor(
    containerId,
    value = "",
    language = "javascript",
    readOnly = false
) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    return monaco.editor.create(container, {
        value,
        language,
        theme: "vs-dark",
        readOnly,
        fontSize: 13,
        minimap: { enabled: false },
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        fontFamily: "'Fira Code', 'Cascadia Code', monospace",
        wordWrap: "on"
    });
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, type = "success") {
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.className = "toast";
    }, 2800);
}

// ── Autosave Status ────────────────────────────────────────
function setAutosaveStatus(state) {
    const labels = { saving: "● Saving…", saved: "✓ Saved", error: "✕ Error" };
    autosaveStatus.textContent = labels[state] ?? "";
    autosaveStatus.className = `autosave-status ${state}`;
}

// ── AI Status Bar ──────────────────────────────────────────
function setAiStatus(visible, text = "") {
    aiStatus.style.display = visible ? "flex" : "none";
    aiStatusText.textContent = text;
}

// ── Form Payload ───────────────────────────────────────────
function getFormPayload() {
    return {
        title: formTitle.value.trim(),
        code: formEditor?.getValue() ?? "",
        language: formLang.value,
        tags: formTags.value
            .split(",")
            .map(t => t.trim())
            .filter(Boolean),
        description: formDesc.value.trim()
    };
}

function validatePayload(p) {
    if (!p.title) return "Title is required";
    if (!p.code) return "Code cannot be empty";
    return null;
}

// ── Save ───────────────────────────────────────────────────
async function saveSnippet(silent = false) {
    const payload = getFormPayload();
    const error = validatePayload(payload);

    if (error) {
        if (!silent) showToast(error, "error");
        return false;
    }

    setAutosaveStatus("saving");

    try {
        const res = editingId
            ? await updateSnippet(editingId, payload)
            : await createSnippet(payload);

        if (!res.success) {
            setAutosaveStatus("error");
            if (!silent)
                showToast(res.error ?? "Something went wrong", "error");
            return false;
        }

        if (!editingId) editingId = res.data.id;

        isDirty = false;
        setAutosaveStatus("saved");
        if (!silent) showToast("Snippet saved ✓");

        await loadSnippets();
        return res.data;
    } catch {
        setAutosaveStatus("error");
        if (!silent) showToast("Network error", "error");
        return false;
    }
}

// ── Autosave ───────────────────────────────────────────────
function scheduleAutosave() {
    isDirty = true;
    setAutosaveStatus("saving");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveSnippet(true), AUTOSAVE_DELAY);
}

function attachAutosaveListeners() {
    formTitle.addEventListener("input", scheduleAutosave);
    formTags.addEventListener("input", scheduleAutosave);
    formDesc.addEventListener("input", scheduleAutosave);
}

// ── AI: Analyze → fill form ────────────────────────────────
async function analyzeCode() {
    if (aiRunning) return;

    const code = formEditor?.getValue()?.trim();
    if (!code) {
        showToast("Paste some code first", "error");
        return;
    }

    aiRunning = true;
    const analyzeBtn = document.getElementById("analyzeBtn");
    analyzeBtn.disabled = true;
    setAiStatus(true, "AI is analyzing your code…");
    clearTimeout(autosaveTimer);

    try {
        const res = await fetch(`${API}/ai/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });
        const json = await res.json();

        if (!json.success) {
            showToast(json.error ?? "AI failed", "error");
            return;
        }

        const { language, title, description, tags } = json.data;
        formTitle.value = title;
        formDesc.value = description;
        formTags.value = tags.join(", ");

        if (language) {
            formLang.value = language;
            if (formEditor)
                monaco.editor.setModelLanguage(formEditor.getModel(), language);
        }

        showToast("✦ AI filled the form", "ai");
    } catch {
        showToast("Could not reach AI", "error");
    } finally {
        aiRunning = false;
        analyzeBtn.disabled = false;
        setAiStatus(false);
        scheduleAutosave();
    }
}

// ── AI: Explain snippet ────────────────────────────────────
async function explainSnippet() {
    if (aiRunning) return;

    const s = snippets.find(x => x.id === activeId);
    if (!s) return;

    aiRunning = true;
    const explainBtn = document.getElementById("explainBtn");
    explainBtn.disabled = true;
    explainBtn.textContent = "✦ Thinking…";
    explainPanel.style.display = "none";

    try {
        const res = await fetch(`${API}/ai/explain`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: s.code, language: s.language })
        });
        const json = await res.json();

        if (!json.success) {
            showToast(json.error ?? "AI failed", "error");
            return;
        }

        explainText.textContent = json.data.explanation;
        explainPanel.style.display = "block";
    } catch {
        showToast("Could not reach AI", "error");
    } finally {
        aiRunning = false;
        explainBtn.disabled = false;
        explainBtn.textContent = "✦ Explain";
    }
}

// ── API Calls ──────────────────────────────────────────────
async function fetchSnippets(search = "", lang = "") {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (lang) params.set("lang", lang);
    const res = await fetch(`${API}/snippets?${params}`);
    const json = await res.json();
    return json.data ?? [];
}

async function createSnippet(payload) {
    const res = await fetch(`${API}/snippets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return res.json();
}

async function updateSnippet(id, payload) {
    const res = await fetch(`${API}/snippets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return res.json();
}

async function deleteSnippet(id) {
    const res = await fetch(`${API}/snippets/${id}`, { method: "DELETE" });
    return res.json();
}

// ── Render List ────────────────────────────────────────────
function renderList(data) {
    if (!data.length) {
        snippetList.innerHTML =
            '<li class="empty-state">No snippets found.</li>';
        return;
    }
    snippetList.innerHTML = data
        .map(
            s => `
    <li class="snippet-item ${s.id === activeId ? "active" : ""}" data-id="${
        s.id
    }">
      <div class="item-title">${escHtml(s.title)}</div>
      <div class="item-meta">${s.language} · ${s.tags
          .slice(0, 2)
          .join(", ")}</div>
    </li>
  `
        )
        .join("");

    snippetList.querySelectorAll(".snippet-item").forEach(el => {
        el.addEventListener("click", () => openSnippet(Number(el.dataset.id)));
    });
}

// ── Toolbar / Panel helpers ────────────────────────────────
function showToolbar(mode) {
    toolbarView.style.display = mode === "view" ? "flex" : "none";
    toolbarForm.style.display = mode === "form" ? "flex" : "none";
}

function showPanel(mode) {
    viewPanel.style.display = mode === "view" ? "flex" : "none";
    formPanel.style.display = mode === "form" ? "flex" : "none";
}

// ── Open Snippet ───────────────────────────────────────────
function openSnippet(id) {
    const s = snippets.find(x => x.id === id);
    if (!s) return;

    clearTimeout(autosaveTimer);
    activeId = id;

    showPanel("view");
    showToolbar("view");
    renderList(snippets);

    snippetTitleDisplay.textContent = s.title;
    snippetTitleDisplay.classList.add("active");
    langBadge.textContent = s.language;

    welcomeMsg.style.display = "none";
    snippetDetail.style.display = "flex";
    snippetDesc.textContent = s.description || "";
    explainPanel.style.display = "none";

    tagsWrap.innerHTML = s.tags
        .map(t => `<span class="tag">${escHtml(t)}</span>`)
        .join("");

    if (viewEditor) {
        viewEditor.setValue(s.code);
        monaco.editor.setModelLanguage(viewEditor.getModel(), s.language);
    } else {
        viewEditor = createEditor("viewEditor", s.code, s.language, true);
    }

    if (isMobile()) closeSidebar();
}

// ── Open Form ─────────────────────────────────────────────
function openForm(snippet = null) {
    clearTimeout(autosaveTimer);
    isDirty = false;
    editingId = snippet ? snippet.id : null;

    showPanel("form");
    showToolbar("form");
    setAutosaveStatus("");
    setAiStatus(false);

    snippetTitleDisplay.textContent = snippet ? "Edit Snippet" : "New Snippet";
    snippetTitleDisplay.classList.remove("active");

    formTitle.value = snippet?.title ?? "";
    formLang.value = snippet?.language ?? "javascript";
    formTags.value = snippet?.tags?.join(", ") ?? "";
    formDesc.value = snippet?.description ?? "";

    const code = snippet?.code ?? "";
    const lang = snippet?.language ?? "javascript";

    if (formEditor) {
        formEditor.setValue(code);
        monaco.editor.setModelLanguage(formEditor.getModel(), lang);
    } else {
        formEditor = createEditor("formEditor", code, lang, false);
        formEditor.onDidChangeModelContent(() => scheduleAutosave());
    }

    formLang.onchange = () => {
        if (formEditor) {
            monaco.editor.setModelLanguage(
                formEditor.getModel(),
                formLang.value
            );
            scheduleAutosave();
        }
    };

    if (isMobile()) closeSidebar();
    formTitle.focus();
}

// ── Load Snippets ──────────────────────────────────────────
async function loadSnippets() {
    const search = searchInput.value.trim();
    const lang = langFilter.value;
    snippets = await fetchSnippets(search, lang);
    renderList(snippets);
}

// ── Events ─────────────────────────────────────────────────
document
    .getElementById("newSnippetBtn")
    .addEventListener("click", () => openForm());
document
    .getElementById("welcomeNewBtn")
    .addEventListener("click", () => openForm());

document.getElementById("analyzeBtn").addEventListener("click", analyzeCode);
document.getElementById("explainBtn").addEventListener("click", explainSnippet);

document.getElementById("closeExplainBtn").addEventListener("click", () => {
    explainPanel.style.display = "none";
});

document.getElementById("saveBtn").addEventListener("click", async () => {
    clearTimeout(autosaveTimer);
    const result = await saveSnippet(false);
    if (result) openSnippet(result.id ?? editingId);
});

document.getElementById("cancelBtn").addEventListener("click", () => {
    clearTimeout(autosaveTimer);
    isDirty = false;
    showPanel("view");
    if (activeId) {
        openSnippet(activeId);
    } else {
        showToolbar("none");
        snippetTitleDisplay.textContent = "Select a snippet";
        snippetTitleDisplay.classList.remove("active");
    }
});

document.getElementById("editBtn").addEventListener("click", () => {
    const s = snippets.find(x => x.id === activeId);
    if (s) openForm(s);
});

document.getElementById("copyBtn").addEventListener("click", () => {
    const s = snippets.find(x => x.id === activeId);
    if (!s) return;
    navigator.clipboard
        .writeText(s.code)
        .then(() => showToast("Copied to clipboard ✓"))
        .catch(() => showToast("Copy failed", "error"));
});

document.getElementById("deleteBtn").addEventListener("click", async () => {
    if (!activeId) return;
    const s = snippets.find(x => x.id === activeId);
    if (!confirm(`Delete "${s?.title}"?`)) return;
    const res = await deleteSnippet(activeId);
    if (res.success) {
        activeId = null;
        showToast("Snippet deleted");
        welcomeMsg.style.display = "flex";
        snippetDetail.style.display = "none";
        snippetTitleDisplay.textContent = "Select a snippet";
        snippetTitleDisplay.classList.remove("active");
        showPanel("view");
        showToolbar("none");
        await loadSnippets();
    }
});

// Sidebar
document.getElementById("sidebarToggle").addEventListener("click", () => {
    sidebar.classList.contains("hidden") ? openSidebar() : closeSidebar();
});

overlay.addEventListener("click", () => closeSidebar());

document.addEventListener("keydown", e => {
    if (
        e.key === "Escape" &&
        isMobile() &&
        !sidebar.classList.contains("hidden")
    ) {
        closeSidebar();
    }
});

window.addEventListener("resize", () => {
    if (!isMobile()) {
        sidebar.classList.remove("hidden");
        overlay.classList.remove("visible");
    }
});

window.addEventListener("beforeunload", e => {
    if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
    }
});

// Live search
let searchTimer;
searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadSnippets, 300);
});
langFilter.addEventListener("change", loadSnippets);

// ── PWA Install ────────────────────────────────────────────
// Capture the browser's install prompt before it disappears
window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); // stop the auto mini-bar
    installPrompt = e;

    // Show our custom install button in the sidebar
    const btn = document.getElementById("installBtn");
    if (btn) btn.style.display = "block";
});

// When user taps our install button, trigger the native dialog
document.getElementById("installBtn")?.addEventListener("click", async () => {
    if (!installPrompt) return;

    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;

    if (outcome === "accepted") {
        document.getElementById("installBtn").style.display = "none";
        installPrompt = null;
        showToast("SnipAI installed! ✅");
    }
});

// Hide install button once app is installed
window.addEventListener("appinstalled", () => {
    const btn = document.getElementById("installBtn");
    if (btn) btn.style.display = "none";
    installPrompt = null;
    showToast("SnipAI installed! ✅");
});

// ── Utility ────────────────────────────────────────────────
function escHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ── Init ───────────────────────────────────────────────────
initMonaco(async () => {
    attachAutosaveListeners();
    await loadSnippets();
    if (isMobile()) closeSidebar();
    console.log("SnipAI ready ✅");
});
