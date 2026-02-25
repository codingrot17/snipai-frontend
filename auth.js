// auth.js — sole owner of auth screen UI
// Globals: Auth (appwrite.js), window.onAuthSuccess (app.js)

function setupAuth() {
    const $ = id => document.getElementById(id);

    // ── Tab switching ──────────────────────────────────────
    // Uses style.display — NOT classList — to avoid conflicts with style.css .hidden rule
    document.querySelectorAll(".auth-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document
                .querySelectorAll(".auth-tab")
                .forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            const isLogin = tab.dataset.tab === "login";
            $("loginForm").style.display = isLogin ? "flex" : "none";
            $("registerForm").style.display = isLogin ? "none" : "flex";
        });
    });

    // ── Password show/hide ─────────────────────────────────
    document.querySelectorAll(".auth-eye").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = $(btn.dataset.target);
            if (!input) return;
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            btn.textContent = show ? "\uD83D\uDE48" : "\uD83D\uDC41";
        });
    });

    // ── Password strength meter ────────────────────────────
    const pwInput = $("regPassword");
    const pwStrength = $("pwStrength");
    const pwStrengthBar = $("pwStrengthBar");

    if (pwInput && pwStrength && pwStrengthBar) {
        pwInput.addEventListener("input", () => {
            const val = pwInput.value;
            if (!val) {
                pwStrength.style.display = "none";
                return;
            }
            pwStrength.style.display = "block";
            let score = 0;
            if (val.length >= 8) score++;
            if (val.length >= 12) score++;
            if (/[A-Z]/.test(val)) score++;
            if (/[0-9]/.test(val)) score++;
            if (/[^A-Za-z0-9]/.test(val)) score++;
            pwStrengthBar.style.width = (score / 5) * 100 + "%";
            pwStrengthBar.style.background =
                score <= 1 ? "#f87171" : score <= 3 ? "#fbbf24" : "#10b981";
        });
    }

    // ── Enter key ─────────────────────────────────────────
    ["loginEmail", "loginPassword"].forEach(id => {
        $(id)?.addEventListener("keydown", e => {
            if (e.key === "Enter") $("loginBtn").click();
        });
    });
    ["regName", "regEmail", "regPassword", "regConfirm"].forEach(id => {
        $(id)?.addEventListener("keydown", e => {
            if (e.key === "Enter") $("registerBtn").click();
        });
    });

    // ── Social OAuth ───────────────────────────────────────
    // Uses innerHTML spinner so SVG icon doesn't disappear
    function wireSocialBtn(id, provider) {
        const btn = $(id);
        if (!btn) return;
        btn.addEventListener("click", async () => {
            const orig = btn.innerHTML;
            btn.innerHTML =
                '<span style="font-size:12px">Redirecting\u2026</span>';
            btn.disabled = true;
            try {
                if (provider === "google") Auth.loginWithGoogle();
                else Auth.loginWithGitHub();
                // OAuth redirects the page — execution stops here on success
            } catch (e) {
                // Only runs if OAuth provider not configured in Appwrite Console
                btn.innerHTML = orig;
                btn.disabled = false;
                const errId =
                    $("loginForm").style.display !== "none"
                        ? "loginError"
                        : "registerError";
                $(errId).textContent =
                    "OAuth not set up yet \u2014 use email login below";
                console.error("OAuth error:", e);
            }
        });
    }

    wireSocialBtn("googleLoginBtn", "google");
    wireSocialBtn("googleRegBtn", "google");
    wireSocialBtn("githubLoginBtn", "github");
    wireSocialBtn("githubRegBtn", "github");

    // ── Login ──────────────────────────────────────────────
    $("loginBtn").addEventListener("click", async () => {
        const email = $("loginEmail").value.trim();
        const pass = $("loginPassword").value;
        const err = $("loginError");
        err.textContent = "";

        if (!email) {
            err.textContent = "Enter your email";
            return;
        }
        if (!pass) {
            err.textContent = "Enter your password";
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            err.textContent = "Enter a valid email address";
            return;
        }

        const btn = $("loginBtn");
        const orig = btn.textContent;
        btn.textContent = "Signing in\u2026";
        btn.disabled = true;

        try {
            const user = await Auth.login(email, pass);
            window.onAuthSuccess(user);
        } catch (e) {
            const msg = (e.message ?? "") + (e.toString() ?? "");
            if (
                msg.includes("401") ||
                msg.includes("Invalid") ||
                msg.includes("credentials")
            )
                err.textContent = "Wrong email or password";
            else if (
                msg.includes("network") ||
                msg.includes("fetch") ||
                msg.includes("Failed to fetch")
            )
                err.textContent = "Network error \u2014 check your connection";
            else
                err.textContent =
                    "Login failed \u2014 " +
                    (e.message?.slice(0, 80) || "try again");
        } finally {
            btn.textContent = orig;
            btn.disabled = false;
        }
    });

    // ── Register ───────────────────────────────────────────
    $("registerBtn").addEventListener("click", async () => {
        const name = $("regName").value.trim();
        const email = $("regEmail").value.trim();
        const pass = $("regPassword").value;
        const confirm = $("regConfirm")?.value ?? pass;
        const err = $("registerError");
        err.textContent = "";

        if (!name) {
            err.textContent = "Enter your name";
            return;
        }
        if (!email) {
            err.textContent = "Enter your email";
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            err.textContent = "Enter a valid email address";
            return;
        }
        if (!pass) {
            err.textContent = "Enter a password";
            return;
        }
        if (pass.length < 8) {
            err.textContent = "Password must be at least 8 characters";
            return;
        }
        if (pass !== confirm) {
            err.textContent = "Passwords do not match";
            return;
        }

        const btn = $("registerBtn");
        const orig = btn.textContent;
        btn.textContent = "Creating account\u2026";
        btn.disabled = true;

        try {
            const user = await Auth.register(name, email, pass);
            window.onAuthSuccess(user);
        } catch (e) {
            const msg = (e.message ?? "") + (e.toString() ?? "");
            if (
                msg.includes("409") ||
                msg.includes("already") ||
                msg.includes("exists")
            )
                err.textContent =
                    "Email already registered \u2014 try signing in";
            else if (
                msg.includes("network") ||
                msg.includes("fetch") ||
                msg.includes("Failed to fetch")
            )
                err.textContent = "Network error \u2014 check your connection";
            else
                err.textContent =
                    "Registration failed \u2014 " +
                    (e.message?.slice(0, 80) || "try again");
        } finally {
            btn.textContent = orig;
            btn.disabled = false;
        }
    });
}
