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

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20 * 1024 * 1024) { reject(new Error('Requête trop volumineuse')); req.destroy(); }
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

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] === 'api' && parts[1] === 'pages') return await api(req, res, parts);
    if (parts[0] === 'api') return send(res, 404, { error: 'Route inconnue' });
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`📝 Notes locales disponibles sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   Données : ${DB_FILE}`);
});
