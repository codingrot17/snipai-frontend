// auth.js — Auth screen logic, called from app.js setupAuth()

function setupAuth() {
  const $ = id => document.getElementById(id);

  // ── Tab switching ──────────────────────────────────────
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const t = tab.dataset.tab;
      $('loginForm').style.display    = t === 'login'    ? 'flex' : 'none';
      $('registerForm').style.display = t === 'register' ? 'flex' : 'none';
    });
  });

  // ── Password show/hide ─────────────────────────────────
  document.querySelectorAll('.auth-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? '🙈' : '👁';
    });
  });

  // ── Password strength ──────────────────────────────────
  const pwInput     = $('regPassword');
  const pwStrength  = $('pwStrength');
  const pwStrengthBar = $('pwStrengthBar');

  if (pwInput) {
    pwInput.addEventListener('input', () => {
      const val = pwInput.value;
      if (!val) { pwStrength.style.display = 'none'; return; }
      pwStrength.style.display = 'block';

      let score = 0;
      if (val.length >= 8)              score++;
      if (val.length >= 12)             score++;
      if (/[A-Z]/.test(val))            score++;
      if (/[0-9]/.test(val))            score++;
      if (/[^A-Za-z0-9]/.test(val))    score++;

      const pct   = (score / 5) * 100;
      const color = score <= 1 ? '#f87171' : score <= 3 ? '#fbbf24' : '#10b981';
      pwStrengthBar.style.width      = pct + '%';
      pwStrengthBar.style.background = color;
    });
  }

  // ── Enter key support ──────────────────────────────────
  ['loginEmail','loginPassword'].forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
  });
  ['regName','regEmail','regPassword','regConfirm'].forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('keydown', e => { if (e.key === 'Enter') $('registerBtn').click(); });
  });

  // ── Social buttons ─────────────────────────────────────
  ['googleLoginBtn','googleRegBtn'].forEach(id => {
    const btn = $(id); if (!btn) return;
    btn.addEventListener('click', () => {
      btn.textContent = 'Redirecting...';
      btn.disabled = true;
      Auth.loginWithGoogle();
    });
  });

  ['githubLoginBtn','githubRegBtn'].forEach(id => {
    const btn = $(id); if (!btn) return;
    btn.addEventListener('click', () => {
      btn.textContent = 'Redirecting...';
      btn.disabled = true;
      Auth.loginWithGitHub();
    });
  });

  // ── Login ──────────────────────────────────────────────
  $('loginBtn').addEventListener('click', async () => {
    const email = $('loginEmail').value.trim();
    const pass  = $('loginPassword').value;
    const err   = $('loginError');
    err.textContent = '';

    if (!email)                           { err.textContent = 'Enter your email'; return; }
    if (!pass)                            { err.textContent = 'Enter your password'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter a valid email'; return; }

    const btn = $('loginBtn');
    btn.textContent = 'Signing in...';
    btn.disabled = true;

    try {
      const user = await Auth.login(email, pass);
      window.onAuthSuccess(user);
    } catch (e) {
      const msg = e.message ?? '';
      if (msg.includes('Invalid') || msg.includes('credentials'))
        err.textContent = 'Wrong email or password';
      else if (msg.includes('network') || msg.includes('fetch'))
        err.textContent = 'Network error — check your connection';
      else
        err.textContent = 'Login failed. Please try again.';
    } finally {
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  });

  // ── Register ───────────────────────────────────────────
  $('registerBtn').addEventListener('click', async () => {
    const name    = $('regName').value.trim();
    const email   = $('regEmail').value.trim();
    const pass    = $('regPassword').value;
    const confirm = $('regConfirm').value;
    const err     = $('registerError');
    err.textContent = '';

    if (!name)                                         { err.textContent = 'Enter your name'; return; }
    if (!email)                                        { err.textContent = 'Enter your email'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))   { err.textContent = 'Enter a valid email'; return; }
    if (!pass)                                         { err.textContent = 'Enter a password'; return; }
    if (pass.length < 8)                               { err.textContent = 'Password must be at least 8 characters'; return; }
    if (pass !== confirm)                              { err.textContent = 'Passwords do not match'; return; }

    const btn = $('registerBtn');
    btn.textContent = 'Creating account...';
    btn.disabled = true;

    try {
      const user = await Auth.register(name, email, pass);
      window.onAuthSuccess(user);
    } catch (e) {
      const msg = e.message ?? '';
      if (msg.includes('already') || msg.includes('exists'))
        err.textContent = 'Email already registered — try signing in';
      else if (msg.includes('network') || msg.includes('fetch'))
        err.textContent = 'Network error — check your connection';
      else
        err.textContent = 'Registration failed. Please try again.';
    } finally {
      btn.textContent = 'Create Account';
      btn.disabled = false;
    }
  });
}