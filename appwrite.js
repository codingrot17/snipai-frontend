// ── Appwrite Config ────────────────────────────────────────
import {
    Client,
    Account,
    Databases,
    ID,
    Query,
    Permission,
    Role
} from "https://cdn.jsdelivr.net/npm/appwrite@16/src/index.js";

const PROJECT_ID = "699d610a00200b7c3ede";
const API_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
export const DATABASE_ID = "699d67950017f657bcb5";
export const COLLECTION_ID = "snippets";

// ── Client ─────────────────────────────────────────────────
const client = new Client().setEndpoint(API_ENDPOINT).setProject(PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);

// ── LocalStorage Keys ──────────────────────────────────────
export const LS = {
    USER: "snipai_user",
    GROQ_KEY: "snipai_groq_key",
    SIDEBAR: "snipai_sidebar"
};

// ── Auth ───────────────────────────────────────────────────
export const Auth = {
    async register(name, email, password) {
        await account.create(ID.unique(), email, password, name);
        return this.login(email, password);
    },

    async login(email, password) {
        await account.createEmailPasswordSession(email, password);
        const user = await account.get();
        localStorage.setItem(LS.USER, JSON.stringify(user));
        return user;
    },

    async logout() {
        try {
            await account.deleteSession("current");
        } catch {}
        localStorage.removeItem(LS.USER);
        localStorage.removeItem(LS.GROQ_KEY);
    },

    async getUser() {
        try {
            const user = await account.get();
            localStorage.setItem(LS.USER, JSON.stringify(user));
            return user;
        } catch {
            localStorage.removeItem(LS.USER);
            return null;
        }
    },

    getCachedUser() {
        try {
            return JSON.parse(localStorage.getItem(LS.USER));
        } catch {
            return null;
        }
    }
};

// ── Groq Key ───────────────────────────────────────────────
// Stored in localStorage for instant offline access
// + mirrored in Appwrite prefs for cross-device sync
export const GroqKey = {
    get() {
        return localStorage.getItem(LS.GROQ_KEY) ?? "";
    },

    async save(key) {
        localStorage.setItem(LS.GROQ_KEY, key);
        try {
            await account.updatePrefs({ groqKey: key });
        } catch {}
    },

    async load() {
        const local = localStorage.getItem(LS.GROQ_KEY);
        if (local) return local;
        try {
            const prefs = await account.getPrefs();
            if (prefs.groqKey) {
                localStorage.setItem(LS.GROQ_KEY, prefs.groqKey);
                return prefs.groqKey;
            }
        } catch {}
        return "";
    }
};

// ── Snippets ───────────────────────────────────────────────
export const Snippets = {
    _perms(userId, isPublic) {
        const p = [
            Permission.read(Role.user(userId)),
            Permission.update(Role.user(userId)),
            Permission.delete(Role.user(userId))
        ];
        if (isPublic) p.push(Permission.read(Role.any()));
        return p;
    },

    _fmt(doc) {
        return {
            id: doc.$id,
            title: doc.title,
            code: doc.code,
            language: doc.language,
            tags: doc.tags ? doc.tags.split(",").filter(Boolean) : [],
            description: doc.description ?? "",
            isPublic: doc.isPublic ?? false,
            authorId: doc.authorId,
            createdAt: doc.$createdAt
        };
    },

    async list(userId, { search = "", language = "" } = {}) {
        const q = [
            Query.equal("authorId", userId),
            Query.orderDesc("$createdAt"),
            Query.limit(100)
        ];
        if (language) q.push(Query.equal("language", language));
        if (search) q.push(Query.search("title", search));
        const res = await databases.listDocuments(
            DATABASE_ID,
            COLLECTION_ID,
            q
        );
        return res.documents.map(d => this._fmt(d));
    },

    async create(userId, data) {
        const doc = await databases.createDocument(
            DATABASE_ID,
            COLLECTION_ID,
            ID.unique(),
            {
                title: data.title,
                code: data.code,
                language: data.language,
                tags: (data.tags ?? []).join(","),
                description: data.description ?? "",
                isPublic: data.isPublic ?? false,
                authorId: userId
            },
            this._perms(userId, data.isPublic ?? false)
        );
        return this._fmt(doc);
    },

    async update(docId, userId, data) {
        const doc = await databases.updateDocument(
            DATABASE_ID,
            COLLECTION_ID,
            docId,
            {
                title: data.title,
                code: data.code,
                language: data.language,
                tags: (data.tags ?? []).join(","),
                description: data.description ?? "",
                isPublic: data.isPublic ?? false
            },
            this._perms(userId, data.isPublic ?? false)
        );
        return this._fmt(doc);
    },

    async delete(docId) {
        await databases.deleteDocument(DATABASE_ID, COLLECTION_ID, docId);
    }
};

// ── AI (direct Groq from browser, user's own key) ──────────
export const AI = {
    async _call(system, user) {
        const key = GroqKey.get();
        if (!key) throw new Error("NO_KEY");

        const res = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    temperature: 0.3,
                    max_tokens: 400,
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: user }
                    ]
                })
            }
        );

        if (res.status === 401) throw new Error("INVALID_KEY");
        if (!res.ok) throw new Error("AI_ERROR");
        const json = await res.json();
        return json.choices[0]?.message?.content?.trim() ?? "";
    },

    async analyze(code) {
        const system = `You are a senior developer assistant.
Respond ONLY with valid JSON, no markdown:
{"language":"<lang>","title":"<max 6 words>","description":"<one sentence>","tags":["tag1","tag2","tag3"]}`;
        const raw = await this._call(
            system,
            `Analyze:\n\n${code.slice(0, 2000)}`
        );
        const clean = raw.replace(/```json|```/gi, "").trim();
        return JSON.parse(clean);
    },

    async explain(code, language) {
        const system = `You are a helpful coding tutor. Explain code for an intermediate developer.
Plain English, under 120 words, no bullet points, no markdown headers.`;
        return this._call(
            system,
            `Explain this ${language} snippet:\n\n${code.slice(0, 2000)}`
        );
    }
};
