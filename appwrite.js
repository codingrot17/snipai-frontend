// ── Appwrite SDK via CDN (loaded in index.html) ───────────
// All Appwrite classes come from window.Appwrite global

const { Client, Account, Databases, ID, Query, Permission, Role } = Appwrite;

const PROJECT_ID    = '699d610a00200b7c3ede';
const API_ENDPOINT  = 'https://fra.cloud.appwrite.io/v1';
const DATABASE_ID   = '699d67950017f657bcb5';
const COLLECTION_ID = 'snippets';

const client = new Client()
  .setEndpoint(API_ENDPOINT)
  .setProject(PROJECT_ID);

const account   = new Account(client);
const databases = new Databases(client);

// ── LocalStorage Keys ──────────────────────────────────────
const LS_USER     = 'snipai_user';
const LS_GROQ_KEY = 'snipai_groq_key';

// ── Auth ───────────────────────────────────────────────────
const Auth = {
  async register(name, email, password) {
    await account.create(ID.unique(), email, password, name);
    return this.login(email, password);
  },

  async login(email, password) {
    await account.createEmailPasswordSession(email, password);
    const user = await account.get();
    localStorage.setItem(LS_USER, JSON.stringify(user));
    return user;
  },

  async logout() {
    try { await account.deleteSession('current'); } catch {}
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_GROQ_KEY);
  },

  async getUser() {
    try {
      const user = await account.get();
      localStorage.setItem(LS_USER, JSON.stringify(user));
      return user;
    } catch {
      localStorage.removeItem(LS_USER);
      return null;
    }
  },

  getCachedUser() {
    try { return JSON.parse(localStorage.getItem(LS_USER)); }
    catch { return null; }
  },
  // OAuth — Google
  loginWithGoogle() {
    account.createOAuth2Session(
      'google',
      window.location.origin + '/?oauth=success',
      window.location.origin + '/?oauth=fail'
    );
  },

  // OAuth — GitHub
  loginWithGitHub() {
    account.createOAuth2Session(
      'github',
      window.location.origin + '/?oauth=success',
      window.location.origin + '/?oauth=fail'
    );
  },

};

// ── Groq Key ───────────────────────────────────────────────
const GroqKey = {
  get() { return localStorage.getItem(LS_GROQ_KEY) ?? ''; },

  async save(key) {
    localStorage.setItem(LS_GROQ_KEY, key);
    try { await account.updatePrefs({ groqKey: key }); } catch {}
  },

  async load() {
    const local = localStorage.getItem(LS_GROQ_KEY);
    if (local) return local;
    try {
      const prefs = await account.getPrefs();
      if (prefs.groqKey) {
        localStorage.setItem(LS_GROQ_KEY, prefs.groqKey);
        return prefs.groqKey;
      }
    } catch {}
    return '';
  },
};

// ── Snippets ───────────────────────────────────────────────
const Snippets = {
  _perms(userId, isPublic) {
    const p = [
      Permission.read(Role.user(userId)),
      Permission.update(Role.user(userId)),
      Permission.delete(Role.user(userId)),
    ];
    if (isPublic) p.push(Permission.read(Role.any()));
    return p;
  },

  _fmt(doc) {
    return {
      id:          doc.$id,
      title:       doc.title,
      code:        doc.code,
      language:    doc.language,
      tags:        doc.tags ? doc.tags.split(',').filter(Boolean) : [],
      description: doc.description ?? '',
      isPublic:    doc.isPublic    ?? false,
      authorId:    doc.authorId,
      authorName:  doc.authorName  ?? '',
      createdAt:   doc.$createdAt,
    };
  },

  async list(userId, { search = '', language = '' } = {}) {
    const q = [
      Query.equal('authorId', userId),
      Query.orderDesc('$createdAt'),
      Query.limit(100),
    ];
    if (language) q.push(Query.equal('language', language));
    if (search)   q.push(Query.search('title', search));
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, q);
    return res.documents.map(d => this._fmt(d));
  },

  async create(userId, data) {
    const doc = await databases.createDocument(
      DATABASE_ID, COLLECTION_ID, ID.unique(),
      {
        title:       data.title,
        code:        data.code,
        language:    data.language,
        tags:        (data.tags ?? []).join(','),
        description: data.description ?? '',
        isPublic:    data.isPublic    ?? false,
        authorId:    userId,
        authorName:  data.authorName ?? '',
      },
      this._perms(userId, data.isPublic ?? false)
    );
    return this._fmt(doc);
  },

  async update(docId, userId, data) {
    const doc = await databases.updateDocument(
      DATABASE_ID, COLLECTION_ID, docId,
      {
        title:       data.title,
        code:        data.code,
        language:    data.language,
        tags:        (data.tags ?? []).join(','),
        description: data.description ?? '',
        isPublic:    data.isPublic    ?? false,
      },
      this._perms(userId, data.isPublic ?? false)
    );
    return this._fmt(doc);
  },

  async delete(docId) {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_ID, docId);
  },
};

// ── AI ─────────────────────────────────────────────────────
const AI = {
  async _call(system, user) {
    const key = GroqKey.get();
    if (!key) throw new Error('NO_KEY');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      }),
    });

    if (res.status === 401) throw new Error('INVALID_KEY');
    if (!res.ok)            throw new Error('AI_ERROR');
    const json = await res.json();
    return json.choices[0]?.message?.content?.trim() ?? '';
  },

  async analyze(code) {
    const system = `You are a senior developer assistant.
Respond ONLY with valid JSON, no markdown, no explanation:
{"language":"<lang>","title":"<max 6 words>","description":"<one sentence>","tags":["tag1","tag2","tag3"]}`;
    const raw   = await this._call(system, `Analyze:\n\n${code.slice(0, 2000)}`);
    const clean = raw.replace(/` + "```" + `json|` + "```" + `/gi, '').trim();
    return JSON.parse(clean);
  },

  async explain(code, language) {
    const system = `You are a helpful coding tutor. Explain code for an intermediate developer.
Plain English, under 120 words, no bullet points, no markdown.`;
    return this._call(system, `Explain this ${language} snippet:\n\n${code.slice(0, 2000)}`);
  },
};