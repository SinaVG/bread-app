/* Bread — recipe scaler and bake journal.
   Plain JavaScript, no build step. Data lives on the device:
   recipes/bakes in localStorage, photos in IndexedDB. */
'use strict';

const APP_VERSION = '1.0.0';
const STORE_KEY = 'bread.v1';
const REPO_URL = 'https://github.com/SinaVG/bread-app';

/* ----------------------------------------------------------------------------
   Utilities
---------------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function fmtG(x) {
  if (x == null || !isFinite(x)) return '–';
  if (Math.abs(x) < 20) { const r = Math.round(x * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); }
  return Math.round(x).toLocaleString();
}
function fmtPct(x) {
  if (x == null || !isFinite(x)) return '–';
  const r = x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
  return r + '%';
}
function fmtNum(x) { if (x == null || !isFinite(x)) return ''; return String(Math.round(x * 100) / 100); }
function plural(n, one, many) { return Number(n) === 1 ? one : (many || one + 's'); }
function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function fmtDate(iso) {
  if (!iso) return '';
  try { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
}
function stars(n) {
  n = Number(n) || 0; let s = '';
  for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '<span class="off">★</span>';
  return `<span class="stars" aria-label="${n} of 5">${s}</span>`;
}

/* ----------------------------------------------------------------------------
   Sample data (the recipe this app started from)
---------------------------------------------------------------------------- */
function sampleRecipe() {
  const now = new Date().toISOString();
  return {
    id: 'sandwich-68',
    name: 'Sandwich Bread',
    baseLoaves: 2,
    ingredients: [
      { id: uid(), name: 'White flour', grams: 525, role: 'flour' },
      { id: uid(), name: 'Whole-wheat flour', grams: 225, role: 'flour' },
      { id: uid(), name: 'Water', grams: 510, role: 'liquid' },
      { id: uid(), name: 'Honey', grams: 25, role: 'other' },
      { id: uid(), name: 'Butter', grams: 55, role: 'other' },
      { id: uid(), name: 'Salt', grams: 14, role: 'other' },
      { id: uid(), name: 'Instant yeast', grams: 3, role: 'other' }
    ],
    notes: [
      { id: uid(), label: 'Water temperature', value: 'Aim for 95–100 °F (35–38 °C)' },
      { id: uid(), label: 'Warming water', value: 'About 45 sec in microwave, then check temperature' },
      { id: uid(), label: 'Yeast amount', value: '3 g is suitable for an overnight cold ferment' },
      { id: uid(), label: 'Initial rest', value: 'Mix everything, then rest 30 min' },
      { id: uid(), label: 'Folding', value: 'Do 3 folds, about 30 min apart' },
      { id: uid(), label: 'Before fridge', value: 'After the last fold, shape/organize the dough and refrigerate overnight' },
      { id: uid(), label: 'Next morning', value: 'Take dough out and let it sit about 40–60 min' },
      { id: uid(), label: 'Final shaping', value: 'Gently degas if needed, shape, and place in loaf pan' },
      { id: uid(), label: 'Final proof', value: 'About 1–4 hours, but judge by how much the dough has risen rather than the clock' },
      { id: uid(), label: 'Oven temp', value: '375 °F for 35 min, then 400 °F for 20 min' },
      { id: uid(), label: 'Internal temp', value: '205–210 °F' },
      { id: uid(), label: 'Next test', value: '400 °F for 35 min, then 400 °F for 20 min' }
    ],
    createdAt: now,
    updatedAt: now
  };
}

/* ----------------------------------------------------------------------------
   State
---------------------------------------------------------------------------- */
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.recipes = Array.isArray(s.recipes) ? s.recipes : [];
      s.bakes = Array.isArray(s.bakes) ? s.bakes : [];
      s.settings = s.settings || {};
      return s;
    }
  } catch (e) { console.warn('Could not read saved data', e); }
  const fresh = { version: 1, recipes: [sampleRecipe()], bakes: [], settings: {} };
  persist(fresh);
  return fresh;
}
function persist(s = state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
  catch (e) { toast('Could not save — storage is full?'); console.error(e); }
}
const getRecipe = (id) => state.recipes.find((r) => r.id === id);
const getBake = (id) => state.bakes.find((b) => b.id === id);
const bakesFor = (recipeId) => state.bakes.filter((b) => b.recipeId === recipeId).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

/* ----------------------------------------------------------------------------
   Photos (IndexedDB)
---------------------------------------------------------------------------- */
const photos = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('No IndexedDB'));
      const req = indexedDB.open('bread-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async _tx(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      const store = tx.objectStore('photos');
      const req = fn(store);
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  put(id, blob) { return this._tx('readwrite', (s) => s.put(blob, id)); },
  get(id) { return this._tx('readonly', (s) => s.get(id)).catch(() => null); },
  del(id) { return this._tx('readwrite', (s) => s.delete(id)); },
  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const out = [];
      const req = db.transaction('photos', 'readonly').objectStore('photos').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out.push({ id: c.key, blob: c.value }); c.continue(); } else resolve(out); };
      req.onerror = () => reject(req.error);
    });
  }
};

// Shrink a camera photo before storing it (phones produce 5–20 MB files).
function shrinkImage(file, maxEdge = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode image')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

const objectUrls = new Set();
function trackUrl(blob) { const u = URL.createObjectURL(blob); objectUrls.add(u); return u; }
function releaseUrls() { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls.clear(); }

/* ----------------------------------------------------------------------------
   Recipe math
---------------------------------------------------------------------------- */
function guessRole(name) {
  const n = (name || '').toLowerCase();
  if (/flour|semolina|rye|spelt|einkorn|durum|cornmeal|starter|levain/.test(n)) return 'flour';
  if (/water|milk|buttermilk|beer|juice|egg/.test(n)) return 'liquid';
  return 'other';
}

function compute(recipe, loaves) {
  const base = Number(recipe.baseLoaves) || 1;
  loaves = Number(loaves) > 0 ? Number(loaves) : base;
  const factor = loaves / base;
  const ings = (recipe.ingredients || []).filter((i) => i && (i.name || Number(i.grams)));
  const flour = sum(ings.filter((i) => i.role === 'flour').map((i) => i.grams));
  const liquid = sum(ings.filter((i) => i.role === 'liquid').map((i) => i.grams));
  const total = sum(ings.map((i) => i.grams));
  const rows = ings.map((i) => ({
    ...i,
    scaled: (Number(i.grams) || 0) * factor,
    pct: flour > 0 ? (Number(i.grams) || 0) / flour * 100 : null
  }));
  return {
    loaves, factor, rows,
    flour: flour * factor,
    liquid: liquid * factor,
    total: total * factor,
    perLoaf: loaves > 0 ? total * factor / loaves : null,
    hydration: flour > 0 ? liquid / flour * 100 : null
  };
}

/* ----------------------------------------------------------------------------
   Rendering helpers
---------------------------------------------------------------------------- */
const view = $('#view');
const titleEl = $('#pageTitle');
const backBtn = $('#backBtn');
const actionsEl = $('#topActions');
let backTarget = null;
let cleanup = null;

function render(html, { title = 'Bread', back = null, actions = '', tab = null } = {}) {
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.warn(e); } }
  cleanup = null;
  releaseUrls();
  titleEl.textContent = title;
  document.title = title === 'Bread' ? 'Bread' : `${title} · Bread`;
  backTarget = back;
  backBtn.hidden = !back;
  actionsEl.innerHTML = actions;
  view.innerHTML = html;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  window.scrollTo(0, 0);
}
backBtn.addEventListener('click', () => { if (backTarget) location.hash = backTarget; });

let toastTimer = null;
function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action && onAction) $('button', el).addEventListener('click', () => { el.hidden = true; onAction(); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const ICON_PLUS = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_BREAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5C4 7.9 7.6 5 12 5s8 2.9 8 6.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 9.5l1.5-2M12 9l1.5-2M15.5 9.5l1.5-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function emptyState(title, text, cta) {
  return `<div class="empty">${ICON_BREAD}<h3>${esc(title)}</h3><p>${esc(text)}</p>${cta || ''}</div>`;
}

/* ----------------------------------------------------------------------------
   Router
---------------------------------------------------------------------------- */
function parseHash() {
  const raw = (location.hash || '#/recipes').slice(1);
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(queryPart || '') };
}

function route() {
  const { parts, query } = parseHash();
  const [a, b, c] = parts;
  if (!a || a === 'recipes') return viewRecipes();
  if (a === 'recipe' && b === 'new') return viewRecipeEditor(null);
  if (a === 'recipe' && b && c === 'edit') return viewRecipeEditor(b);
  if (a === 'recipe' && b) return viewRecipe(b);
  if (a === 'bakes') return viewBakes();
  if (a === 'bake' && b === 'new') return viewBakeEditor(null, query.get('recipe'));
  if (a === 'bake' && b && c === 'edit') return viewBakeEditor(b);
  if (a === 'bake' && b) return viewBake(b);
  if (a === 'more') return viewMore();
  location.hash = '#/recipes';
}
window.addEventListener('hashchange', route);

/* ----------------------------------------------------------------------------
   Recipes list
---------------------------------------------------------------------------- */
function viewRecipes() {
  const recipes = [...state.recipes].sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
  const cards = recipes.map((r) => {
    const c = compute(r, r.baseLoaves);
    const bakes = bakesFor(r.id);
    const last = bakes[0];
    return `<a class="item" href="#/recipe/${esc(r.id)}">
      <div class="item-head"><div class="item-title">${esc(r.name || 'Untitled')}</div>${c.hydration != null ? `<span class="badge">${fmtPct(c.hydration)} hydration</span>` : ''}</div>
      <div class="item-meta">${fmtNum(r.baseLoaves)} ${plural(r.baseLoaves, 'loaf', 'loaves')} · ${c.rows.length} ${plural(c.rows.length, 'ingredient')} · ${fmtG(c.total)} g dough</div>
      <div class="item-meta">${last ? `Last baked ${fmtDate(last.date)} ${last.rating ? '· ' + stars(last.rating) : ''}` : 'Not baked yet'}</div>
    </a>`;
  }).join('');

  render(`
    ${installBanner()}
    ${recipes.length ? `<div class="list">${cards}</div>` : emptyState('No recipes yet', 'Add your first recipe and scale it to any number of loaves.', '<a class="btn btn-primary" href="#/recipe/new">New recipe</a>')}
  `, { title: 'Recipes', tab: 'recipes', actions: `<a class="icon-btn accent" href="#/recipe/new" aria-label="New recipe">${ICON_PLUS}</a>` });
}

/* ----------------------------------------------------------------------------
   Recipe detail (scaling + ratios)
---------------------------------------------------------------------------- */
const scaleMemory = {};

function viewRecipe(id) {
  const r = getRecipe(id);
  if (!r) { toast('Recipe not found'); location.hash = '#/recipes'; return; }
  const loaves = scaleMemory[id] ?? Number(r.baseLoaves) ?? 1;
  const bakes = bakesFor(id).slice(0, 3);

  render(`
    <div class="hero">
      <h2>${esc(r.name)}</h2>
      <div class="muted">Base recipe makes ${fmtNum(r.baseLoaves)} ${plural(r.baseLoaves, 'loaf', 'loaves')}${compute(r, r.baseLoaves).hydration != null ? ` · ${fmtPct(compute(r, r.baseLoaves).hydration)} hydration` : ''}</div>
      <div class="actions">
        <a class="btn btn-primary" href="#/bake/new?recipe=${esc(id)}">Log a bake</a>
        <a class="btn btn-secondary" href="#/recipe/${esc(id)}/edit">Edit</a>
        <button class="btn btn-secondary" type="button" data-action="share">Share</button>
      </div>
    </div>

    <section class="scale">
      <div class="scale-label">How many loaves?</div>
      <div class="stepper">
        <button type="button" data-action="dec" aria-label="Fewer loaves">−</button>
        <input id="loaves" type="number" inputmode="decimal" min="0.25" step="0.5" value="${fmtNum(loaves)}" aria-label="Number of loaves">
        <button type="button" data-action="inc" aria-label="More loaves">+</button>
        <span class="unit" id="loafWord">${plural(loaves, 'loaf', 'loaves')}</span>
      </div>
      <div class="chips" id="chips">${[1, 2, 3, 4, 6].map((n) => `<button type="button" class="chip ${n === loaves ? 'active' : ''}" data-action="set" data-n="${n}">${n}</button>`).join('')}</div>
      <div id="scaleOut"></div>
    </section>

    <section class="card">
      <div class="card-kicker">Method &amp; notes</div>
      ${r.notes && r.notes.length ? `<dl class="dl">${r.notes.map((n) => `<div class="dr"><dt>${esc(n.label)}</dt><dd>${esc(n.value)}</dd></div>`).join('')}</dl>` : '<p class="muted">No notes yet. Tap Edit to add steps, temperatures and tips.</p>'}
    </section>

    <div class="section-h"><h2>Recent bakes</h2>${bakesFor(id).length > 3 ? '<a class="small" href="#/bakes">See all</a>' : ''}</div>
    ${bakes.length ? `<div class="list">${bakes.map(bakeItem).join('')}</div>` : `<p class="muted small" style="padding:0 4px">No bakes logged for this recipe yet.</p>`}

    <div class="danger-zone">
      <button class="btn btn-ghost btn-sm" type="button" data-action="duplicate">Duplicate recipe</button>
      <button class="btn btn-danger btn-sm" type="button" data-action="delete">Delete recipe</button>
    </div>
  `, { title: 'Recipe', back: '#/recipes', tab: 'recipes' });

  const input = $('#loaves');
  function current() { const v = parseFloat(input.value); return v > 0 ? v : Number(r.baseLoaves) || 1; }
  function update(v, { writeInput = true } = {}) {
    v = Math.round(clamp(v, 0.25, 99) * 100) / 100;
    scaleMemory[id] = v;
    if (writeInput) input.value = fmtNum(v);
    $('#loafWord').textContent = plural(v, 'loaf', 'loaves');
    $$('#chips .chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.n) === v));
    $('#scaleOut').innerHTML = scaleTable(r, v);
  }
  update(loaves);

  input.addEventListener('input', () => { const v = parseFloat(input.value); if (v > 0) update(v, { writeInput: false }); });
  input.addEventListener('blur', () => update(current()));

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'inc') update(current() + 1);
    else if (act === 'dec') update(current() - 1);
    else if (act === 'set') update(Number(btn.dataset.n));
    else if (act === 'share') shareRecipe(r, current());
    else if (act === 'duplicate') {
      const copy = JSON.parse(JSON.stringify(r));
      copy.id = uid(); copy.name = `${r.name} (copy)`;
      copy.createdAt = copy.updatedAt = new Date().toISOString();
      copy.ingredients.forEach((i) => { i.id = uid(); });
      (copy.notes || []).forEach((n) => { n.id = uid(); });
      state.recipes.push(copy); persist();
      toast('Recipe duplicated');
      location.hash = `#/recipe/${copy.id}/edit`;
    } else if (act === 'delete') {
      const n = bakesFor(id).length;
      if (!confirm(`Delete "${r.name}"?${n ? ` Its ${n} logged ${plural(n, 'bake')} will be kept.` : ''}`)) return;
      state.recipes = state.recipes.filter((x) => x.id !== id); persist();
      toast('Recipe deleted');
      location.hash = '#/recipes';
    }
  });
}

function scaleTable(r, loaves) {
  const c = compute(r, loaves);
  if (!c.rows.length) return '<p class="muted small mt">Add ingredients to see amounts.</p>';
  return `
    <div class="stats">
      <div class="stat"><div class="v">${fmtG(c.flour)} g</div><div class="k">Total flour</div></div>
      <div class="stat"><div class="v">${c.hydration != null ? fmtPct(c.hydration) : '–'}</div><div class="k">Hydration</div></div>
      <div class="stat"><div class="v">${fmtG(c.total)} g</div><div class="k">Total dough</div></div>
      <div class="stat"><div class="v">${fmtG(c.perLoaf)} g</div><div class="k">Per loaf</div></div>
    </div>
    <div class="card" style="margin:14px 0 0">
      <table class="table">
        <thead><tr><th>Ingredient</th><th class="num">for ${fmtNum(loaves)} ${plural(loaves, 'loaf', 'loaves')}</th><th class="num">baker's %</th></tr></thead>
        <tbody>
          ${c.rows.map((row) => `<tr>
            <td><span class="role-dot ${esc(row.role)}"></span>${esc(row.name)}</td>
            <td class="num g">${fmtG(row.scaled)} g</td>
            <td class="num pct">${fmtPct(row.pct)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total dough</td><td class="num">${fmtG(c.total)} g</td><td class="num"></td></tr></tfoot>
      </table>
      <p class="help" style="margin:10px 0 0">Baker's % = each ingredient ÷ total flour. <span class="role-dot flour"></span>flour <span class="role-dot liquid"></span>liquid (counts toward hydration)</p>
    </div>`;
}

function recipeText(r, loaves) {
  const c = compute(r, loaves);
  const lines = [`${r.name} — ${fmtNum(c.loaves)} ${plural(c.loaves, 'loaf', 'loaves')}${c.hydration != null ? ` (${fmtPct(c.hydration)} hydration)` : ''}`, ''];
  c.rows.forEach((row) => lines.push(`${row.name}: ${fmtG(row.scaled)} g${row.pct != null ? ` (${fmtPct(row.pct)})` : ''}`));
  lines.push(`Total dough: ${fmtG(c.total)} g`);
  if (r.notes && r.notes.length) { lines.push('', 'Method:'); r.notes.forEach((n) => lines.push(`• ${n.label}: ${n.value}`)); }
  return lines.join('\n');
}

async function shareRecipe(r, loaves) {
  const text = recipeText(r, loaves);
  try {
    if (navigator.share) { await navigator.share({ title: r.name, text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Recipe copied to clipboard');
  } catch (e) { if (e && e.name !== 'AbortError') toast('Could not share'); }
}

/* ----------------------------------------------------------------------------
   Recipe editor
---------------------------------------------------------------------------- */
function viewRecipeEditor(id) {
  const existing = id ? getRecipe(id) : null;
  if (id && !existing) { toast('Recipe not found'); location.hash = '#/recipes'; return; }
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), name: '', baseLoaves: 2,
    ingredients: [{ id: uid(), name: '', grams: '', role: 'flour' }, { id: uid(), name: '', grams: '', role: 'liquid' }, { id: uid(), name: '', grams: '', role: 'other' }],
    notes: [{ id: uid(), label: '', value: '' }]
  };
  draft.notes = draft.notes || [];

  const back = existing ? `#/recipe/${existing.id}` : '#/recipes';

  function ingRow(i, idx, n) {
    return `<div class="ing-row" data-idx="${idx}">
      <div class="top">
        <input class="input" data-f="name" placeholder="Ingredient" value="${esc(i.name)}" autocapitalize="sentences">
        <div class="grams"><input class="input" data-f="grams" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${esc(i.grams)}"></div>
        <button class="mini x" type="button" data-action="ing-remove" aria-label="Remove ingredient">✕</button>
      </div>
      <div class="bottom">
        <div class="seg" role="group" aria-label="Ingredient type">
          <button type="button" data-action="role" data-role="flour" class="${i.role === 'flour' ? 'active' : ''}">Flour</button>
          <button type="button" data-action="role" data-role="liquid" class="${i.role === 'liquid' ? 'active liquid' : ''}">Liquid</button>
          <button type="button" data-action="role" data-role="other" class="${i.role === 'other' ? 'active other' : ''}">Other</button>
        </div>
        <div class="row" style="gap:4px">
          <button class="mini" type="button" data-action="ing-up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="mini" type="button" data-action="ing-down" aria-label="Move down" ${idx === n - 1 ? 'disabled' : ''}>↓</button>
        </div>
      </div>
    </div>`;
  }
  function noteRow(nt, idx, n) {
    return `<div class="note-row" data-idx="${idx}">
      <div class="top">
        <input class="input" data-f="label" placeholder="Label (e.g. Oven temp)" value="${esc(nt.label)}">
        <button class="mini x" type="button" data-action="note-remove" aria-label="Remove note">✕</button>
      </div>
      <textarea class="input" data-f="value" placeholder="Details" rows="2">${esc(nt.value)}</textarea>
      <div class="row" style="gap:4px;justify-content:flex-end">
        <button class="mini" type="button" data-action="note-up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="mini" type="button" data-action="note-down" aria-label="Move down" ${idx === n - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </div>`;
  }

  function renderLists() {
    $('#ings').innerHTML = draft.ingredients.map((i, idx) => ingRow(i, idx, draft.ingredients.length)).join('');
    $('#notes').innerHTML = draft.notes.map((n, idx) => noteRow(n, idx, draft.notes.length)).join('');
    $('#liveSummary').innerHTML = liveSummary();
  }
  function liveSummary() {
    const c = compute(draft, draft.baseLoaves);
    if (!c.rows.length) return '';
    return `<span class="badge">${c.hydration != null ? fmtPct(c.hydration) + ' hydration' : 'no flour yet'}</span> <span class="badge plain">${fmtG(c.total)} g dough</span> <span class="badge plain">${fmtG(c.perLoaf)} g / loaf</span>`;
  }

  render(`
    <form id="recipeForm" class="stack" autocomplete="off" novalidate>
      <div class="card stack">
        <div class="field"><label for="rName">Recipe name</label><input id="rName" class="input" value="${esc(draft.name)}" placeholder="e.g. Sandwich Bread" autocapitalize="words" required></div>
        <div class="field"><label for="rBase">These amounts make how many loaves?</label><input id="rBase" class="input" type="number" inputmode="decimal" min="0.25" step="0.5" value="${esc(draft.baseLoaves)}" required></div>
        <div id="liveSummary" class="row wrap" style="gap:6px"></div>
      </div>

      <div class="section-h"><h2>Ingredients</h2><span class="small muted">grams</span></div>
      <div id="ings" class="stack"></div>
      <button class="btn btn-secondary" type="button" data-action="ing-add">+ Add ingredient</button>
      <p class="help">Mark flours and liquids so hydration and baker's percentages come out right. Count honey, butter, salt and yeast as "Other".</p>

      <div class="section-h"><h2>Method &amp; notes</h2></div>
      <div id="notes" class="stack"></div>
      <button class="btn btn-secondary" type="button" data-action="note-add">+ Add note</button>
      <p class="help">Anything you want to remember: water temperature, folds, proof time, oven schedule, what to test next.</p>

      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit">Save recipe</button>
        <a class="btn btn-ghost btn-block" href="${back}">Cancel</a>
      </div>
    </form>
  `, { title: existing ? 'Edit recipe' : 'New recipe', back, tab: 'recipes' });
  renderLists();

  const form = $('#recipeForm');
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'rName') draft.name = t.value;
    else if (t.id === 'rBase') { draft.baseLoaves = t.value; $('#liveSummary').innerHTML = liveSummary(); }
    else if (t.dataset.f) {
      const rowEl = t.closest('[data-idx]'); const idx = Number(rowEl.dataset.idx);
      const list = rowEl.classList.contains('ing-row') ? draft.ingredients : draft.notes;
      list[idx][t.dataset.f] = t.value;
      if (t.dataset.f === 'name' && !rowEl.dataset.roleTouched) {
        const g = guessRole(t.value);
        if (g !== list[idx].role) { list[idx].role = g; $$('.seg button', rowEl).forEach((b) => { b.className = b.dataset.role === g ? `active ${g === 'flour' ? '' : g}` : ''; }); }
      }
      if (rowEl.classList.contains('ing-row')) $('#liveSummary').innerHTML = liveSummary();
    }
  });

  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const act = btn.dataset.action;
    const rowEl = btn.closest('[data-idx]'); const idx = rowEl ? Number(rowEl.dataset.idx) : -1;
    const swap = (list, a, b) => { [list[a], list[b]] = [list[b], list[a]]; };
    if (act === 'ing-add') { draft.ingredients.push({ id: uid(), name: '', grams: '', role: 'other' }); renderLists(); $$('#ings .ing-row').pop().querySelector('input').focus(); }
    else if (act === 'ing-remove') { draft.ingredients.splice(idx, 1); renderLists(); }
    else if (act === 'ing-up' && idx > 0) { swap(draft.ingredients, idx, idx - 1); renderLists(); }
    else if (act === 'ing-down' && idx < draft.ingredients.length - 1) { swap(draft.ingredients, idx, idx + 1); renderLists(); }
    else if (act === 'role') { draft.ingredients[idx].role = btn.dataset.role; rowEl.dataset.roleTouched = '1'; $$('.seg button', rowEl).forEach((b) => { b.className = b === btn ? `active ${btn.dataset.role === 'flour' ? '' : btn.dataset.role}` : ''; }); $('#liveSummary').innerHTML = liveSummary(); }
    else if (act === 'note-add') { draft.notes.push({ id: uid(), label: '', value: '' }); renderLists(); $$('#notes .note-row').pop().querySelector('input').focus(); }
    else if (act === 'note-remove') { draft.notes.splice(idx, 1); renderLists(); }
    else if (act === 'note-up' && idx > 0) { swap(draft.notes, idx, idx - 1); renderLists(); }
    else if (act === 'note-down' && idx < draft.notes.length - 1) { swap(draft.notes, idx, idx + 1); renderLists(); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (draft.name || '').trim();
    const base = parseFloat(draft.baseLoaves);
    if (!name) { toast('Give the recipe a name'); $('#rName').focus(); return; }
    if (!(base > 0)) { toast('Base loaf count must be greater than 0'); $('#rBase').focus(); return; }
    const ingredients = draft.ingredients
      .map((i) => ({ id: i.id || uid(), name: (i.name || '').trim(), grams: parseFloat(i.grams) || 0, role: ['flour', 'liquid', 'other'].includes(i.role) ? i.role : 'other' }))
      .filter((i) => i.name || i.grams > 0);
    if (!ingredients.length) { toast('Add at least one ingredient'); return; }
    const notes = draft.notes
      .map((n) => ({ id: n.id || uid(), label: (n.label || '').trim(), value: (n.value || '').trim() }))
      .filter((n) => n.label || n.value);
    const now = new Date().toISOString();
    const recipe = { id: draft.id, name, baseLoaves: base, ingredients, notes, createdAt: existing ? existing.createdAt : now, updatedAt: now };
    const i = state.recipes.findIndex((r) => r.id === recipe.id);
    if (i >= 0) state.recipes[i] = recipe; else state.recipes.push(recipe);
    persist();
    delete scaleMemory[recipe.id];
    toast(existing ? 'Recipe saved' : 'Recipe created');
    location.hash = `#/recipe/${recipe.id}`;
  });
}

/* ----------------------------------------------------------------------------
   Bakes (journal)
---------------------------------------------------------------------------- */
function bakeItem(b) {
  const r = getRecipe(b.recipeId);
  const name = r ? r.name : (b.recipeName || 'Deleted recipe');
  const thumbId = b.photoIds && b.photoIds[0];
  const bits = [`${fmtNum(b.loaves)} ${plural(b.loaves, 'loaf', 'loaves')}`];
  if (b.internalTemp) bits.push(`${esc(b.internalTemp)} internal`);
  if (b.oven) bits.push(esc(b.oven));
  return `<a class="item ${thumbId ? 'item-with-thumb' : ''}" href="#/bake/${esc(b.id)}">
    ${thumbId ? `<img class="thumb" data-photo="${esc(thumbId)}" alt="">` : ''}
    <div>
      <div class="item-head"><div class="item-title">${esc(name)}</div>${b.rating ? stars(b.rating) : ''}</div>
      <div class="item-meta">${fmtDate(b.date)} · ${bits.join(' · ')}</div>
      ${b.notes ? `<div class="item-meta" style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(b.notes)}</div>` : ''}
    </div>
  </a>`;
}

async function hydrateThumbs() {
  for (const img of $$('img[data-photo]')) {
    const blob = await photos.get(img.dataset.photo);
    if (blob && img.isConnected) img.src = trackUrl(blob);
  }
}

function viewBakes() {
  const bakes = [...state.bakes].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const hasRecipes = state.recipes.length > 0;
  render(`
    ${bakes.length ? `<div class="list">${bakes.map(bakeItem).join('')}</div>` : emptyState('No bakes yet', 'Every time you bake, log the loaves, temperatures, how it turned out and what to try next.', hasRecipes ? '<a class="btn btn-primary" href="#/bake/new">Log a bake</a>' : '<a class="btn btn-primary" href="#/recipe/new">Add a recipe first</a>')}
  `, { title: 'Bakes', tab: 'bakes', actions: hasRecipes ? `<a class="icon-btn accent" href="#/bake/new" aria-label="Log a bake">${ICON_PLUS}</a>` : '' });
  hydrateThumbs();
}

function viewBake(id) {
  const b = getBake(id);
  if (!b) { toast('Bake not found'); location.hash = '#/bakes'; return; }
  const r = getRecipe(b.recipeId);
  const name = r ? r.name : (b.recipeName || 'Deleted recipe');
  const fields = [
    ['Loaves', fmtNum(b.loaves)],
    ['Water temp', b.waterTemp], ['Proof', b.proofTime], ['Oven', b.oven], ['Internal temp', b.internalTemp]
  ].filter(([, v]) => v);

  render(`
    <div class="hero">
      <h2>${esc(name)}</h2>
      <div class="muted">${fmtDate(b.date)}${b.rating ? ' · ' : ''}${b.rating ? stars(b.rating) : ''}</div>
      <div class="actions">
        <a class="btn btn-secondary" href="#/bake/${esc(id)}/edit">Edit</a>
        ${r ? `<a class="btn btn-ghost" href="#/recipe/${esc(r.id)}">Open recipe</a>` : ''}
      </div>
    </div>
    ${b.photoIds && b.photoIds.length ? `<div class="photos mb">${b.photoIds.map((p) => `<button class="photo" type="button" data-view-photo="${esc(p)}"><img data-photo="${esc(p)}" alt="Bake photo"></button>`).join('')}</div>` : ''}
    <div class="card">
      <div class="card-kicker">Bake details</div>
      ${fields.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join('')}
    </div>
    ${b.notes ? `<div class="card"><div class="card-kicker">How it went</div><p style="white-space:pre-wrap;margin:0">${esc(b.notes)}</p></div>` : ''}
    ${b.nextTime ? `<div class="card"><div class="card-kicker">Next time</div><p style="white-space:pre-wrap;margin:0">${esc(b.nextTime)}</p></div>` : ''}
    ${b.snapshot && b.snapshot.length ? `<div class="card"><div class="card-kicker">Amounts used${b.hydration != null ? ` · ${fmtPct(b.hydration)} hydration` : ''}</div>
      <table class="table"><tbody>${b.snapshot.map((s) => `<tr><td>${esc(s.name)}</td><td class="num g">${fmtG(s.grams)} g</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="danger-zone"><button class="btn btn-danger btn-sm" type="button" data-action="delete">Delete bake</button></div>
  `, { title: 'Bake', back: '#/bakes', tab: 'bakes' });
  hydrateThumbs();

  view.addEventListener('click', async (e) => {
    const ph = e.target.closest('[data-view-photo]');
    if (ph) { const blob = await photos.get(ph.dataset.viewPhoto); if (blob) openLightbox(trackUrl(blob)); return; }
    const btn = e.target.closest('[data-action="delete"]');
    if (btn) {
      if (!confirm('Delete this bake entry?')) return;
      for (const p of b.photoIds || []) { try { await photos.del(p); } catch {} }
      state.bakes = state.bakes.filter((x) => x.id !== id); persist();
      toast('Bake deleted');
      location.hash = '#/bakes';
    }
  });
}

function openLightbox(url) {
  const lb = $('#lightbox'); $('img', lb).src = url; lb.hidden = false;
}
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

function viewBakeEditor(id, presetRecipeId) {
  const existing = id ? getBake(id) : null;
  if (id && !existing) { toast('Bake not found'); location.hash = '#/bakes'; return; }
  if (!state.recipes.length) { toast('Add a recipe first'); location.hash = '#/recipe/new'; return; }
  const firstRecipe = getRecipe(presetRecipeId) || state.recipes[0];
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), recipeId: firstRecipe.id, date: todayISO(), loaves: scaleMemory[firstRecipe.id] ?? firstRecipe.baseLoaves,
    waterTemp: '', proofTime: '', oven: '', internalTemp: '', rating: 0, notes: '', nextTime: '', photoIds: []
  };
  draft.photoIds = draft.photoIds || [];
  const addedPhotos = new Set();   // new this session (deleted if cancelled)
  const removedPhotos = new Set(); // removed this session (deleted on save)
  const back = existing ? `#/bake/${existing.id}` : (presetRecipeId ? `#/recipe/${presetRecipeId}` : '#/bakes');

  const recipeOpts = state.recipes.map((r) => `<option value="${esc(r.id)}" ${r.id === draft.recipeId ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const prefillOven = (() => { const r = getRecipe(draft.recipeId); const n = r && (r.notes || []).find((x) => /oven/i.test(x.label)); return n ? n.value : ''; })();

  render(`
    <form id="bakeForm" class="stack" autocomplete="off" novalidate>
      <div class="card stack">
        <div class="field"><label for="bRecipe">Recipe</label><select id="bRecipe" class="input">${recipeOpts}</select></div>
        <div class="grid-2">
          <div class="field"><label for="bDate">Date</label><input id="bDate" class="input" type="date" value="${esc(draft.date)}"></div>
          <div class="field"><label for="bLoaves">Loaves</label><input id="bLoaves" class="input" type="number" inputmode="decimal" min="0.25" step="0.5" value="${esc(fmtNum(draft.loaves))}"></div>
        </div>
        <div id="bakeAmounts" class="small muted"></div>
      </div>

      <div class="card stack">
        <div class="card-kicker">Measurements</div>
        <div class="grid-2">
          <div class="field"><label for="bWater">Water temp</label><input id="bWater" class="input" value="${esc(draft.waterTemp)}" placeholder="98 °F"></div>
          <div class="field"><label for="bProof">Final proof</label><input id="bProof" class="input" value="${esc(draft.proofTime)}" placeholder="2 h 15 min"></div>
        </div>
        <div class="field"><label for="bOven">Oven schedule</label><input id="bOven" class="input" value="${esc(draft.oven)}" placeholder="${esc(prefillOven || '375 °F 35 min, then 400 °F 20 min')}"></div>
        <div class="field"><label for="bInternal">Internal temp when done</label><input id="bInternal" class="input" value="${esc(draft.internalTemp)}" placeholder="208 °F"></div>
      </div>

      <div class="card stack">
        <div class="card-kicker">Result</div>
        <div class="field"><span class="label">Rating</span>
          <div class="rating" id="rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${draft.rating >= n ? 'on' : ''}" aria-label="${n} of 5">★</button>`).join('')}</div>
        </div>
        <div class="field"><label for="bNotes">How it went</label><textarea id="bNotes" class="input" placeholder="Crumb, crust, rise, taste…">${esc(draft.notes)}</textarea></div>
        <div class="field"><label for="bNext">Next time, try…</label><textarea id="bNext" class="input" placeholder="e.g. 400 °F for 35 min, then 400 °F for 20 min">${esc(draft.nextTime)}</textarea></div>
      </div>

      <div class="card stack">
        <div class="card-kicker">Photos</div>
        <div class="photos" id="photoGrid"></div>
        <input id="photoInput" type="file" accept="image/*" multiple hidden>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-block" type="submit">Save bake</button>
        <button class="btn btn-ghost btn-block" type="button" data-action="cancel">Cancel</button>
      </div>
    </form>
  `, { title: existing ? 'Edit bake' : 'Log a bake', back, tab: 'bakes' });

  function amountsLine() {
    const r = getRecipe($('#bRecipe').value); const l = parseFloat($('#bLoaves').value);
    if (!r || !(l > 0)) return '';
    const c = compute(r, l);
    return `For ${fmtNum(l)} ${plural(l, 'loaf', 'loaves')}: ` + c.rows.map((x) => `${esc(x.name)} ${fmtG(x.scaled)} g`).join(' · ');
  }
  function refreshAmounts() { $('#bakeAmounts').innerHTML = amountsLine(); }
  refreshAmounts();

  async function renderPhotos() {
    const grid = $('#photoGrid');
    const tiles = await Promise.all(draft.photoIds.map(async (p) => {
      const blob = await photos.get(p);
      return `<div class="photo" data-id="${esc(p)}">${blob ? `<img src="${trackUrl(blob)}" alt="">` : ''}<button class="rm" type="button" data-action="photo-remove" aria-label="Remove photo">✕</button></div>`;
    }));
    grid.innerHTML = tiles.join('') + `<button class="photo-add" type="button" data-action="photo-add"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>Add photo</button>`;
  }
  renderPhotos();

  const form = $('#bakeForm');
  form.addEventListener('input', (e) => { if (e.target.id === 'bLoaves') refreshAmounts(); });
  form.addEventListener('change', (e) => {
    if (e.target.id === 'bRecipe') {
      const r = getRecipe(e.target.value);
      if (r && !existing) $('#bLoaves').value = fmtNum(r.baseLoaves);
      refreshAmounts();
    }
    if (e.target.id === 'photoInput') {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      toast(`Adding ${files.length} ${plural(files.length, 'photo')}…`);
      (async () => {
        for (const f of files) {
          try { const blob = await shrinkImage(f); const pid = uid(); await photos.put(pid, blob); draft.photoIds.push(pid); addedPhotos.add(pid); }
          catch (err) { console.error(err); toast('Could not add a photo'); }
        }
        renderPhotos();
      })();
    }
  });
  form.addEventListener('click', async (e) => {
    const star = e.target.closest('#rating button');
    if (star) { const n = Number(star.dataset.n); draft.rating = draft.rating === n ? 0 : n; $$('#rating button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) <= draft.rating)); return; }
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'photo-add') $('#photoInput').click();
    else if (act === 'photo-remove') { const pid = btn.closest('.photo').dataset.id; draft.photoIds = draft.photoIds.filter((x) => x !== pid); if (addedPhotos.has(pid)) { addedPhotos.delete(pid); await photos.del(pid); } else removedPhotos.add(pid); renderPhotos(); }
    else if (act === 'cancel') { for (const p of addedPhotos) { try { await photos.del(p); } catch {} } location.hash = back; }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = getRecipe($('#bRecipe').value);
    const loaves = parseFloat($('#bLoaves').value);
    if (!r) { toast('Pick a recipe'); return; }
    if (!(loaves > 0)) { toast('Loaves must be greater than 0'); return; }
    const c = compute(r, loaves);
    const now = new Date().toISOString();
    const bake = {
      id: draft.id, recipeId: r.id, recipeName: r.name,
      date: $('#bDate').value || todayISO(), loaves,
      waterTemp: $('#bWater').value.trim(), proofTime: $('#bProof').value.trim(), oven: $('#bOven').value.trim(), internalTemp: $('#bInternal').value.trim(),
      rating: draft.rating || 0, notes: $('#bNotes').value.trim(), nextTime: $('#bNext').value.trim(),
      photoIds: draft.photoIds,
      snapshot: c.rows.map((x) => ({ name: x.name, grams: Math.round(x.scaled * 10) / 10 })), hydration: c.hydration,
      createdAt: existing ? existing.createdAt : now, updatedAt: now
    };
    for (const p of removedPhotos) { try { await photos.del(p); } catch {} }
    const i = state.bakes.findIndex((x) => x.id === bake.id);
    if (i >= 0) state.bakes[i] = bake; else state.bakes.push(bake);
    persist();
    toast(existing ? 'Bake saved' : 'Bake logged');
    location.hash = `#/bake/${bake.id}`;
  });
}

/* ----------------------------------------------------------------------------
   More: install, backup, about
---------------------------------------------------------------------------- */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (parseHash().parts[0] === 'more' || !location.hash) route(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Bread is on your home screen'); route(); });

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installBanner() {
  if (isStandalone() || localStorage.getItem('bread.hideInstall')) return '';
  if (!installPrompt && !isIOS()) return '';
  return `<div class="banner"><img src="icons/icon-192.png" alt=""><div class="t"><b>Add Bread to your home screen</b>${isIOS() ? 'Tap Share, then "Add to Home Screen".' : 'Works offline, opens like an app.'}</div>${installPrompt ? '<button class="btn btn-sm btn-primary" type="button" data-action="install">Install</button>' : ''}<button class="icon-btn" type="button" data-action="hide-install" aria-label="Dismiss">✕</button></div>`;
}
view.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="install"],[data-action="hide-install"]');
  if (!btn) return;
  if (btn.dataset.action === 'hide-install') { localStorage.setItem('bread.hideInstall', '1'); route(); return; }
  if (installPrompt) { installPrompt.prompt(); try { await installPrompt.userChoice; } catch {} installPrompt = null; route(); }
});

function viewMore() {
  const nRecipes = state.recipes.length, nBakes = state.bakes.length;
  const installText = isStandalone()
    ? '<p class="muted">Installed — you are using Bread from your home screen.</p>'
    : isIOS()
      ? '<p>On iPhone: open this page in <b>Safari</b>, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>'
      : installPrompt
        ? '<p>Install Bread so it opens full screen and works offline.</p><button class="btn btn-primary" type="button" data-action="install">Install app</button>'
        : '<p>On Android: open this page in <b>Chrome</b>, tap the <b>⋮</b> menu, then <b>Add to Home screen</b> (or <b>Install app</b>).</p>';

  render(`
    <div class="card">
      <div class="card-kicker">Install</div>
      ${installText}
    </div>
    <div class="card stack">
      <div class="card-kicker">Backup</div>
      <p class="small muted" style="margin:0">Everything is stored on this phone only. Export a backup now and then, and import it on a new phone.</p>
      <div class="kv"><span class="k">Recipes</span><span>${nRecipes}</span></div>
      <div class="kv"><span class="k">Bakes</span><span>${nBakes}</span></div>
      <button class="btn btn-secondary" type="button" data-action="export">Export backup file</button>
      ${navigator.share ? '<button class="btn btn-secondary" type="button" data-action="share-backup">Share backup…</button>' : ''}
      <button class="btn btn-secondary" type="button" data-action="import">Import backup</button>
      <input id="importInput" type="file" accept="application/json,.json" hidden>
    </div>
    <div class="card stack">
      <div class="card-kicker">Appearance</div>
      <div class="row wrap" style="gap:6px">
        ${['auto', 'light', 'dark'].map((t) => `<button type="button" class="chip plain ${(state.settings.theme || 'auto') === t ? 'active' : ''}" data-action="theme" data-theme="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
    </div>
    <div class="card stack">
      <div class="card-kicker">About</div>
      <div class="kv"><span class="k">Version</span><span>${APP_VERSION}</span></div>
      <div class="kv"><span class="k">Source</span><a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a></div>
      <button class="btn btn-ghost" type="button" data-action="restore-sample">Restore the sample recipe</button>
      <button class="btn btn-danger" type="button" data-action="reset">Erase all data on this device</button>
    </div>
  `, { title: 'More', tab: 'more' });

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'export') await exportBackup('download');
    else if (act === 'share-backup') await exportBackup('share');
    else if (act === 'import') $('#importInput').click();
    else if (act === 'theme') { state.settings.theme = btn.dataset.theme; persist(); applyTheme(); route(); }
    else if (act === 'restore-sample') {
      const s = sampleRecipe();
      if (getRecipe(s.id) && !confirm('Replace your edited "Sandwich Bread" with the original sample?')) return;
      state.recipes = state.recipes.filter((r) => r.id !== s.id); state.recipes.unshift(s); persist();
      toast('Sample recipe restored'); location.hash = `#/recipe/${s.id}`;
    } else if (act === 'reset') {
      if (!confirm('Erase ALL recipes, bakes and photos on this device? This cannot be undone.')) return;
      if (!confirm('Really erase everything?')) return;
      try { for (const { id } of await photos.getAll()) await photos.del(id); } catch {}
      localStorage.removeItem(STORE_KEY); localStorage.removeItem('bread.hideInstall');
      state = loadState(); toast('All data erased'); location.hash = '#/recipes';
    }
  });
  $('#importInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (f) await importBackup(f);
  });
}

function applyTheme() {
  const t = state.settings.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

async function exportBackup(mode) {
  toast('Preparing backup…');
  const all = await photos.getAll().catch(() => []);
  const used = new Set(state.bakes.flatMap((b) => b.photoIds || []));
  const photoData = [];
  for (const { id, blob } of all) {
    if (!used.has(id)) continue;
    photoData.push({ id, type: blob.type || 'image/jpeg', data: await blobToBase64(blob) });
  }
  const payload = { app: 'bread', version: 1, exportedAt: new Date().toISOString(), recipes: state.recipes, bakes: state.bakes, settings: state.settings, photos: photoData };
  const json = JSON.stringify(payload);
  const name = `bread-backup-${todayISO()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (mode === 'share' && navigator.share) {
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Bread backup' });
      else await navigator.share({ title: 'Bread backup', text: json });
      return;
    } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Saved ${name}`);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1]); fr.onerror = reject; fr.readAsDataURL(blob); });
}
function base64ToBlob(b64, type) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file is not a Bread backup'); return; }
  if (!data || data.app !== 'bread' || !Array.isArray(data.recipes)) { toast('That file is not a Bread backup'); return; }
  const nR = data.recipes.length, nB = (data.bakes || []).length;
  if (!confirm(`Import ${nR} ${plural(nR, 'recipe')} and ${nB} ${plural(nB, 'bake')}? Entries with the same id are replaced; everything else is kept.`)) return;
  const upsert = (list, items) => { for (const it of items) { const i = list.findIndex((x) => x.id === it.id); if (i >= 0) list[i] = it; else list.push(it); } };
  upsert(state.recipes, data.recipes);
  upsert(state.bakes, data.bakes || []);
  state.settings = { ...state.settings, ...(data.settings || {}) };
  persist(); applyTheme();
  let nP = 0;
  for (const p of data.photos || []) { try { await photos.put(p.id, base64ToBlob(p.data, p.type)); nP++; } catch (e) { console.warn(e); } }
  toast(`Imported ${nR} ${plural(nR, 'recipe')}, ${nB} ${plural(nB, 'bake')}${nP ? `, ${nP} ${plural(nP, 'photo')}` : ''}`);
  location.hash = '#/recipes'; route();
}

/* ----------------------------------------------------------------------------
   Service worker + boot
---------------------------------------------------------------------------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update ready', { action: 'Reload', ms: 15000, onAction: () => nw.postMessage('skipWaiting') });
          }
        });
      });
    }).catch((e) => console.warn('Service worker not registered', e));
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  });
}

applyTheme();
route();
