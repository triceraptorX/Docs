'use strict';
const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
const button = form.querySelector('button');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  button.disabled = true;
  button.textContent = 'Connexion…';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
    });
    if (r.ok) {
      location.replace(`/${location.hash}`);
      return;
    }
    const data = await r.json().catch(() => ({}));
    errorEl.textContent = data.error || 'Connexion impossible.';
    errorEl.hidden = false;
    form.password.value = '';
    form.password.focus();
  } catch {
    errorEl.textContent = 'Serveur injoignable.';
    errorEl.hidden = false;
  }
  button.disabled = false;
  button.textContent = 'Se connecter';
});
