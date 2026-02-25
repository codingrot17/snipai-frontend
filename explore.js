// ── explore.js — Public Snippet Feed ──────────────────────
// Depends on: Appwrite globals (databases, Query, DATABASE_ID, COLLECTION_ID)
// and escHtml() from app.js

const LANG_META = {
    javascript: { color: "#f7df1e", label: "JS" },
    typescript: { color: "#3178c6", label: "TS" },
    python: { color: "#4584b6", label: "PY" },
    html: { color: "#e34c26", label: "HTML" },
    css: { color: "#a259ff", label: "CSS" },
    json: { color: "#6b7280", label: "JSON" },
    bash: { color: "#22c55e", label: "SH" },
    sql: { color: "#f59e0b", label: "SQL" },
    plaintext: { color: "#9ca3af", label: "TXT" }
};

// ── Appwrite query ─────────────────────────────────────────
async function fetchPublicSnippets({
    language = "",
    offset = 0,
    limit = 18
} = {}) {
    const q = [
        Query.equal("isPublic", true),
        Query.orderDesc("$createdAt"),
        Query.limit(limit),
        Query.offset(offset)
    ];
    if (language) q.push(Query.equal("language", language));
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, q);
    return {
        items: res.documents.map(d => ({
            id: d.$id,
            title: d.title,
            code: d.code,
            language: d.language || "plaintext",
            tags: d.tags ? d.tags.split(",").filter(Boolean) : [],
            description: d.description || "",
            authorId: d.authorId || "",
            authorName: d.authorName || "",
            createdAt: d.$createdAt
        })),
        hasMore: res.documents.length === limit
    };
}

// ── Card builder ───────────────────────────────────────────
function buildCard(s, index) {
    const meta = LANG_META[s.language] || LANG_META.plaintext;
    const lines = s.code.split("\n").slice(0, 10).join("\n");
    const preview =
        escHtml(lines) + (s.code.split("\n").length > 10 ? "\n…" : "");
    const date = new Date(s.createdAt).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
    const tags = s.tags
        .slice(0, 3)
        .map(t => `<span class="ex-tag">${escHtml(t)}</span>`)
        .join("");

    // Generate avatar color from authorId
    let hue = 200;
    for (let i = 0; i < s.authorId.length; i++)
        hue = (hue + s.authorId.charCodeAt(i) * 7) % 360;
    const avatarBg = `hsl(${hue},55%,42%)`;
    const initials = s.authorName
        ? s.authorName
              .split(" ")
              .map(w => w[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)
        : s.authorId.slice(0, 2).toUpperCase() || "??";

    const displayName = s.authorName
        ? escHtml(s.authorName)
        : escHtml(s.authorId.slice(0, 12) + "…");

    return `
<article class="ex-card" data-id="${s.id}" style="animation-delay:${
        index * 40
    }ms">
  <div class="ex-card-accent" style="background:${meta.color}"></div>
  <div class="ex-card-inner">

    <div class="ex-card-top">
      <div class="ex-lang-pill" style="color:${meta.color};border-color:${
          meta.color
      }33;background:${meta.color}11">
        ${meta.label}
      </div>
      <button class="ex-copy-btn" data-code="${s.code
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;")}" title="Copy">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      </button>
    </div>

    <h3 class="ex-card-title">${escHtml(s.title)}</h3>
    ${
        s.description
            ? `<p class="ex-card-desc">${escHtml(s.description)}</p>`
            : ""
    }

    <pre class="ex-code"><code>${preview}</code></pre>

    <div class="ex-card-footer">
      <div class="ex-author">
        <div class="ex-avatar" style="background:${avatarBg}">${initials}</div>
        <span class="ex-author-name">${displayName}</span>
      </div>
      <div class="ex-footer-right">
        ${tags}
        <span class="ex-date">${date}</span>
      </div>
    </div>

  </div>
</article>`;
}

// ── Feed state ─────────────────────────────────────────────
let exPage = 0;
let exFilter = "";
let exLoading = false;
let exHasMore = true;

async function loadFeed(append = false) {
    if (exLoading) return;
    exLoading = true;

    const grid = document.getElementById("exploreGrid");
    const loader = document.getElementById("exploreLoader");
    const moreBtn = document.getElementById("exploreMore");

    if (loader) loader.style.display = "flex";
    if (moreBtn) moreBtn.disabled = true;

    try {
        const { items, hasMore } = await fetchPublicSnippets({
            language: exFilter,
            offset: exPage * 18
        });

        if (!append) grid.innerHTML = "";

        if (!append && items.length === 0) {
            grid.innerHTML = `
        <div class="ex-empty">
          <div class="ex-empty-icon">🌐</div>
          <p class="ex-empty-title">No public snippets yet</p>
          <p class="ex-empty-sub">Toggle a snippet to "Public" to share it here</p>
        </div>`;
        } else {
            const startIndex = append ? exPage * 18 : 0;
            items.forEach((s, i) => {
                grid.insertAdjacentHTML(
                    "beforeend",
                    buildCard(s, startIndex + i)
                );
            });
        }

        exHasMore = hasMore;
        if (moreBtn) moreBtn.style.display = hasMore ? "block" : "none";
    } catch (e) {
        console.error("Feed load error:", e);
        if (!append)
            grid.innerHTML =
                '<div class="ex-empty"><p class="ex-empty-sub">Failed to load. Check your connection.</p></div>';
    } finally {
        exLoading = false;
        if (loader) loader.style.display = "none";
        if (moreBtn) moreBtn.disabled = false;
    }
}

// ── Setup ──────────────────────────────────────────────────
function setupExplore() {
    // Filter chips
    document.getElementById("exploreFilters")?.addEventListener("click", e => {
        const chip = e.target.closest(".ex-chip");
        if (!chip) return;
        document
            .querySelectorAll(".ex-chip")
            .forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        exFilter = chip.dataset.lang;
        exPage = 0;
        loadFeed(false);
    });

    // Load more
    document.getElementById("exploreMore")?.addEventListener("click", () => {
        exPage++;
        loadFeed(true);
    });

    // Copy buttons (delegated)
    document.getElementById("exploreGrid")?.addEventListener("click", e => {
        const btn = e.target.closest(".ex-copy-btn");
        if (!btn) return;
        e.stopPropagation();
        // decode html entities back to raw code
        const tmp = document.createElement("textarea");
        tmp.innerHTML = btn.dataset.code;
        navigator.clipboard
            .writeText(tmp.value)
            .then(() => {
                btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                showToast("Copied!");
                setTimeout(() => {
                    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
                }, 2000);
            })
            .catch(() => showToast("Copy failed", "error"));
    });

    // Initial load
    loadFeed(false);
}
