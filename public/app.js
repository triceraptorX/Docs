'use strict';

/* =========================================================================
   Utilitaires
   ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);

/** Crée un élément DOM : h('div', {class: 'x', onclick: fn}, enfant1, enfant2…) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

const PLAINTEXT_EDITABLE = (() => {
  try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; }
  catch { return false; }
})();
const PLAIN = PLAINTEXT_EDITABLE ? 'plaintext-only' : 'true';

/** Ne garde que la mise en forme simple (gras, italique, lien…) */
const ALLOWED_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', A: 'a', BR: 'br' };
function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const out = document.createElement('div');
  (function copy(src, dst) {
    for (const n of src.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) dst.append(n.textContent);
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = ALLOWED_TAGS[n.tagName];
        if (tag) {
          const el = document.createElement(tag);
          if (tag === 'a') {
            const href = n.getAttribute('href') || '';
            if (/^(https?:|mailto:)/i.test(href)) el.setAttribute('href', href);
          }
          copy(n, el);
          dst.append(el);
        } else if (n.tagName === 'DIV' || n.tagName === 'P') {
          if (dst.childNodes.length) dst.append(document.createElement('br'));
          copy(n, dst);
        } else copy(n, dst);
      }
    }
  })(tpl.content, out);
  const res = out.innerHTML;
  return res === '<br>' ? '' : res;
}

/** Markdown inline très simple → HTML (utilisé au collage) */
function inlineMd(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function htmlToMd(html) {
  return String(html || '')
    .replace(/<br>/g, '  \n')
    .replace(/<\/?b>/g, '**').replace(/<\/?i>/g, '*').replace(/<\/?s>/g, '~~').replace(/<\/?code>/g, '`')
    .replace(/<a href="([^"]*)">(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/* ---------- Curseur dans un contenteditable ---------- */

function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function setCaret(el, offset) {
  const sel = getSelection();
  const r = document.createRange();
  let rest = offset;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (rest <= n.length) {
      r.setStart(n, rest);
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      return;
    }
    rest -= n.length;
  }
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
}

/** Range couvrant les caractères [start, end[ du texte de el */
function rangeAt(el, start, end) {
  const r = document.createRange();
  let pos = 0; let started = false;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const len = n.length;
    if (!started && start <= pos + len) { r.setStart(n, start - pos); started = true; }
    if (started && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  if (!started) { r.selectNodeContents(el); r.collapse(false); } else r.setEnd(el, el.childNodes.length);
  return r;
}

function selectionCollapsedIn(el) {
  const sel = getSelection();
  return sel.rangeCount && sel.isCollapsed && el.contains(sel.anchorNode);
}

function caretLineInfo(el) {
  const sel = getSelection();
  const elRect = el.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  if (!sel.rangeCount) return { first: true, last: true, x: elRect.left };
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  let rects = r.getClientRects();
  if (!rects.length) {
    // Position sans rectangle (élément vide, début de ligne) : on se rabat sur le texte
    const off = caretOffset(el); const len = el.textContent.length;
    return { first: off === 0 || !el.textContent.includes('\n') && el.scrollHeight <= lh * 1.6, last: off >= len, x: elRect.left };
  }
  const rect = rects[0];
  return { first: rect.top < elRect.top + lh * 0.8, last: rect.bottom > elRect.bottom - lh * 0.8, x: rect.left };
}

function placeCaretFromPoint(el, x, y) {
  let range = null;
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
  else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
  }
  if (range && el.contains(range.startContainer)) {
    range.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    return true;
  }
  return false;
}

/* =========================================================================
   État, API et sauvegarde
   ========================================================================= */

const state = {
  pages: {},
  currentId: null,
  expanded: new Set(store.get('expanded', [])),
  focusTitle: false,
  dbSearch: {},
};

const api = {
  async req(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
  list() { return this.req('GET', '/api/pages'); },
  create(b) { return this.req('POST', '/api/pages', b); },
  patch(id, b) { return this.req('PATCH', `/api/pages/${id}`, b); },
  del(id) { return this.req('DELETE', `/api/pages/${id}`); },
};

const pending = new Map();
let saveTimer = null;

function setStatus(s) {
  const el = $('#save-status');
  el.dataset.state = s;
  el.textContent = { saving: 'Enregistrement…', saved: 'Enregistré', error: '⚠ Erreur de sauvegarde' }[s] || '';
}

function queueSave(id, fields) {
  if (!state.pages[id]) return;
  pending.set(id, { ...(pending.get(id) || {}), ...fields });
  state.pages[id].updatedAt = new Date().toISOString();
  setStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 400);
}

async function flushSaves() {
  clearTimeout(saveTimer);
  const entries = [...pending];
  pending.clear();
  if (!entries.length) return;
  try {
    await Promise.all(entries.map(([id, f]) => api.patch(id, f)));
    if (!pending.size) setStatus('saved');
  } catch (e) {
    console.error(e);
    setStatus('error');
    for (const [id, f] of entries) pending.set(id, { ...f, ...(pending.get(id) || {}) });
    saveTimer = setTimeout(flushSaves, 3000);
  }
}

window.addEventListener('beforeunload', () => {
  for (const [id, f] of pending) {
    fetch(`/api/pages/${id}`, { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
  }
});

/* ---------- Arbre des pages ---------- */

const children = (pid) => Object.values(state.pages)
  .filter((p) => (p.parentId || null) === (pid || null) && !p.trashed)
  .sort((a, b) => a.order - b.order);
const titleOf = (p) => p?.title || (p?.type === 'database' ? 'Base sans titre' : 'Sans titre');
const iconOf = (p) => p?.icon || (p?.type === 'database' ? '🗂️' : '📄');
function ancestors(id) {
  const out = [];
  let p = state.pages[id];
  while (p) { out.unshift(p); p = state.pages[p.parentId]; }
  return out;
}
function descendantIds(id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const p of Object.values(state.pages)) if (p.parentId === cur) { out.push(p.id); stack.push(p.id); }
  }
  return out;
}
const nextOrder = (pid) => { const s = children(pid); return s.length ? Math.max(...s.map((x) => x.order)) + 1 : 0; };

function addLink(parentId, pageId) {
  const parent = state.pages[parentId];
  if (!parent || parent.type !== 'page') return;
  if (parent.blocks.some((b) => b.pageId === pageId)) return;
  parent.blocks.push({ id: uid(), type: 'page', pageId });
  queueSave(parent.id, { blocks: parent.blocks });
}
function removeLinks(pageIds) {
  for (const p of Object.values(state.pages)) {
    if (p.blocks?.some((b) => pageIds.includes(b.pageId))) {
      p.blocks = p.blocks.filter((b) => !pageIds.includes(b.pageId));
      queueSave(p.id, { blocks: p.blocks });
    }
  }
}

async function createPage({ parentId = null, type = 'page', title = '', icon = '', props, view, link = true } = {}) {
  const page = await api.create({ parentId, type, title, icon, props, view, order: nextOrder(parentId) });
  state.pages[page.id] = page;
  if (link) addLink(parentId, page.id);
  if (parentId) { state.expanded.add(parentId); store.set('expanded', [...state.expanded]); }
  renderSidebar();
  return page;
}

async function trashPage(id, { silent } = {}) {
  const p = state.pages[id];
  if (!p) return;
  await flushSaves();
  await api.patch(id, { trashed: true });
  const ids = [id, ...descendantIds(id)];
  for (const d of ids) state.pages[d].trashed = true;
  removeLinks([id]);
  if (ids.includes(state.currentId)) {
    const parent = state.pages[p.parentId];
    navigate(parent && !parent.trashed ? parent.id : children(null)[0]?.id || '');
  } else rerender();
  if (!silent) toast(`« ${titleOf(p)} » déplacée dans la corbeille`, 'Annuler', () => restorePage(id));
}

async function restorePage(id) {
  await api.patch(id, { trashed: false });
  for (const d of [id, ...descendantIds(id)]) state.pages[d].trashed = false;
  const p = state.pages[id];
  if (p.parentId && !state.pages[p.parentId]) p.parentId = null;
  addLink(p.parentId, id);
  rerender();
}

async function deleteForever(id) {
  const { deleted } = await api.del(id);
  for (const d of deleted) delete state.pages[d];
  for (const p of Object.values(state.pages)) if (p.blocks) p.blocks = p.blocks.filter((b) => !deleted.includes(b.pageId));
  rerender();
}

async function movePage(id, newParentId) {
  const p = state.pages[id];
  if (!p || p.parentId === newParentId) return;
  removeLinks([id]);
  p.parentId = newParentId;
  p.order = nextOrder(newParentId);
  queueSave(id, { parentId: newParentId, order: p.order });
  addLink(newParentId, id);
  if (newParentId) state.expanded.add(newParentId);
  await flushSaves();
  rerender();
  toast(`Déplacée dans « ${newParentId ? titleOf(state.pages[newParentId]) : 'Racine'} »`);
}

/* =========================================================================
   Navigation
   ========================================================================= */

function navigate(id) {
  if (location.hash === `#/${id}`) route();
  else location.hash = `#/${id}`;
}

function route() {
  let id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (!state.pages[id] || state.pages[id].trashed) {
    id = children(null)[0]?.id || null;
    if (id) history.replaceState(null, '', `#/${id}`);
  }
  state.currentId = id;
  for (const a of ancestors(id).slice(0, -1)) state.expanded.add(a.id);
  if (innerWidth < 800) document.body.classList.add('sb-hidden');
  renderSidebar();
  renderPage();
  $('#scroller').scrollTop = 0;
}

function rerender() {
  renderSidebar();
  const sc = $('#scroller').scrollTop;
  if (!state.pages[state.currentId] || state.pages[state.currentId].trashed) return route();
  renderPage();
  $('#scroller').scrollTop = sc;
}

/* =========================================================================
   Barre latérale
   ========================================================================= */

function renderSidebar() {
  $('#tree').replaceChildren(...children(null).map((p) => treeItem(p, 0)));
}

function treeItem(p, depth) {
  const isDb = p.type === 'database';
  const kids = isDb ? [] : children(p.id);
  const open = state.expanded.has(p.id);
  const row = h('div', {
    class: `tree-row${p.id === state.currentId ? ' active' : ''}`,
    style: `padding-left:${6 + depth * 14}px`,
    'data-id': p.id,
    onclick: () => navigate(p.id),
  },
  h('button', {
    class: `tree-toggle${open ? ' open' : ''}${isDb ? ' invisible' : ''}`,
    title: open ? 'Replier' : 'Déplier',
    onclick: (e) => {
      e.stopPropagation();
      if (open) state.expanded.delete(p.id); else state.expanded.add(p.id);
      store.set('expanded', [...state.expanded]);
      renderSidebar();
    },
  }, '▸'),
  h('span', { class: 'tree-icon' }, iconOf(p)),
  h('span', { class: 'tree-title' }, titleOf(p)),
  h('span', { class: 'tree-actions' },
    h('button', { title: 'Supprimer, déplacer…', onclick: (e) => { e.stopPropagation(); openPageMenu(p.id, e.currentTarget); } }, '⋯'),
    !isDb && h('button', {
      title: 'Ajouter une sous-page',
      onclick: async (e) => {
        e.stopPropagation();
        const np = await createPage({ parentId: p.id });
        state.focusTitle = true;
        navigate(np.id);
      },
    }, '+')));
  const wrap = h('div', { class: 'tree-item' }, row);
  if (open && !isDb) {
    if (kids.length) wrap.append(...kids.map((k) => treeItem(k, depth + 1)));
    else wrap.append(h('div', { class: 'tree-empty', style: `padding-left:${30 + depth * 14}px` }, 'Aucune page à l’intérieur'));
  }
  return wrap;
}

async function newRootPage() {
  const p = await createPage({ parentId: null });
  state.focusTitle = true;
  navigate(p.id);
}

/* =========================================================================
   Popovers, menus, modales, toasts
   ========================================================================= */

let activePop = null;

function positionAt(el, rect) {
  const w = el.offsetWidth; const hgt = el.offsetHeight;
  let left = rect.left; let top = rect.bottom + 4;
  if (left + w > innerWidth - 8) left = innerWidth - w - 8;
  if (top + hgt > innerHeight - 8) top = Math.max(8, rect.top - hgt - 4);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;
}

function openPopover(anchor, content, { onClose } = {}) {
  closePopover();
  const pop = h('div', { class: 'popover' }, content);
  document.body.append(pop);
  positionAt(pop, anchor.getBoundingClientRect());
  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePopover(); } };
  setTimeout(() => document.addEventListener('mousedown', onDown));
  document.addEventListener('keydown', onKey, true);
  activePop = {
    pop,
    close() {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      pop.remove();
      activePop = null;
      onClose?.();
    },
  };
  return closePopover;
}
function closePopover() { activePop?.close(); }

/** items : {label, icon, onClick, danger, checked, hint} | {sep: true} | {header: 'Titre'} */
function menuEl(items) {
  return h('div', { class: 'menu-list' }, items.filter(Boolean).map((it) => {
    if (it.sep) return h('div', { class: 'menu-sep' });
    if (it.header) return h('div', { class: 'menu-header' }, it.header);
    return h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`,
      onclick: () => { closePopover(); it.onClick?.(); },
    },
    h('span', { class: 'mi-icon' }, it.icon || ''),
    h('span', { class: 'mi-label' }, it.label),
    it.checked && h('span', { class: 'mi-check' }, '✓'),
    it.hint && h('span', { class: 'mi-hint' }, it.hint));
  }));
}

function openMenu(anchor, items, opts) { return openPopover(anchor, h('div', { class: 'menu' }, menuEl(items)), opts); }

function openModal(content, { className = '' } = {}) {
  const overlay = h('div', { class: 'modal-overlay' });
  const box = h('div', { class: `modal ${className}` }, content);
  overlay.append(box);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return close;
}

function toast(msg, actionLabel, action) {
  const t = h('div', { class: 'toast' }, h('span', {}, msg),
    actionLabel && h('button', { onclick: () => { t.remove(); action(); } }, actionLabel));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 6000);
}

const EMOJIS = '📄 📝 📚 📌 📎 📁 🗂️ 🗃️ 📊 📈 🗓️ ✅ 💡 🔥 ⭐ 🎯 🚀 🧠 💼 🏠 🎨 🎵 🎮 🍕 ☕ 🌱 🌍 🌙 ☀️ ⚡ 🔒 🔑 🛠️ ⚙️ 🧪 🐛 💬 📣 ❤️ 🙂 😎 🤔 🎉 🏆 💰 🛒 ✈️ 🏃 📷 🎬 📖 ✏️ 🧩 🔗 📦 🧭 🗺️ 🐱 🐶 🌸 🍀 ⚠️ ❓ 📮 🧾'.split(' ');

function openIconPicker(anchor, onPick) {
  let close;
  const grid = h('div', { class: 'emoji-grid' }, EMOJIS.map((e) => h('button', { onclick: () => { close(); onPick(e); } }, e)));
  const custom = h('input', {
    class: 'pop-input', placeholder: 'Ou colle un emoji puis Entrée',
    onkeydown: (e) => { if (e.key === 'Enter' && custom.value.trim()) { close(); onPick(custom.value.trim()); } },
  });
  const bar = h('div', { class: 'emoji-bar' },
    h('button', { class: 'ghost small', onclick: () => { close(); onPick(EMOJIS[Math.floor(Math.random() * EMOJIS.length)]); } }, '🎲 Aléatoire'),
    h('button', { class: 'ghost small', onclick: () => { close(); onPick(''); } }, 'Retirer'));
  close = openPopover(anchor, h('div', { class: 'emoji-picker' }, bar, grid, custom));
}

/* ---------- Recherche / sélecteur de page ---------- */

function openSearch({ pick, exclude } = {}) {
  const input = h('input', { class: 'search-input', placeholder: pick ? 'Déplacer vers…' : 'Rechercher des pages…' });
  const list = h('div', { class: 'search-results' });
  let results = []; let sel = 0;

  const pathOf = (p) => ancestors(p.id).slice(0, -1).map(titleOf).join(' / ');
  const choose = (r) => {
    close();
    if (pick) pick(r.root ? null : r.p.id);
    else navigate(r.p.id);
  };
  const mark = () => [...list.children].forEach((c, i) => c.classList.toggle('sel', i === sel));
  const draw = () => {
    list.replaceChildren(...results.map((r, i) => h('div', {
      class: 'sr', onclick: () => choose(r), onmousemove: () => { if (sel !== i) { sel = i; mark(); } },
    },
    h('span', { class: 'sr-icon' }, r.root ? '🏠' : iconOf(r.p)),
    h('div', { class: 'sr-main' },
      h('div', { class: 'sr-title' }, r.root ? 'Racine de l’espace' : titleOf(r.p)),
      !r.root && h('div', { class: 'sr-path' }, r.snippet || pathOf(r.p))))));
    if (!results.length) list.append(h('div', { class: 'sr-empty' }, 'Aucun résultat'));
    mark();
  };
  const update = () => {
    const q = norm(input.value.trim());
    let pages = Object.values(state.pages).filter((p) => !p.trashed && !(exclude && exclude(p)));
    if (q) {
      pages = pages.map((p) => {
        const inTitle = norm(titleOf(p)).includes(q);
        if (inTitle) return { p, inTitle };
        const b = (p.blocks || []).find((bl) => norm(textOf(bl.text)).includes(q));
        return b ? { p, snippet: textOf(b.text).slice(0, 90) } : null;
      }).filter(Boolean).sort((a, b) => (!!b.inTitle - !!a.inTitle) || b.p.updatedAt.localeCompare(a.p.updatedAt));
    } else {
      pages = pages.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((p) => ({ p }));
    }
    results = (pick && !q ? [{ root: true }] : []).concat(pages.slice(0, 50));
    sel = 0;
    draw();
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && results[sel]) { e.preventDefault(); choose(results[sel]); }
  });
  const close = openModal(h('div', {}, input, list), { className: 'search-modal' });
  update();
  input.focus();
}

function openMovePicker(id) {
  const blocked = new Set([id, ...descendantIds(id)]);
  openSearch({ exclude: (p) => blocked.has(p.id) || p.type === 'database', pick: (target) => movePage(id, target) });
}

function openTrash() {
  const list = h('div', { class: 'trash-list' });
  const draw = () => {
    const items = Object.values(state.pages)
      .filter((p) => p.trashed && !state.pages[p.parentId]?.trashed)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    list.replaceChildren(...items.map((p) => h('div', { class: 'trash-row' },
      h('span', { class: 'sr-icon' }, iconOf(p)),
      h('span', { class: 'trash-title' }, titleOf(p)),
      h('button', { class: 'ghost small', title: 'Restaurer', onclick: async () => { await restorePage(p.id); draw(); } }, '↩ Restaurer'),
      h('button', {
        class: 'ghost small danger', title: 'Supprimer définitivement',
        onclick: async () => { if (confirm(`Supprimer définitivement « ${titleOf(p)} » et ses sous-pages ?`)) { await deleteForever(p.id); draw(); } },
      }, 'Supprimer'))));
    if (!items.length) list.append(h('div', { class: 'sr-empty' }, 'La corbeille est vide'));
  };
  openModal(h('div', {}, h('h3', { class: 'modal-title' }, '🗑️ Corbeille'), list), { className: 'trash-modal' });
  draw();
}

function openPageMenu(id, anchor) {
  const p = state.pages[id];
  if (!p) return;
  openMenu(anchor, [
    p.type === 'page' && { label: 'Pleine largeur', icon: '↔', checked: !!p.fullWidth, onClick: () => { p.fullWidth = !p.fullWidth; queueSave(id, { fullWidth: p.fullWidth }); rerender(); } },
    p.type === 'page' && { label: 'Ajouter une sous-page', icon: '＋', onClick: async () => { const np = await createPage({ parentId: id }); state.focusTitle = true; navigate(np.id); } },
    { label: 'Déplacer vers…', icon: '↪', onClick: () => openMovePicker(id) },
    { label: 'Exporter en Markdown', icon: '⬇', onClick: () => exportMarkdown(p) },
    { sep: true },
    { label: 'Mettre à la corbeille', icon: '🗑', danger: true, onClick: () => trashPage(id) },
    { sep: true },
    { header: `Modifiée le ${new Date(p.updatedAt).toLocaleString('fr-FR')}` },
  ]);
}

function exportMarkdown(p) {
  const lines = [`# ${p.icon ? `${p.icon} ` : ''}${titleOf(p)}`, ''];
  if (p.type === 'database') {
    const props = p.schema.properties;
    lines.push(`| Nom | ${props.map((x) => x.name).join(' | ')} |`, `|${' --- |'.repeat(props.length + 1)}`);
    for (const r of rowsOf(p)) lines.push(`| ${titleOf(r)} | ${props.map((pr) => cellText(pr, r.props?.[pr.id]).replace(/\|/g, '\\|')).join(' | ')} |`);
  } else {
    let num = 0;
    for (const b of p.blocks) {
      const ind = '  '.repeat(b.indent || 0);
      const t = htmlToMd(b.text);
      num = b.type === 'numbered' ? num + 1 : 0;
      switch (b.type) {
        case 'h1': lines.push(`## ${t}`); break;
        case 'h2': lines.push(`### ${t}`); break;
        case 'h3': lines.push(`#### ${t}`); break;
        case 'bullet': case 'toggle': lines.push(`${ind}- ${t}`); break;
        case 'numbered': lines.push(`${ind}${num}. ${t}`); break;
        case 'todo': lines.push(`${ind}- [${b.checked ? 'x' : ' '}] ${t}`); break;
        case 'quote': lines.push(`> ${t}`); break;
        case 'callout': lines.push(`> ${b.icon || '💡'} ${t}`); break;
        case 'code': lines.push('```', b.text, '```'); break;
        case 'divider': lines.push('---'); break;
        case 'page': { const tp = state.pages[b.pageId]; lines.push(`${ind}- 📄 ${titleOf(tp)}`); break; }
        default: lines.push(`${ind}${t}`);
      }
      if (!['bullet', 'numbered', 'todo', 'toggle', 'page'].includes(b.type)) lines.push('');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${titleOf(p).replace(/[\\/:*?"<>|]/g, '_')}.md` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =========================================================================
   Rendu d'une page
   ========================================================================= */

function renderBreadcrumbs() {
  const bc = $('#breadcrumbs');
  const chain = ancestors(state.currentId);
  bc.replaceChildren(...chain.flatMap((p, i) => [
    i > 0 && h('span', { class: 'bc-sep' }, '/'),
    h('button', { class: 'bc-item', onclick: () => navigate(p.id) }, h('span', {}, iconOf(p)), h('span', { class: 'bc-title' }, titleOf(p))),
  ].filter(Boolean)));
}

function renderPage() {
  closePopover();
  closeSlash();
  renderBreadcrumbs();
  const root = $('#page');
  const p = state.pages[state.currentId];
  editor = null;
  if (!p) {
    root.className = 'page';
    root.replaceChildren(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-emoji' }, '📝'),
      h('p', {}, 'Aucune page pour l’instant.'),
      h('button', { class: 'btn primary', onclick: newRootPage }, '+ Créer une page')));
    document.title = 'Notes';
    return;
  }
  document.title = `${p.icon ? `${p.icon} ` : ''}${titleOf(p)}`;
  root.className = `page${p.fullWidth || p.type === 'database' ? ' full' : ''}`;
  const parent = state.pages[p.parentId];

  const setIcon = (ic) => { p.icon = ic; queueSave(p.id, { icon: ic }); rerender(); };
  const header = h('div', { class: 'page-header' });
  if (p.icon) header.append(h('button', { class: 'page-icon', title: 'Changer l’icône', onclick: (e) => openIconPicker(e.currentTarget, setIcon) }, p.icon));
  header.append(h('div', { class: 'page-controls' },
    !p.icon && h('button', { class: 'ghost small', onclick: (e) => openIconPicker(e.currentTarget, setIcon) }, '☺ Ajouter une icône')));
  header.append(titleEl(p));
  root.replaceChildren(header);

  if (parent?.type === 'database') root.append(rowProps(parent, p));

  if (p.type === 'database') {
    const c = h('div', { class: 'db' });
    root.append(c);
    renderDatabase(p, c);
  } else {
    const ed = h('div', { class: 'editor' });
    root.append(ed, h('div', { class: 'editor-tail', onclick: onEditorTailClick }));
    editor = { page: p, el: ed };
    setupEditorDnD(ed);
    renderEditor();
  }

  if (state.focusTitle) {
    state.focusTitle = false;
    const t = $('.page-title', root);
    t.focus();
    setCaret(t, Infinity);
  }
}

function titleEl(p) {
  const t = h('h1', {
    class: 'page-title', contenteditable: PLAIN, spellcheck: 'false',
    'data-placeholder': p.type === 'database' ? 'Base sans titre' : 'Sans titre',
  }, p.title || '');
  const refreshNames = debounce(() => { renderSidebar(); renderBreadcrumbs(); }, 150);
  t.addEventListener('input', () => {
    if (t.innerHTML === '<br>') t.innerHTML = '';
    p.title = t.textContent.replace(/\n/g, ' ');
    document.title = `${p.icon ? `${p.icon} ` : ''}${titleOf(p)}`;
    queueSave(p.id, { title: p.title });
    refreshNames();
  });
  t.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '));
  });
  t.addEventListener('keydown', (e) => {
    if (!editor) { if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && caretOffset(t) === t.textContent.length)) {
      e.preventDefault();
      const first = editor.page.blocks[0];
      if (e.key === 'Enter' && !(first && first.type === 'p' && !textOf(first.text))) {
        editor.page.blocks.unshift(newBlock('p'));
        commit(editor.page.blocks[0].id, 0);
      } else if (first) focusBlock(first.id, 'start');
    }
  });
  return t;
}

/* =========================================================================
   Éditeur de blocs
   ========================================================================= */

let editor = null; // { page, el }

const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'code']);
const LIST_TYPES = new Set(['bullet', 'numbered', 'todo', 'toggle']);
const PLACEHOLDERS = {
  p: 'Écrivez quelque chose, ou tapez « / » pour les commandes…',
  h1: 'Titre 1', h2: 'Titre 2', h3: 'Titre 3',
  bullet: 'Liste', numbered: 'Liste', todo: 'À faire', toggle: 'Bloc dépliant',
  quote: 'Citation', callout: 'Écrivez quelque chose…', code: 'Code',
};
const BULLETS = ['•', '◦', '▪'];

const newBlock = (type = 'p', extra = {}) => ({ id: uid(), type, text: '', ...extra });
const bIndex = (id) => editor.page.blocks.findIndex((b) => b.id === id);
const bById = (id) => editor.page.blocks.find((b) => b.id === id);
const saveBlocks = () => queueSave(editor.page.id, { blocks: editor.page.blocks });

/** Fin (exclue) du sous-arbre du bloc i : blocs suivants plus indentés */
function subtreeEnd(blocks, i) {
  const base = blocks[i].indent || 0;
  let j = i + 1;
  while (j < blocks.length && (blocks[j].indent || 0) > base) j++;
  return j;
}

function commit(focusId, pos) {
  saveBlocks();
  renderEditor();
  if (focusId) focusBlock(focusId, pos);
}

function renderEditor() {
  const { page, el } = editor;
  if (!page.blocks.length) page.blocks.push(newBlock('p'));
  const counters = [];
  let hideAbove = Infinity; // les blocs plus indentés qu'un toggle fermé sont masqués
  const nodes = [];
  for (const b of page.blocks) {
    const indent = b.indent || 0;
    if (indent > hideAbove) continue;
    hideAbove = Infinity;
    let num = 0;
    if (b.type === 'numbered') {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] || 0) + 1;
      num = counters[indent];
    } else counters.length = indent;
    nodes.push(blockEl(b, num));
    if (b.type === 'toggle' && !b.open) hideAbove = indent;
  }
  el.replaceChildren(...nodes);
}

function blockEl(b, num) {
  const indent = b.indent || 0;
  const wrap = h('div', { class: `block b-${b.type}${b.checked ? ' checked' : ''}`, 'data-id': b.id, style: `--indent:${indent}` });
  wrap.append(h('div', { class: 'handle', contenteditable: 'false' },
    h('button', { class: 'h-add', title: 'Ajouter un bloc en dessous', onclick: () => addBlockBelow(b.id) }, '+'),
    h('button', {
      class: 'h-drag', title: 'Glisser pour déplacer · Cliquer pour le menu', draggable: true,
      onclick: (e) => openBlockMenu(b.id, e.currentTarget),
      ondragstart: (e) => onDragStart(e, b.id),
      ondragend: onDragEnd,
    }, '⋮⋮')));

  if (b.type === 'divider') {
    wrap.append(h('div', { class: 'block-body' }, h('div', { class: 'divider', tabindex: '0', onkeydown: (e) => onAtomKeydown(e, b) }, h('hr'))));
    return wrap;
  }
  if (b.type === 'page') {
    const tp = state.pages[b.pageId];
    wrap.append(h('div', { class: 'block-body' }, h('div', {
      class: 'page-link', tabindex: '0',
      onclick: () => tp && navigate(tp.id),
      onkeydown: (e) => onAtomKeydown(e, b),
    },
    h('span', { class: 'pl-icon' }, tp ? iconOf(tp) : '❓'),
    h('span', { class: 'pl-title' }, tp ? titleOf(tp) : 'Page introuvable'),
    tp?.type === 'database' && h('span', { class: 'pl-badge' }, 'Base de données'))));
    return wrap;
  }

  const content = h('div', {
    class: 'content',
    contenteditable: b.type === 'code' ? PLAIN : 'true',
    spellcheck: b.type === 'code' ? 'false' : 'true',
    'data-placeholder': PLACEHOLDERS[b.type] || '',
  });
  if (b.type === 'code') content.textContent = b.text || '';
  else content.innerHTML = b.text || '';
  content.addEventListener('input', (e) => onBlockInput(e, b, content));
  content.addEventListener('keydown', (e) => onBlockKeydown(e, b, content));
  content.addEventListener('paste', (e) => onPaste(e, b, content));
  content.addEventListener('focus', () => wrap.classList.add('focused'));
  content.addEventListener('blur', () => wrap.classList.remove('focused'));
  content.addEventListener('blur', () => setTimeout(() => { if (slash.el === content && document.activeElement !== content) closeSlash(); }, 150));
  content.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey || !a.closest('.content:focus'))) window.open(a.href, '_blank', 'noopener');
  });

  const body = h('div', { class: 'block-body' });
  switch (b.type) {
    case 'bullet': body.append(h('span', { class: 'marker', contenteditable: 'false' }, BULLETS[indent % 3]), content); break;
    case 'numbered': body.append(h('span', { class: 'marker num', contenteditable: 'false' }, `${num}.`), content); break;
    case 'todo':
      body.append(h('span', { class: 'marker', contenteditable: 'false' }, h('input', {
        type: 'checkbox', checked: !!b.checked,
        onchange: (e) => { b.checked = e.target.checked; wrap.classList.toggle('checked', b.checked); saveBlocks(); },
      })), content);
      break;
    case 'toggle':
      body.append(h('button', {
        class: `marker toggle-btn${b.open ? ' open' : ''}`, contenteditable: 'false', title: b.open ? 'Replier' : 'Déplier',
        onclick: () => toggleOpen(b),
      }, '▸'), content);
      break;
    case 'callout':
      body.append(h('button', {
        class: 'marker callout-icon', contenteditable: 'false',
        onclick: (e) => openIconPicker(e.currentTarget, (ic) => { b.icon = ic || '💡'; commit(); }),
      }, b.icon || '💡'), content);
      break;
    case 'code':
      body.append(h('div', { class: 'code-label', contenteditable: 'false' }, 'Code'), content);
      break;
    default: body.append(content);
  }
  wrap.append(body);
  return wrap;
}

function toggleOpen(b) {
  b.open = !b.open;
  const i = bIndex(b.id);
  if (b.open && subtreeEnd(editor.page.blocks, i) === i + 1) {
    const child = newBlock('p', { indent: (b.indent || 0) + 1 });
    editor.page.blocks.splice(i + 1, 0, child);
    return commit(child.id, 'start');
  }
  commit();
}

function blockWrap(id) { return editor?.el.querySelector(`.block[data-id="${CSS.escape(id)}"]`); }

function focusBlock(id, pos = 'end') {
  const w = blockWrap(id);
  if (!w) return;
  const c = w.querySelector('.content');
  if (!c) { w.querySelector('[tabindex]')?.focus(); return; }
  c.focus();
  setCaret(c, pos === 'end' ? Infinity : pos === 'start' ? 0 : pos);
}

function syncBlock(b, el) {
  if (b.type === 'code') b.text = el.innerText.replace(/\n$/, '');
  else {
    if (el.innerHTML === '<br>') el.innerHTML = '';
    b.text = sanitize(el.innerHTML);
  }
}

function onBlockInput(e, b, el) {
  syncBlock(b, el);
  saveBlocks();
  if (slash.open) updateSlash();
  else if (e.inputType === 'insertText' && e.data === '/' && b.type !== 'code') maybeOpenSlash(b, el);
  if (e.inputType === 'insertText' && b.type !== 'code') markdownShortcut(b, el, e.data);
}

/** Raccourcis Markdown en début de bloc : "# ", "- ", "[] ", "```", "---"… */
function markdownShortcut(b, el, data) {
  const off = caretOffset(el);
  const before = el.textContent.slice(0, off).replace(/ /g, ' ');
  const convert = (type, extra = {}) => {
    rangeAt(el, 0, off).deleteContents();
    syncBlock(b, el);
    Object.assign(b, { type }, extra);
    if (type === 'code') b.text = textOf(b.text);
    commit(b.id, 'start');
  };
  if (data === ' ' && b.type === 'p') {
    const map = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'bullet', '*': 'bullet', '+': 'bullet', '1.': 'numbered', '[]': 'todo', '[ ]': 'todo', '>': 'quote', '"': 'quote', '>>': 'toggle' };
    const prefix = before.slice(0, -1);
    if (before.endsWith(' ') && map[prefix]) convert(map[prefix], map[prefix] === 'todo' ? { checked: false } : {});
    else if (prefix === '[x]') convert('todo', { checked: true });
  } else if (data === '`' && before === '```' && b.type === 'p') convert('code');
  else if (data === '-' && before === '---' && b.type === 'p' && el.textContent === '---') {
    b.type = 'divider'; b.text = '';
    const i = bIndex(b.id);
    let next = editor.page.blocks[i + 1];
    if (!next || !TEXT_TYPES.has(next.type)) { next = newBlock('p', { indent: b.indent }); editor.page.blocks.splice(i + 1, 0, next); }
    commit(next.id, 'start');
  }
}

function visibleWraps() { return [...editor.el.querySelectorAll(':scope > .block')]; }
function neighborWrap(id, dir) {
  const ws = visibleWraps();
  const i = ws.findIndex((w) => w.dataset.id === id);
  return ws[i + dir] || null;
}

function onBlockKeydown(e, b, el) {
  if (slash.open && handleSlashKey(e)) return;
  if (e.isComposing) return;
  const blocks = editor.page.blocks;
  const i = bIndex(b.id);
  const mod = e.ctrlKey || e.metaKey;

  // Mise en forme
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleInlineCode(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); document.execCommand('strikeThrough'); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateBlock(b.id); return; }

  if (e.key === 'Enter' && !e.shiftKey) {
    if (b.type === 'code' && !mod) return; // retour à la ligne dans le code
    e.preventDefault();
    splitBlock(b, el);
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (b.type === 'code' && !e.shiftKey) { document.execCommand('insertText', false, '  '); return; }
    const off = caretOffset(el);
    const prev = blocks[i - 1];
    const cur = b.indent || 0;
    const end = subtreeEnd(blocks, i);
    let delta = 0;
    if (e.shiftKey && cur > 0) delta = -1;
    if (!e.shiftKey && prev && cur <= (prev.indent || 0)) delta = 1;
    if (delta) {
      for (let k = i; k < end; k++) blocks[k].indent = Math.max(0, (blocks[k].indent || 0) + delta);
      commit(b.id, off);
    }
    return;
  }

  if (e.key === 'Backspace' && selectionCollapsedIn(el) && caretOffset(el) === 0 && !rangeHasLeadingNodes(el)) {
    e.preventDefault();
    if (b.type !== 'p') {
      if (b.type === 'code') b.text = escapeHtml(b.text).replace(/\n/g, '<br>');
      b.type = 'p';
      return commit(b.id, 'start');
    }
    if ((b.indent || 0) > 0) {
      const end = subtreeEnd(blocks, i);
      for (let k = i; k < end; k++) blocks[k].indent = Math.max(0, (blocks[k].indent || 0) - 1);
      return commit(b.id, 'start');
    }
    const prevW = neighborWrap(b.id, -1);
    if (!prevW) {
      if (!el.textContent && blocks.length > 1) { blocks.splice(i, 1); saveBlocks(); renderEditor(); }
      const t = $('.page-title'); t.focus(); setCaret(t, Infinity);
      return;
    }
    const prev = bById(prevW.dataset.id);
    if (prev.type === 'divider') { blocks.splice(bIndex(prev.id), 1); return commit(b.id, 'start'); }
    if (!TEXT_TYPES.has(prev.type)) {
      if (!el.textContent) { blocks.splice(i, 1); commit(); }
      prevW.querySelector('[tabindex]')?.focus();
      return;
    }
    const prevEl = prevW.querySelector('.content');
    const at = prevEl.textContent.length;
    prev.text = prev.type === 'code' ? prev.text + el.textContent : sanitize(prev.text + b.text);
    blocks.splice(i, 1);
    return commit(prev.id, at);
  }

  if (e.key === 'Delete' && selectionCollapsedIn(el) && caretOffset(el) === el.textContent.length) {
    const nextW = neighborWrap(b.id, 1);
    if (!nextW) return;
    const next = bById(nextW.dataset.id);
    e.preventDefault();
    const at = el.textContent.length;
    if (next.type === 'divider') blocks.splice(bIndex(next.id), 1);
    else if (TEXT_TYPES.has(next.type)) {
      b.text = b.type === 'code' ? b.text + textOf(next.text) : sanitize(b.text + (next.type === 'code' ? escapeHtml(next.text) : next.text));
      blocks.splice(bIndex(next.id), 1);
    } else return;
    return commit(b.id, at);
  }

  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !mod && !e.altKey) {
    const info = caretLineInfo(el);
    const up = e.key === 'ArrowUp';
    if (up ? !info.first : !info.last) return;
    const target = neighborWrap(b.id, up ? -1 : 1);
    if (!target) {
      if (up) { e.preventDefault(); const t = $('.page-title'); t.focus(); setCaret(t, Infinity); }
      return;
    }
    e.preventDefault();
    focusWrapAt(target, info.x, up);
    return;
  }

  if (e.key === 'ArrowLeft' && selectionCollapsedIn(el) && caretOffset(el) === 0) {
    const prevW = neighborWrap(b.id, -1);
    if (prevW?.querySelector('.content')) { e.preventDefault(); focusBlock(prevW.dataset.id, 'end'); }
  }
  if (e.key === 'ArrowRight' && selectionCollapsedIn(el) && caretOffset(el) === el.textContent.length) {
    const nextW = neighborWrap(b.id, 1);
    if (nextW?.querySelector('.content')) { e.preventDefault(); focusBlock(nextW.dataset.id, 'start'); }
  }
}

/** Vrai si un <br> précède le curseur alors que l'offset texte est 0 */
function rangeHasLeadingNodes(el) {
  const sel = getSelection();
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(sel.anchorNode, sel.anchorOffset);
  const frag = pre.cloneContents();
  return !!frag.querySelector?.('br');
}

function focusWrapAt(wrap, x, fromBelow) {
  const c = wrap.querySelector('.content');
  if (!c) { wrap.querySelector('[tabindex]')?.focus(); return; }
  c.focus();
  const r = c.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(c).lineHeight) || 24;
  const y = fromBelow ? r.bottom - lh / 2 : r.top + lh / 2;
  const cx = Math.min(Math.max(x, r.left + 1), r.right - 1);
  if (!placeCaretFromPoint(c, cx, y)) setCaret(c, fromBelow ? Infinity : 0);
}

function onAtomKeydown(e, b) {
  const blocks = editor.page.blocks;
  const w = blockWrap(b.id);
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    const prevW = neighborWrap(b.id, -1);
    if (b.type === 'page') return trashPage(b.pageId);
    blocks.splice(bIndex(b.id), 1);
    commit(prevW?.dataset.id || blocks[0]?.id);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const t = neighborWrap(b.id, e.key === 'ArrowUp' ? -1 : 1);
    if (t) focusWrapAt(t, w.getBoundingClientRect().left, e.key === 'ArrowUp');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (b.type === 'page' && state.pages[b.pageId]) navigate(b.pageId);
    else {
      const nb = newBlock('p', { indent: b.indent });
      blocks.splice(bIndex(b.id) + 1, 0, nb);
      commit(nb.id, 'start');
    }
  }
}

/** Coupe le bloc au curseur (Entrée) */
function splitBlock(b, el) {
  const blocks = editor.page.blocks;
  const i = bIndex(b.id);
  const sel = getSelection();
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const atStart = caretOffset(el) === 0 && !rangeHasLeadingNodes(el);
  const empty = !el.textContent && !el.querySelector('br');

  // Entrée sur un élément de liste vide : on sort de la liste
  if (empty && (LIST_TYPES.has(b.type) || b.type === 'quote')) {
    if ((b.indent || 0) > 0) b.indent -= 1; else b.type = 'p';
    return commit(b.id, 'start');
  }

  const sameType = LIST_TYPES.has(b.type) ? b.type : 'p';
  if (atStart && !empty) {
    // Insère un bloc vide au-dessus, le curseur reste sur le bloc courant
    blocks.splice(i, 0, newBlock(sameType === 'toggle' ? 'toggle' : (LIST_TYPES.has(b.type) ? b.type : 'p'), { indent: b.indent }));
    return commit(b.id, 'start');
  }

  const tail = document.createRange();
  tail.setStart(r.startContainer, r.startOffset);
  tail.setEnd(el, el.childNodes.length);
  const tmp = document.createElement('div');
  tmp.append(tail.extractContents());
  syncBlock(b, el);
  const tailHtml = b.type === 'code' ? tmp.textContent : sanitize(tmp.innerHTML);

  let nb; let at;
  if (b.type === 'toggle' && b.open) {
    nb = newBlock('p', { indent: (b.indent || 0) + 1, text: tailHtml });
    at = i + 1;
  } else {
    nb = newBlock(sameType, { indent: b.indent, text: b.type === 'code' ? escapeHtml(tailHtml) : tailHtml });
    if (sameType === 'todo') nb.checked = false;
    // Après un toggle fermé, on saute ses enfants masqués
    at = b.type === 'toggle' ? subtreeEnd(blocks, i) : i + 1;
  }
  blocks.splice(at, 0, nb);
  commit(nb.id, 'start');
}

function addBlockBelow(id) {
  const blocks = editor.page.blocks;
  const i = bIndex(id);
  const b = blocks[i];
  let target = b;
  if (!(b.type === 'p' && !textOf(b.text))) {
    target = newBlock('p', { indent: b.indent, text: '' });
    blocks.splice(subtreeEnd(blocks, i), 0, target);
  }
  target.text = '/';
  commit(target.id, 'end');
  const el = blockWrap(target.id).querySelector('.content');
  slash.open = true; slash.block = target; slash.el = el; slash.start = 0; slash.index = 0;
  updateSlash();
}

function duplicateBlock(id) {
  const blocks = editor.page.blocks;
  const i = bIndex(id);
  const end = subtreeEnd(blocks, i);
  const copies = blocks.slice(i, end).filter((b) => b.type !== 'page').map((b) => ({ ...b, id: uid() }));
  if (!copies.length) return;
  blocks.splice(end, 0, ...copies);
  commit(copies[0].id, 'end');
}

function deleteBlock(id) {
  const blocks = editor.page.blocks;
  const b = bById(id);
  if (b.type === 'page') return trashPage(b.pageId);
  const prevW = neighborWrap(id, -1);
  blocks.splice(bIndex(id), 1);
  commit(prevW?.dataset.id);
}

function turnInto(id, type) {
  const b = bById(id);
  if (!TEXT_TYPES.has(b.type) || !TEXT_TYPES.has(type)) return;
  if (type === 'code' && b.type !== 'code') b.text = textOf(b.text);
  else if (b.type === 'code' && type !== 'code') b.text = escapeHtml(b.text).replace(/\n/g, '<br>');
  b.type = type;
  if (type === 'todo') b.checked = !!b.checked;
  commit(id, 'end');
}

function openBlockMenu(id, anchor) {
  const b = bById(id);
  const items = [
    { label: 'Supprimer', icon: '🗑', danger: true, hint: 'Suppr', onClick: () => deleteBlock(id) },
    b.type !== 'page' && { label: 'Dupliquer', icon: '⧉', hint: 'Ctrl+D', onClick: () => duplicateBlock(id) },
  ];
  if (TEXT_TYPES.has(b.type)) {
    items.push({ sep: true }, { header: 'Transformer en' },
      ...COMMANDS.filter((c) => c.block && TEXT_TYPES.has(c.block)).map((c) => ({
        label: c.label, icon: c.icon, checked: b.type === c.block, onClick: () => turnInto(id, c.block),
      })));
  }
  openMenu(anchor, items);
}

function onEditorTailClick() {
  const blocks = editor.page.blocks;
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'p' && !textOf(last.text) && !(last.indent > 0)) return focusBlock(last.id, 'start');
  const nb = newBlock('p');
  blocks.push(nb);
  commit(nb.id, 'start');
}

/* ---------- Collage ---------- */

function parseMarkdown(text) {
  const out = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    if (/^\s*```/.test(raw)) {
      const code = [];
      k++;
      while (k < lines.length && !/^\s*```/.test(lines[k])) code.push(lines[k++]);
      out.push(newBlock('code', { text: code.join('\n') }));
      continue;
    }
    if (!raw.trim()) continue;
    const indent = Math.min(6, Math.floor((raw.match(/^\s*/)[0].replace(/\t/g, '  ').length) / 2));
    const line = raw.trim();
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) out.push(newBlock(`h${m[1].length}`, { text: inlineMd(m[2]) }));
    else if ((m = line.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/))) out.push(newBlock('todo', { indent, checked: m[1] !== ' ', text: inlineMd(m[2]) }));
    else if ((m = line.match(/^[-*+]\s+(.*)$/))) out.push(newBlock('bullet', { indent, text: inlineMd(m[1]) }));
    else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) out.push(newBlock('numbered', { indent, text: inlineMd(m[1]) }));
    else if ((m = line.match(/^>\s?(.*)$/))) out.push(newBlock('quote', { text: inlineMd(m[1]) }));
    else if (/^(-{3,}|\*{3,})$/.test(line)) out.push(newBlock('divider'));
    else out.push(newBlock('p', { indent, text: inlineMd(line) }));
  }
  return out;
}

function onPaste(e, b, el) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  if (b.type === 'code' || !/\n/.test(text.trim())) {
    document.execCommand('insertText', false, b.type === 'code' ? text : text.replace(/\s*\n\s*/g, ' '));
    return;
  }
  const parsed = parseMarkdown(text);
  if (!parsed.length) return;
  const blocks = editor.page.blocks;
  const sel = getSelection();
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const tail = document.createRange();
  tail.setStart(r.startContainer, r.startOffset);
  tail.setEnd(el, el.childNodes.length);
  const tmp = document.createElement('div');
  tmp.append(tail.extractContents());
  syncBlock(b, el);
  const tailHtml = sanitize(tmp.innerHTML);
  for (const nb of parsed) nb.indent = (nb.indent || 0) + (b.indent || 0);

  let i = bIndex(b.id);
  // Si le bloc courant est vide, le premier bloc collé le remplace
  if (b.type === 'p' && !textOf(b.text)) { blocks.splice(i, 1); i -= 1; }
  blocks.splice(i + 1, 0, ...parsed);
  let last = parsed[parsed.length - 1];
  if (tailHtml) {
    if (TEXT_TYPES.has(last.type) && last.type !== 'code') {
      last.text = sanitize(last.text + tailHtml);
    } else {
      last = newBlock('p', { indent: b.indent, text: tailHtml });
      blocks.splice(i + 1 + parsed.length, 0, last);
    }
  }
  commit(last.id, 'end');
}

/* ---------- Glisser-déposer des blocs ---------- */

let drag = null;

function onDragStart(e, id) {
  const blocks = editor.page.blocks;
  const i = bIndex(id);
  drag = { ids: new Set(blocks.slice(i, subtreeEnd(blocks, i)).map((b) => b.id)) };
  const wrap = e.target.closest('.block');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', textOf(bById(id).text || ''));
  e.dataTransfer.setDragImage(wrap, 10, 10);
  setTimeout(() => wrap.classList.add('dragging'));
}

function onDragEnd() {
  drag = null;
  editor?.el.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after'));
}

function setupEditorDnD(ed) {
  const clear = () => ed.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  const targetOf = (e) => {
    const w = e.target.closest?.('.block');
    if (!w || drag.ids.has(w.dataset.id)) return null;
    const r = w.getBoundingClientRect();
    return { w, before: e.clientY < r.top + r.height / 2 };
  };
  ed.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    clear();
    const t = targetOf(e);
    if (t) t.w.classList.add(t.before ? 'drop-before' : 'drop-after');
  });
  ed.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault();
    const t = targetOf(e);
    clear();
    if (!t) return;
    const blocks = editor.page.blocks;
    const moving = blocks.filter((b) => drag.ids.has(b.id));
    const rest = blocks.filter((b) => !drag.ids.has(b.id));
    const target = rest.find((b) => b.id === t.w.dataset.id);
    let at = rest.indexOf(target);
    if (!t.before) at = target.type === 'toggle' && !target.open ? subtreeEnd(rest, at) : at + 1;
    const delta = (target.indent || 0) - (moving[0].indent || 0);
    for (const m of moving) m.indent = Math.max(0, (m.indent || 0) + delta);
    rest.splice(at, 0, ...moving);
    editor.page.blocks = rest;
    drag = null;
    commit(moving[0].id, 'end');
  });
}

/* =========================================================================
   Menu « / »
   ========================================================================= */

const COMMANDS = [
  { group: 'Blocs de base', block: 'p', label: 'Texte', icon: 'Aa', desc: 'Un simple paragraphe.', keys: 'texte text paragraphe p' },
  { group: 'Blocs de base', block: 'h1', label: 'Titre 1', icon: 'H1', desc: 'Grand titre de section.', keys: 'h1 titre heading title #' },
  { group: 'Blocs de base', block: 'h2', label: 'Titre 2', icon: 'H2', desc: 'Titre de section moyen.', keys: 'h2 titre heading sous-titre ##' },
  { group: 'Blocs de base', block: 'h3', label: 'Titre 3', icon: 'H3', desc: 'Petit titre de section.', keys: 'h3 titre heading ###' },
  { group: 'Blocs de base', block: 'bullet', label: 'Liste à puces', icon: '•', desc: 'Une simple liste à puces.', keys: 'liste puces bullet ul -' },
  { group: 'Blocs de base', block: 'numbered', label: 'Liste numérotée', icon: '1.', desc: 'Une liste numérotée.', keys: 'liste numerotee numbered ol 1.' },
  { group: 'Blocs de base', block: 'todo', label: 'Liste de tâches', icon: '☑', desc: 'Suivre des tâches avec des cases à cocher.', keys: 'todo taches checkbox case cocher []' },
  { group: 'Blocs de base', block: 'toggle', label: 'Bloc dépliant', icon: '▸', desc: 'Masquer du contenu sous un titre repliable.', keys: 'toggle depliant replier accordeon' },
  { group: 'Blocs de base', block: 'quote', label: 'Citation', icon: '❝', desc: 'Mettre une citation en valeur.', keys: 'citation quote >' },
  { group: 'Blocs de base', block: 'callout', label: 'Encadré', icon: '💡', desc: 'Faire ressortir un texte.', keys: 'encadre callout note info' },
  { group: 'Blocs de base', block: 'code', label: 'Code', icon: '</>', desc: 'Un extrait de code.', keys: 'code snippet ```' },
  { group: 'Blocs de base', block: 'divider', label: 'Séparateur', icon: '—', desc: 'Séparer visuellement des blocs.', keys: 'separateur divider ligne hr ---' },
  { group: 'Pages', page: 'page', label: 'Page', icon: '📄', desc: 'Créer une sous-page dans cette page.', keys: 'page sous-page subpage' },
  { group: 'Pages', page: 'table', label: 'Base de données', icon: '🗂️', desc: 'Base de données en vue tableau.', keys: 'base de donnees database table tableau bdd db' },
  { group: 'Pages', page: 'board', label: 'Tableau Kanban', icon: '📋', desc: 'Base de données en vue Kanban.', keys: 'kanban board tableau database base colonnes' },
  { group: 'Pages', link: true, label: 'Lien vers une page', icon: '↗', desc: 'Insérer un lien vers une page existante.', keys: 'lien link mention page existante' },
];

const slash = { open: false, block: null, el: null, start: 0, items: [], index: 0, query: null };

function maybeOpenSlash(b, el) {
  const off = caretOffset(el);
  const prev = el.textContent[off - 2];
  if (prev && !/\s/.test(prev)) return; // évite d'ouvrir le menu au milieu d'une URL
  Object.assign(slash, { open: true, block: b, el, start: off - 1, index: 0, query: null });
  updateSlash();
}

function filterCommands(q) {
  const n = norm(q).trim();
  if (!n) return COMMANDS;
  return COMMANDS.filter((c) => norm(c.label).includes(n) || norm(c.keys).split(' ').some((k) => k.startsWith(n)));
}

function updateSlash() {
  const { el } = slash;
  if (!el || !el.isConnected) return closeSlash();
  const off = caretOffset(el);
  const text = el.textContent;
  if (off <= slash.start || text[slash.start] !== '/') return closeSlash();
  const q = text.slice(slash.start + 1, off);
  if (q.length > 25 || /\s{2}/.test(q)) return closeSlash();
  const items = filterCommands(q);
  if (!items.length && /\s$/.test(q)) return closeSlash();
  if (q !== slash.query) slash.index = 0;
  slash.query = q;
  slash.items = items;
  renderSlashMenu();
}

function renderSlashMenu() {
  const menu = $('#slash-menu');
  menu.hidden = false;
  if (!slash.items.length) {
    menu.replaceChildren(h('div', { class: 'menu-header' }, 'Aucun résultat'));
  } else {
    let group = null;
    const nodes = [];
    slash.items.forEach((c, i) => {
      if (c.group !== group) { group = c.group; nodes.push(h('div', { class: 'menu-header' }, group)); }
      nodes.push(h('button', {
        class: `slash-item${i === slash.index ? ' sel' : ''}`,
        onmousedown: (e) => e.preventDefault(),
        onmousemove: () => { if (slash.index !== i) { slash.index = i; renderSlashMenu(); } },
        onclick: () => runSlash(c),
      },
      h('span', { class: 'slash-icon' }, c.icon),
      h('span', { class: 'slash-text' }, h('span', { class: 'slash-label' }, c.label), h('span', { class: 'slash-desc' }, c.desc))));
    });
    menu.replaceChildren(...nodes);
    menu.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  // Positionnement sous le « / »
  const r = rangeAt(slash.el, slash.start, slash.start + 1).getBoundingClientRect();
  const rect = r.width || r.height ? r : slash.el.getBoundingClientRect();
  positionAt(menu, rect);
}

function closeSlash() {
  slash.open = false; slash.el = null; slash.block = null;
  const m = $('#slash-menu');
  if (m) m.hidden = true;
}

function handleSlashKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = slash.items.length;
    if (n) slash.index = (slash.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderSlashMenu();
    return true;
  }
  if ((e.key === 'Enter' || e.key === 'Tab') && slash.items.length) {
    e.preventDefault();
    runSlash(slash.items[slash.index]);
    return true;
  }
  if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return true; }
  return false;
}

async function runSlash(cmd) {
  const { block: b, el, start } = slash;
  const off = Math.max(caretOffset(el), start + 1);
  closeSlash();
  rangeAt(el, start, off).deleteContents();
  syncBlock(b, el);
  const blocks = editor.page.blocks;
  const i = bIndex(b.id);
  const empty = !el.textContent.trim();

  if (cmd.block === 'divider') {
    let at = i + 1;
    if (empty) { b.type = 'divider'; b.text = ''; } else blocks.splice(at++, 0, newBlock('divider', { indent: b.indent }));
    let next = blocks[at];
    if (!next || !TEXT_TYPES.has(next.type)) { next = newBlock('p', { indent: b.indent }); blocks.splice(at, 0, next); }
    return commit(next.id, 'start');
  }

  if (cmd.block) {
    let target = b;
    if (empty) {
      if (cmd.block === 'code') b.text = '';
      b.type = cmd.block;
    } else {
      target = newBlock(cmd.block, { indent: b.indent });
      blocks.splice(i + 1, 0, target);
    }
    if (cmd.block === 'todo') target.checked = !!target.checked;
    if (cmd.block === 'callout') target.icon = target.icon || '💡';
    if (cmd.block === 'toggle') target.open = true;
    return commit(target.id, empty ? 'end' : 'start');
  }

  const insertLink = (pageId) => {
    const link = { id: uid(), type: 'page', pageId, indent: b.indent };
    if (empty) blocks.splice(i, 1, link); else blocks.splice(i + 1, 0, link);
    saveBlocks();
  };

  if (cmd.link) {
    saveBlocks();
    openSearch({
      exclude: (p) => p.id === editor?.page.id,
      pick: (id) => { if (id && editor) { insertLink(id); commit(); } },
    });
    return;
  }

  const parentId = editor.page.id;
  const page = cmd.page === 'page'
    ? await createPage({ parentId, link: false })
    : await createPage({ parentId, type: 'database', link: false, view: { type: cmd.page, groupBy: null, sort: null } });
  insertLink(page.id);
  await flushSaves();
  state.focusTitle = true;
  navigate(page.id);
}

/* ---------- Barre de mise en forme ---------- */

function toggleInlineCode() {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const node = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
  const code = node?.closest('code');
  if (code && code.closest('.content')) {
    const r = document.createRange();
    r.selectNode(code);
    sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('insertText', false, code.textContent);
  } else if (!sel.isCollapsed) {
    document.execCommand('insertHTML', false, `<code>${escapeHtml(sel.toString())}</code>`);
  }
}

function insertLinkPrompt() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const r = sel.getRangeAt(0).cloneRange();
  const url = prompt('Adresse du lien (https://…)');
  if (!url) return;
  sel.removeAllRanges(); sel.addRange(r);
  const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
  document.execCommand('createLink', false, href);
}

function setupFormatBar() {
  const bar = $('#format-bar');
  const btn = (label, title, fn, cls = '') => h('button', { class: cls, title, onmousedown: (e) => { e.preventDefault(); fn(); update(); } }, label);
  bar.append(
    btn('B', 'Gras (Ctrl+B)', () => document.execCommand('bold'), 'fb-b'),
    btn('I', 'Italique (Ctrl+I)', () => document.execCommand('italic'), 'fb-i'),
    btn('U', 'Souligné (Ctrl+U)', () => document.execCommand('underline'), 'fb-u'),
    btn('S', 'Barré (Ctrl+Maj+S)', () => document.execCommand('strikeThrough'), 'fb-s'),
    btn('</>', 'Code (Ctrl+E)', toggleInlineCode, 'fb-code'),
    btn('🔗', 'Lien (Ctrl+K)', insertLinkPrompt),
  );
  const update = () => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { bar.hidden = true; return; }
    const r = sel.getRangeAt(0);
    const node = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const c = node?.closest('.content');
    if (!c || c.closest('.b-code')) { bar.hidden = true; return; }
    bar.hidden = false;
    const rect = r.getBoundingClientRect();
    bar.style.left = `${Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, rect.left + rect.width / 2 - bar.offsetWidth / 2))}px`;
    bar.style.top = `${Math.max(8, rect.top - bar.offsetHeight - 8)}px`;
  };
  document.addEventListener('selectionchange', debounce(update, 60));
}

/* =========================================================================
   Bases de données
   ========================================================================= */

const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const PROP_TYPES = [
  { type: 'text', label: 'Texte', icon: '≡' },
  { type: 'number', label: 'Nombre', icon: '#' },
  { type: 'select', label: 'Sélection', icon: '▾' },
  { type: 'multi_select', label: 'Multi-sélection', icon: '☰' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'checkbox', label: 'Case à cocher', icon: '☑' },
  { type: 'url', label: 'URL', icon: '🔗' },
];
const typeIcon = (t) => PROP_TYPES.find((x) => x.type === t)?.icon || '≡';
const saveSchema = (db) => queueSave(db.id, { schema: db.schema });
const saveView = (db) => queueSave(db.id, { view: db.view });

const tagEl = (o) => h('span', { class: `tag c-${o.color || 'gray'}` }, o.name);

function cellText(prop, v) {
  if (v == null || v === '') return '';
  const name = (id) => prop.options?.find((o) => o.id === id)?.name || '';
  switch (prop.type) {
    case 'select': return name(v);
    case 'multi_select': return (Array.isArray(v) ? v : []).map(name).filter(Boolean).join(', ');
    case 'checkbox': return v ? '✓' : '';
    case 'date': return v ? new Date(`${v}T00:00`).toLocaleDateString('fr-FR') : '';
    default: return String(v);
  }
}

function rowsOf(db) {
  let rows = children(db.id);
  const q = norm(state.dbSearch[db.id] || '');
  if (q) {
    rows = rows.filter((r) => norm(r.title).includes(q)
      || db.schema.properties.some((p) => norm(cellText(p, r.props?.[p.id])).includes(q)));
  }
  const s = db.view?.sort;
  if (s) {
    const dir = s.dir === 'desc' ? -1 : 1;
    const prop = db.schema.properties.find((p) => p.id === s.prop);
    const val = (r) => {
      if (s.prop === 'title') return norm(r.title);
      if (!prop) return '';
      const v = r.props?.[prop.id];
      if (prop.type === 'number') return v ?? -Infinity;
      if (prop.type === 'checkbox') return v ? 1 : 0;
      if (prop.type === 'select') return prop.options.findIndex((o) => o.id === v);
      if (prop.type === 'date') return v || '';
      return norm(cellText(prop, v));
    };
    rows.sort((a, b) => {
      const x = val(a); const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }
  return rows;
}

async function addRow(db, props = {}) {
  return createPage({ parentId: db.id, props, link: false });
}

function addProperty(db, type = 'text', name) {
  const prop = { id: uid(), name: name || `Propriété ${db.schema.properties.length + 1}`, type };
  if (type === 'select' || type === 'multi_select') prop.options = [];
  db.schema.properties.push(prop);
  saveSchema(db);
  return prop;
}

function changePropType(db, prop, type) {
  const old = prop.type;
  if (old === type) return;
  const options = [...(prop.options || [])];
  const nameOf = (id) => options.find((o) => o.id === id)?.name;
  const ensure = (name) => {
    let o = options.find((x) => norm(x.name) === norm(name));
    if (!o) { o = { id: uid(), name, color: COLORS[options.length % COLORS.length] }; options.push(o); }
    return o.id;
  };
  const toText = (v) => {
    if (v == null) return '';
    if (old === 'select') return nameOf(v) || '';
    if (old === 'multi_select') return (Array.isArray(v) ? v : []).map(nameOf).filter(Boolean).join(', ');
    if (old === 'checkbox') return v ? 'Oui' : '';
    return String(v);
  };
  for (const r of children(db.id)) {
    const v = r.props?.[prop.id];
    if (v == null) continue;
    const t = toText(v).trim();
    let nv;
    switch (type) {
      case 'number': { const n = Number(t.replace(',', '.')); nv = t === '' || Number.isNaN(n) ? null : n; break; }
      case 'checkbox': nv = old === 'checkbox' ? v : !!t && !['0', 'non', 'false', 'no'].includes(norm(t)); break;
      case 'date': nv = /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''; break;
      case 'select': nv = t ? ensure(t.split(',')[0].trim()) : null; break;
      case 'multi_select': nv = t ? t.split(',').map((x) => x.trim()).filter(Boolean).map(ensure) : []; break;
      default: nv = t;
    }
    r.props = { ...r.props, [prop.id]: nv };
    queueSave(r.id, { props: r.props });
  }
  prop.type = type;
  if (type === 'select' || type === 'multi_select') prop.options = options;
  saveSchema(db);
}

function openPropMenu(db, prop, anchor, rerenderFn) {
  if (prop === 'title') {
    openMenu(anchor, [
      { label: 'Trier A → Z', icon: '↑', onClick: () => { db.view.sort = { prop: 'title', dir: 'asc' }; saveView(db); } },
      { label: 'Trier Z → A', icon: '↓', onClick: () => { db.view.sort = { prop: 'title', dir: 'desc' }; saveView(db); } },
    ], { onClose: rerenderFn });
    return;
  }
  const name = h('input', {
    class: 'pop-input', value: prop.name, placeholder: 'Nom de la propriété',
    oninput: (e) => { prop.name = e.target.value; saveSchema(db); },
    onkeydown: (e) => { if (e.key === 'Enter') closePopover(); },
  });
  const items = [
    { header: 'Type' },
    ...PROP_TYPES.map((t) => ({ label: t.label, icon: t.icon, checked: prop.type === t.type, onClick: () => changePropType(db, prop, t.type) })),
    { sep: true },
    { label: 'Trier croissant', icon: '↑', onClick: () => { db.view.sort = { prop: prop.id, dir: 'asc' }; saveView(db); } },
    { label: 'Trier décroissant', icon: '↓', onClick: () => { db.view.sort = { prop: prop.id, dir: 'desc' }; saveView(db); } },
    { sep: true },
    {
      label: 'Supprimer la propriété', icon: '🗑', danger: true,
      onClick: () => {
        if (!confirm(`Supprimer la propriété « ${prop.name} » et ses valeurs ?`)) return;
        db.schema.properties = db.schema.properties.filter((p) => p !== prop);
        if (db.view.groupBy === prop.id) db.view.groupBy = null;
        if (db.view.sort?.prop === prop.id) db.view.sort = null;
        saveSchema(db); saveView(db);
      },
    },
  ];
  openPopover(anchor, h('div', { class: 'menu' }, h('div', { class: 'menu-pad' }, name), menuEl(items)), { onClose: rerenderFn });
  name.focus();
  name.select();
}

function openSelectPopover(db, prop, row, anchor, onChange) {
  const isMulti = prop.type === 'multi_select';
  const input = h('input', { class: 'pop-input', placeholder: 'Rechercher ou créer une option…' });
  const list = h('div', { class: 'opt-list' });
  let close;
  const selected = () => {
    const v = row.props?.[prop.id];
    return isMulti ? (Array.isArray(v) ? v : []) : (v ? [v] : []);
  };
  const setVal = (ids) => {
    row.props = { ...(row.props || {}), [prop.id]: isMulti ? ids : (ids[0] || null) };
    queueSave(row.id, { props: row.props });
    onChange();
  };
  const pick = (o) => {
    const cur = selected();
    if (isMulti) setVal(cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]);
    else { setVal(cur[0] === o.id ? [] : [o.id]); close(); return; }
    renderList();
  };
  const create = () => {
    const name = input.value.trim();
    if (!name) return;
    const o = { id: uid(), name, color: COLORS[(prop.options.length + 1) % COLORS.length] };
    prop.options.push(o);
    saveSchema(db);
    input.value = '';
    pick(o);
  };
  const renderList = () => {
    const raw = input.value.trim();
    const q = norm(raw);
    const sel = selected();
    const opts = prop.options.filter((o) => norm(o.name).includes(q));
    list.replaceChildren(
      h('div', { class: 'menu-header' }, isMulti ? 'Sélectionnez une ou plusieurs options' : 'Sélectionnez une option'),
      ...opts.map((o) => h('div', { class: 'opt-row', onclick: () => pick(o) },
        tagEl(o),
        sel.includes(o.id) && h('span', { class: 'mi-check' }, '✓'),
        h('button', {
          class: 'opt-color', title: 'Changer la couleur',
          onclick: (e) => { e.stopPropagation(); o.color = COLORS[(COLORS.indexOf(o.color) + 1) % COLORS.length]; saveSchema(db); onChange(); renderList(); },
        }, '◐'),
        h('button', {
          class: 'opt-del', title: 'Supprimer l’option',
          onclick: (e) => { e.stopPropagation(); prop.options = prop.options.filter((x) => x !== o); saveSchema(db); onChange(); renderList(); },
        }, '×'))),
      raw && !prop.options.some((o) => norm(o.name) === q)
        ? h('div', { class: 'opt-row create', onclick: create }, h('span', { class: 'muted' }, 'Créer'), tagEl({ name: raw, color: COLORS[(prop.options.length + 1) % COLORS.length] }))
        : null,
    );
  };
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = norm(input.value.trim());
    if (!q) return;
    const match = prop.options.find((o) => norm(o.name) === q) || prop.options.find((o) => norm(o.name).includes(q));
    if (match && norm(match.name) === q) pick(match); else create();
  });
  renderList();
  close = openPopover(anchor, h('div', { class: 'select-pop' }, input, list));
  input.focus();
}

/** Éditeur de valeur d'une propriété (cellule de tableau ou panneau de page) */
function propEditor(db, prop, row, onChange = () => {}) {
  const get = () => row.props?.[prop.id];
  const set = (v) => { row.props = { ...(row.props || {}), [prop.id]: v }; queueSave(row.id, { props: row.props }); };
  switch (prop.type) {
    case 'checkbox':
      return h('input', { type: 'checkbox', class: 'cell-check', checked: !!get(), onchange: (e) => { set(e.target.checked); onChange(); } });
    case 'number':
      return h('input', { class: 'cell-input num', type: 'number', step: 'any', value: get() ?? '', placeholder: 'Vide', oninput: (e) => set(e.target.value === '' ? null : Number(e.target.value)) });
    case 'date':
      return h('input', { class: 'cell-input', type: 'date', required: true, value: get() || '', onchange: (e) => { set(e.target.value); onChange(); } });
    case 'url': {
      const a = h('a', { class: 'cell-link', target: '_blank', rel: 'noopener', title: 'Ouvrir le lien' }, '↗');
      const upd = (v) => { if (/^https?:\/\//i.test(v)) { a.href = v; a.hidden = false; } else a.hidden = true; };
      const inp = h('input', { class: 'cell-input', type: 'text', value: get() || '', placeholder: 'Vide', oninput: (e) => { set(e.target.value); upd(e.target.value); } });
      upd(get() || '');
      return h('div', { class: 'cell-url' }, inp, a);
    }
    case 'select':
    case 'multi_select': {
      const box = h('div', { class: 'cell-tags', tabindex: '0' });
      const refresh = () => {
        const v = get();
        const ids = prop.type === 'select' ? (v ? [v] : []) : (Array.isArray(v) ? v : []);
        const opts = ids.map((id) => prop.options.find((o) => o.id === id)).filter(Boolean);
        box.replaceChildren(...(opts.length ? opts.map(tagEl) : [h('span', { class: 'muted' }, 'Vide')]));
      };
      refresh();
      const open = () => openSelectPopover(db, prop, row, box, () => { refresh(); onChange(); });
      box.addEventListener('click', open);
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      return box;
    }
    default:
      return h('input', { class: 'cell-input', type: 'text', value: get() || '', placeholder: 'Vide', oninput: (e) => set(e.target.value) });
  }
}

function rowProps(db, row) {
  const wrap = h('div', { class: 'row-props' });
  for (const prop of db.schema.properties) {
    wrap.append(h('div', { class: 'row-prop' },
      h('button', { class: 'row-prop-name', onclick: (e) => openPropMenu(db, prop, e.currentTarget, rerender) },
        h('span', { class: 'prop-ico' }, typeIcon(prop.type)), prop.name || 'Sans nom'),
      h('div', { class: 'row-prop-value' }, propEditor(db, prop, row))));
  }
  wrap.append(h('button', {
    class: 'ghost small add-prop',
    onclick: (e) => { const p = addProperty(db); rerender(); setTimeout(() => { const btns = document.querySelectorAll('.row-prop-name'); const btn = btns[btns.length - 1]; if (btn) openPropMenu(db, p, btn, rerender); }); },
  }, '+ Ajouter une propriété'));
  return wrap;
}

function renderDatabase(db, container) {
  db.view = db.view || { type: 'table', groupBy: null, sort: null };
  const body = h('div', { class: 'db-body' });
  const draw = () => (db.view.type === 'board' ? renderBoard(db, body, draw) : renderTable(db, body, draw));

  const sortProp = db.view.sort && (db.view.sort.prop === 'title' ? { name: 'Nom' } : db.schema.properties.find((p) => p.id === db.view.sort.prop));
  const tab = (type, label) => h('button', {
    class: `db-tab${db.view.type === type ? ' active' : ''}`,
    onclick: () => { db.view.type = type; saveView(db); rerender(); },
  }, label);
  const search = h('input', {
    class: 'db-search', type: 'search', placeholder: '🔍 Filtrer…', value: state.dbSearch[db.id] || '',
    oninput: (e) => { state.dbSearch[db.id] = e.target.value; draw(); },
  });
  const toolbar = h('div', { class: 'db-toolbar' },
    tab('table', '▦ Tableau'), tab('board', '▥ Kanban'),
    h('span', { class: 'spacer' }),
    sortProp && h('span', { class: 'chip' }, `${db.view.sort.dir === 'desc' ? '↓' : '↑'} ${sortProp.name}`,
      h('button', { title: 'Retirer le tri', onclick: () => { db.view.sort = null; saveView(db); rerender(); } }, '×')),
    db.view.type === 'board' && groupBySelect(db),
    search,
    h('button', {
      class: 'btn primary small',
      onclick: async () => {
        const r = await addRow(db, db.view.type === 'board' ? defaultGroupProps(db) : {});
        state.focusTitle = true;
        navigate(r.id);
      },
    }, 'Nouveau'));
  container.replaceChildren(toolbar, body);
  draw();
}

function renderTable(db, body, draw) {
  const props = db.schema.properties;
  const rows = rowsOf(db);
  const thead = h('thead', {}, h('tr', {},
    h('th', { class: 'col-title', onclick: (e) => openPropMenu(db, 'title', e.currentTarget, rerender) }, h('span', { class: 'prop-ico' }, 'Aa'), 'Nom'),
    props.map((p) => h('th', { onclick: (e) => openPropMenu(db, p, e.currentTarget, rerender) }, h('span', { class: 'prop-ico' }, typeIcon(p.type)), p.name || 'Sans nom')),
    h('th', {
      class: 'add-col', title: 'Ajouter une propriété',
      onclick: () => {
        const p = addProperty(db);
        rerender();
        const ths = document.querySelectorAll('.db-table th');
        openPropMenu(db, p, ths[ths.length - 2], rerender);
      },
    }, '+')));

  const tbody = h('tbody');
  const focusRowTitle = (id) => body.querySelector(`tr[data-id="${CSS.escape(id)}"] .title-input`)?.focus();
  for (const r of rows) {
    const titleInput = h('input', {
      class: 'title-input', value: r.title || '', placeholder: 'Sans titre',
      oninput: (e) => { r.title = e.target.value; queueSave(r.id, { title: r.title }); },
      onkeydown: async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const nr = await addRow(db);
          draw();
          focusRowTitle(nr.id);
        }
      },
    });
    tbody.append(h('tr', { 'data-id': r.id },
      h('td', { class: 'cell-title' },
        h('span', { class: 'row-icon' }, r.icon || '📄'),
        titleInput,
        h('button', { class: 'row-open', title: 'Ouvrir en page', onclick: () => navigate(r.id) }, '↗ Ouvrir'),
        h('button', { class: 'row-del', title: 'Mettre à la corbeille', onclick: async () => { await trashPage(r.id); draw(); } }, '🗑')),
      props.map((p) => h('td', { class: `cell cell-${p.type}` }, propEditor(db, p, r))),
      h('td', { class: 'add-col' })));
  }
  body.replaceChildren(
    h('div', { class: 'db-table-wrap' }, h('table', { class: 'db-table' }, thead, tbody)),
    h('button', {
      class: 'db-new-row',
      onclick: async () => { const nr = await addRow(db); draw(); focusRowTitle(nr.id); },
    }, '+ Nouvelle ligne'),
    h('div', { class: 'db-count' }, `${rows.length} ligne${rows.length > 1 ? 's' : ''}`),
  );
}

function boardGroupProp(db) {
  const selects = db.schema.properties.filter((p) => p.type === 'select');
  return selects.find((p) => p.id === db.view.groupBy) || selects[0] || null;
}

function defaultGroupProps(db) {
  const gp = boardGroupProp(db);
  return gp && gp.options[0] ? { [gp.id]: gp.options[0].id } : {};
}

function groupBySelect(db) {
  const selects = db.schema.properties.filter((p) => p.type === 'select');
  if (!selects.length) return null;
  const gp = boardGroupProp(db);
  return h('label', { class: 'group-by' }, 'Grouper par ',
    h('select', {
      onchange: (e) => { db.view.groupBy = e.target.value; saveView(db); rerender(); },
    }, selects.map((p) => h('option', { value: p.id, selected: p === gp }, p.name))));
}

function renderBoard(db, body, draw) {
  const gp = boardGroupProp(db);
  if (!gp) {
    body.replaceChildren(h('div', { class: 'board-empty' },
      h('p', {}, 'La vue Kanban regroupe les lignes selon une propriété de type « Sélection ».'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const p = addProperty(db, 'select', 'Statut');
          p.options = [
            { id: uid(), name: 'À faire', color: 'red' },
            { id: uid(), name: 'En cours', color: 'yellow' },
            { id: uid(), name: 'Terminé', color: 'green' },
          ];
          db.view.groupBy = p.id;
          saveSchema(db); saveView(db);
          rerender();
        },
      }, 'Créer une propriété « Statut »')));
    return;
  }
  const rows = rowsOf(db);
  const known = new Set(gp.options.map((o) => o.id));
  const columns = [{ id: null, name: `Sans ${gp.name.toLowerCase()}`, color: 'gray' }, ...gp.options];
  const others = db.schema.properties.filter((p) => p !== gp);
  let dragId = null;

  const board = h('div', { class: 'board' }, columns.map((col) => {
    const colRows = rows.filter((r) => {
      const v = r.props?.[gp.id];
      return col.id === null ? !v || !known.has(v) : v === col.id;
    });
    const cards = h('div', { class: 'board-cards' }, colRows.map((r) => h('div', {
      class: 'card', draggable: true, 'data-id': r.id,
      onclick: () => navigate(r.id),
      ondragstart: (e) => { dragId = r.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.title || ''); setTimeout(() => e.target.classList.add('dragging')); },
      ondragend: (e) => { e.target.classList.remove('dragging'); dragId = null; },
    },
    h('div', { class: 'card-title' }, r.icon ? `${r.icon} ` : '', r.title || 'Sans titre'),
    others.map((p) => {
      const v = r.props?.[p.id];
      if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) return null;
      if (p.type === 'select' || p.type === 'multi_select') {
        const ids = Array.isArray(v) ? v : [v];
        const opts = ids.map((id) => p.options.find((o) => o.id === id)).filter(Boolean);
        return opts.length ? h('div', { class: 'card-tags' }, opts.map(tagEl)) : null;
      }
      return h('div', { class: 'card-prop' }, h('span', { class: 'muted' }, `${p.name} : `), cellText(p, v));
    }))));

    const column = h('div', { class: 'board-col' },
      h('div', { class: 'board-col-head' }, tagEl(col), h('span', { class: 'muted' }, String(colRows.length))),
      cards,
      h('button', {
        class: 'board-add',
        onclick: async () => {
          const r = await addRow(db, col.id ? { [gp.id]: col.id } : {});
          state.focusTitle = true;
          navigate(r.id);
        },
      }, '+ Nouveau'));

    column.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      column.classList.add('drop');
    });
    column.addEventListener('dragleave', (e) => { if (!column.contains(e.relatedTarget)) column.classList.remove('drop'); });
    column.addEventListener('drop', (e) => {
      e.preventDefault();
      column.classList.remove('drop');
      const r = state.pages[dragId];
      if (!r) return;
      // Position d'insertion selon la carte survolée
      const cardEls = [...cards.querySelectorAll('.card:not(.dragging)')];
      const after = cardEls.find((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
      const siblings = cardEls.map((c) => state.pages[c.dataset.id]);
      const idx = after ? cardEls.indexOf(after) : siblings.length;
      const prev = siblings[idx - 1]; const next = siblings[idx];
      r.order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : r.order;
      r.props = { ...(r.props || {}), [gp.id]: col.id };
      queueSave(r.id, { props: r.props, order: r.order });
      if (db.view.sort) { db.view.sort = null; saveView(db); }
      draw();
    });
    return column;
  }));
  body.replaceChildren(board);
}

/* =========================================================================
   Démarrage
   ========================================================================= */

function setupChrome() {
  const toggleSidebar = () => document.body.classList.toggle('sb-hidden');
  $('#sb-close').onclick = toggleSidebar;
  $('#sb-open').onclick = toggleSidebar;
  $('#sb-backdrop').onclick = toggleSidebar;
  $('#sb-search').onclick = () => openSearch();
  $('#sb-new').onclick = newRootPage;
  $('#sb-trash').onclick = openTrash;
  $('#sb-theme').onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', document.documentElement.dataset.theme); } catch { /* ignore */ }
  };
  $('#page-menu-btn').onclick = (e) => state.currentId && openPageMenu(state.currentId, e.currentTarget);

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const sel = getSelection();
      const inContent = sel.rangeCount && !sel.isCollapsed && sel.anchorNode?.parentElement?.closest('.content');
      if (inContent) insertLinkPrompt(); else openSearch();
    }
    if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
    if (mod && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newRootPage(); }
  });
  document.addEventListener('mousedown', (e) => {
    if (slash.open && !e.target.closest('#slash-menu') && e.target !== slash.el) closeSlash();
  });
  window.addEventListener('resize', () => { if (slash.open) renderSlashMenu(); });
  $('#scroller').addEventListener('scroll', () => { if (slash.open) renderSlashMenu(); });
  window.addEventListener('hashchange', route);
}

async function init() {
  setupChrome();
  setupFormatBar();
  if (innerWidth < 800) document.body.classList.add('sb-hidden');
  try {
    state.pages = await api.list();
    setStatus('saved');
  } catch (e) {
    $('#page').replaceChildren(h('div', { class: 'empty-state' }, h('p', {}, `Impossible de joindre le serveur : ${e.message}`)));
    return;
  }
  route();
}

init();
