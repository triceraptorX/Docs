#!/usr/bin/env node
// Serveur local minimaliste (aucune dépendance) : sert l'interface et une API JSON.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const PUBLIC_PATHS = new Set(['/login', '/login.js', '/style.css', '/theme.js']);

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));

function writeSecret(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ---------- Authentification ----------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: (await scrypt(password, salt)).toString('hex') };
}

let auth = null; // { username, salt, hash, fromEnv }
async function loadAuth() {
  if (process.env.AUTH_USER && process.env.AUTH_PASSWORD) {
    auth = { username: process.env.AUTH_USER, ...(await hashPassword(process.env.AUTH_PASSWORD)), fromEnv: true };
    return;
  }
  try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { auth = null; }
}

const DUMMY = { salt: '00'.repeat(16), hash: '00'.repeat(64) };
async function checkCredentials(username, password) {
  // Le calcul est toujours fait, même si l'identifiant est faux, pour ne pas révéler s'il existe
  const rec = auth || DUMMY;
  const key = await scrypt(String(password), Buffer.from(rec.salt, 'hex'));
  const passOk = crypto.timingSafeEqual(key, Buffer.from(rec.hash, 'hex'));
  const a = crypto.createHash('sha256').update(String(username)).digest();
  const b = crypto.createHash('sha256').update(String(auth?.username ?? '')).digest();
  return !!auth && crypto.timingSafeEqual(a, b) && passOk;
}

// Sessions : on ne stocke que l'empreinte SHA-256 du jeton, jamais le jeton lui-même
const sessions = new Map();
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')))) {
    if (v.expires > Date.now()) sessions.set(k, v);
  }
} catch { /* aucune session enregistrée */ }
let sessTimer = null;
function persistSessions() {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => writeSecret(SESSIONS_FILE, Object.fromEntries(sessions)), 500);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return req.socket.encrypted || process.env.COOKIE_SECURE === '1'
    || (TRUST_PROXY && String(req.headers['x-forwarded-proto']).split(',')[0].trim() === 'https');
}

function sessionCookie(req, token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
}

function getSession(req) {
  const t = parseCookies(req).sid;
  if (!t) return null;
  const key = tokenHash(t);
  const s = sessions.get(key);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(key); persistSessions(); return null; }
  // Prolonge la session si elle est utilisée (au plus une fois par heure)
  if (s.expires - Date.now() < SESSION_DAYS * 86400e3 - 3600e3) {
    s.expires = Date.now() + SESSION_DAYS * 86400e3;
    persistSessions();
  }
  return { key, ...s };
}

function createSession(req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(tokenHash(token), { created: Date.now(), expires: Date.now() + SESSION_DAYS * 86400e3, ua: String(req.headers['user-agent'] || '').slice(0, 200) });
  persistSessions();
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
}

// Anti brute-force : 5 essais ratés → blocage croissant (1 min, 2, 4… jusqu'à 1 h)
const attempts = new Map();
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress;
}
function lockedFor(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}
function recordFailure(ip) {
  const a = attempts.get(ip) || { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= 5) a.until = Date.now() + Math.min(60e3 * 2 ** (a.fails - 5), 3600e3);
  attempts.set(ip, a);
}
setInterval(() => {
  for (const [ip, a] of attempts) if (a.until < Date.now() - 3600e3) attempts.delete(ip);
}, 600e3).unref();

async function promptCredentials() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = (q, hidden) => new Promise((resolve) => {
    if (!hidden) return rl.question(q, resolve);
    // Saisie masquée : on affiche la question puis on coupe l'écho du terminal
    process.stdout.write(q);
    rl._writeToOutput = () => {};
    rl.question('', (a) => {
      rl._writeToOutput = (str) => process.stdout.write(str);
      process.stdout.write('\n');
      resolve(a);
    });
  });
  console.log('\n🔐 Configuration du compte d\'accès');
  let username = '';
  while (!username) username = (await ask(`Identifiant [${auth?.username || 'admin'}] : `)).trim() || auth?.username || 'admin';
  let password;
  for (;;) {
    password = await ask('Mot de passe (8 caractères min.) : ', true);
    if (password.length < 8) { console.log('  ✗ Trop court.'); continue; }
    if (password !== await ask('Confirme le mot de passe : ', true)) { console.log('  ✗ Les mots de passe ne correspondent pas.'); continue; }
    break;
  }
  rl.close();
  auth = { username, ...(await hashPassword(password)) };
  writeSecret(AUTH_FILE, auth);
  sessions.clear();
  writeSecret(SESSIONS_FILE, {});
  console.log(`✓ Compte « ${username} » enregistré dans ${AUTH_FILE}\n`);
}

// ---------- Stockage ----------

function seed() {
  const welcomeId = uid();
  const subId = uid();
  const dbId = uid();
  const statusProp = uid();
  const opt = { todo: uid(), doing: uid(), done: uid() };
  const t = now();
  const pages = {};
  pages[welcomeId] = {
    id: welcomeId, parentId: null, type: 'page', title: 'Bienvenue 👋', icon: '🏠',
    order: 0, createdAt: t, updatedAt: t, trashed: false,
    blocks: [
      { id: uid(), type: 'h1', text: 'Ton espace de notes local' },
      { id: uid(), type: 'p', text: 'Tape <b>/</b> au début d\'une ligne (ou n\'importe où) pour ouvrir le menu des commandes.' },
      { id: uid(), type: 'h2', text: 'Raccourcis Markdown' },
      { id: uid(), type: 'bullet', text: '<code>#</code>, <code>##</code>, <code>###</code> + espace → titres H1, H2, H3' },
      { id: uid(), type: 'bullet', text: '<code>-</code> ou <code>*</code> + espace → liste à puces, <code>1.</code> → liste numérotée' },
      { id: uid(), type: 'bullet', text: '<code>[]</code> + espace → case à cocher, <code>&gt;</code> → citation, <code>```</code> → code, <code>---</code> → séparateur' },
      { id: uid(), type: 'bullet', text: '<b>Ctrl+B</b> / <i>Ctrl+I</i> / <u>Ctrl+U</u> pour la mise en forme, <b>Ctrl+K</b> pour rechercher' },
      { id: uid(), type: 'todo', text: 'Essayer de cocher cette case', checked: false },
      { id: uid(), type: 'h3', text: 'Sous-pages et bases de données' },
      { id: uid(), type: 'page', pageId: subId },
      { id: uid(), type: 'page', pageId: dbId },
      { id: uid(), type: 'callout', text: 'Tout est enregistré automatiquement dans <code>data/db.json</code>.', icon: '💡' },
    ],
  };
  pages[subId] = {
    id: subId, parentId: welcomeId, type: 'page', title: 'Une sous-page', icon: '📄',
    order: 0, createdAt: t, updatedAt: t, trashed: false,
    blocks: [{ id: uid(), type: 'p', text: 'Les pages peuvent contenir d\'autres pages, à l\'infini.' }],
  };
  pages[dbId] = {
    id: dbId, parentId: welcomeId, type: 'database', title: 'Tâches', icon: '🗂️',
    order: 1, createdAt: t, updatedAt: t, trashed: false, blocks: [],
    schema: {
      properties: [
        {
          id: statusProp, name: 'Statut', type: 'select', options: [
            { id: opt.todo, name: 'À faire', color: 'red' },
            { id: opt.doing, name: 'En cours', color: 'yellow' },
            { id: opt.done, name: 'Terminé', color: 'green' },
          ],
        },
        { id: 'due', name: 'Échéance', type: 'date' },
        { id: 'prio', name: 'Priorité', type: 'number' },
        { id: 'ok', name: 'Validé', type: 'checkbox' },
      ],
    },
    view: { type: 'table', groupBy: statusProp, sort: null },
  };
  ['Écrire la doc', 'Préparer la démo', 'Corriger les bugs'].forEach((title, i) => {
    const id = uid();
    pages[id] = {
      id, parentId: dbId, type: 'page', title, icon: '', order: i,
      createdAt: t, updatedAt: t, trashed: false, blocks: [],
      props: { [statusProp]: [opt.todo, opt.doing, opt.done][i], prio: 3 - i, due: '', ok: i === 2 },
    };
  });
  return { version: 1, pages };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('Impossible de lire', DB_FILE, e.message);
      process.exit(1);
    }
    const db = seed();
    writeNow(db);
    return db;
  }
}

function writeNow(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE); // écriture atomique
}

const db = load();
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeNow(db), 200);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); writeNow(db); }
  if (sessTimer) { clearTimeout(sessTimer); writeSecret(SESSIONS_FILE, Object.fromEntries(sessions)); }
}
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

// ---------- API ----------

const EDITABLE = ['parentId', 'title', 'icon', 'cover', 'order', 'blocks', 'schema', 'view', 'props', 'trashed', 'type', 'fullWidth'];

function descendants(id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const p of Object.values(db.pages)) {
      if (p.parentId === cur) { out.push(p.id); stack.push(p.id); }
    }
  }
  return out;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('Requête trop volumineuse')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

async function api(req, res, parts) {
  const [, , id] = parts; // ['', 'api', ...] déjà découpé : ['api','pages',id]
  if (req.method === 'GET' && !id) return send(res, 200, db.pages);

  if (req.method === 'GET') {
    const p = db.pages[id];
    return p ? send(res, 200, p) : send(res, 404, { error: 'Page introuvable' });
  }

  if (req.method === 'POST' && !id) {
    const body = await readBody(req);
    const t = now();
    const page = {
      id: body.id || uid(), parentId: body.parentId || null, type: body.type === 'database' ? 'database' : 'page',
      title: body.title || '', icon: body.icon || '', order: body.order ?? Date.now(),
      createdAt: t, updatedAt: t, trashed: false, blocks: body.blocks || [],
    };
    if (page.type === 'database') {
      page.schema = body.schema || {
        properties: [
          { id: uid(), name: 'Tags', type: 'multi_select', options: [] },
          { id: uid(), name: 'Date', type: 'date' },
        ],
      };
      page.view = body.view || { type: 'table', groupBy: null, sort: null };
    }
    if (body.props) page.props = body.props;
    db.pages[page.id] = page;
    persist();
    return send(res, 201, page);
  }

  if (req.method === 'PATCH' && id) {
    const p = db.pages[id];
    if (!p) return send(res, 404, { error: 'Page introuvable' });
    const body = await readBody(req);
    for (const k of EDITABLE) if (k in body) p[k] = body[k];
    p.updatedAt = now();
    // Mettre à la corbeille / restaurer une page entraîne ses descendants
    if ('trashed' in body) for (const d of descendants(id)) db.pages[d].trashed = body.trashed;
    persist();
    return send(res, 200, p);
  }

  if (req.method === 'DELETE' && id) {
    if (!db.pages[id]) return send(res, 404, { error: 'Page introuvable' });
    const ids = [id, ...descendants(id)];
    for (const d of ids) delete db.pages[d];
    // Retire les liens vers les pages supprimées
    for (const p of Object.values(db.pages)) {
      if (p.blocks?.some((b) => ids.includes(b.pageId))) {
        p.blocks = p.blocks.filter((b) => !ids.includes(b.pageId));
      }
    }
    persist();
    return send(res, 200, { deleted: ids });
  }

  send(res, 405, { error: 'Méthode non autorisée' });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/login') rel = '/login.html';
  else if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function authRoutes(req, res, route, session) {
  if (route === 'login' && req.method === 'POST') {
    const ip = clientIp(req);
    const wait = lockedFor(ip);
    if (wait) return send(res, 429, { error: `Trop de tentatives. Réessaie dans ${Math.ceil(wait / 60)} min.`, retryAfter: wait });
    const { username = '', password = '' } = await readBody(req, 10 * 1024);
    if (await checkCredentials(username, password)) {
      attempts.delete(ip);
      createSession(req, res);
      return send(res, 200, { ok: true });
    }
    recordFailure(ip);
    console.warn(`[auth] Échec de connexion depuis ${ip} (identifiant « ${String(username).slice(0, 50)} »)`);
    return send(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
  }
  if (route === 'logout' && req.method === 'POST') {
    if (session) { sessions.delete(session.key); persistSessions(); }
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return send(res, 200, { ok: true });
  }
  if (!session) return send(res, 401, { error: 'Non connecté' });
  if (route === 'me' && req.method === 'GET') return send(res, 200, { username: auth.username, canChangePassword: !auth.fromEnv });
  if (route === 'password' && req.method === 'POST') {
    if (auth.fromEnv) return send(res, 400, { error: 'Le mot de passe est défini par variable d\'environnement (AUTH_PASSWORD).' });
    const ip = clientIp(req);
    if (lockedFor(ip)) return send(res, 429, { error: 'Trop de tentatives, réessaie plus tard.' });
    const { current = '', next = '' } = await readBody(req, 10 * 1024);
    if (!(await checkCredentials(auth.username, current))) {
      recordFailure(ip);
      return send(res, 400, { error: 'Mot de passe actuel incorrect.' });
    }
    if (String(next).length < 8) return send(res, 400, { error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
    auth = { username: auth.username, ...(await hashPassword(String(next))) };
    writeSecret(AUTH_FILE, auth);
    // Déconnecte toutes les autres sessions
    for (const k of [...sessions.keys()]) if (k !== session.key) sessions.delete(k);
    persistSessions();
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Route inconnue' });
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    // Protection CSRF : les requêtes qui modifient doivent venir du site lui-même, en JSON
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers['x-forwarded-host'] && TRUST_PROXY ? req.headers['x-forwarded-host'] : req.headers.host;
      if (origin && new URL(origin).host !== host) return send(res, 403, { error: 'Origine refusée' });
      if (['POST', 'PATCH', 'PUT'].includes(req.method) && !String(req.headers['content-type']).startsWith('application/json')) {
        return send(res, 415, { error: 'JSON attendu' });
      }
    }
    const session = getSession(req);
    if (parts[0] === 'api' && ['login', 'logout', 'me', 'password'].includes(parts[1]) && parts.length === 2) {
      return await authRoutes(req, res, parts[1], session);
    }
    if (url.pathname === '/login' && session) return redirect(res, '/');
    if (PUBLIC_PATHS.has(url.pathname)) return serveStatic(req, res, url.pathname);
    if (!session) {
      if (parts[0] === 'api') return send(res, 401, { error: 'Non connecté' });
      return redirect(res, '/login');
    }
    if (parts[0] === 'api' && parts[1] === 'pages') return await api(req, res, parts);
    if (parts[0] === 'api') return send(res, 404, { error: 'Route inconnue' });
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 400, { error: 'Requête invalide' });
  }
});

(async () => {
  await loadAuth();
  const setup = process.argv.includes('--set-password');
  if (setup || !auth) {
    if (!process.stdin.isTTY) {
      console.error('✗ Aucun compte configuré. Lance « npm run set-password » dans un terminal,');
      console.error('  ou définis les variables d\'environnement AUTH_USER et AUTH_PASSWORD.');
      process.exit(1);
    }
    if (auth?.fromEnv) { console.error('✗ Le compte est défini par AUTH_USER / AUTH_PASSWORD.'); process.exit(1); }
    await promptCredentials();
    if (setup) process.exit(0);
  }
  server.listen(PORT, HOST, () => {
    console.log(`📝 Notes locales disponibles sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`   Données : ${DB_FILE}`);
    console.log(`   Compte  : ${auth.username}${auth.fromEnv ? ' (variables d\'environnement)' : ''}`);
  });
})();
