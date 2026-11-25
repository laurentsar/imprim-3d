// Imprim 3D — modèles (Printables / Thingiverse / MakerWorld / liens) → aperçu 3D
// → tranchage CuraEngine (WASM) profil Ender 3 → envoi OctoPrint.
import { SOURCES, allSources, parseLink, downloadModel } from './sources.js';
import { loadModel, prepare, bounds, bestFlatRotation, toBinarySTL, concat } from './mesh.js';
import { curaSettings, filamentGrams, MATERIALS, QUALITIES, DEFAULT_OPTS } from './slicer-settings.js';
import { OctoPrint } from './octoprint.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

// ---------------- réglages ----------------
const CFG_KEY = 'imprim3d:cfg';
const cfg = Object.assign({
  octoUrl: 'http://192.168.1.91:5000', octoKey: '', cam: 'http://192.168.1.91:5001/snapshot', tvToken: '', bed: 220,
  slice: { ...DEFAULT_OPTS },
}, (() => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } })());
const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* stockage indisponible */ } };
const octo = () => new OctoPrint(cfg.octoUrl, cfg.octoKey);

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' Mo' : Math.max(1, Math.round(b / 1e3)) + ' ko';
const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`; };
const htmlToText = h => { const d = new DOMParser().parseFromString(String(h || ''), 'text/html'); d.querySelectorAll('br,p,li,h1,h2,h3,h4').forEach(e => e.append('\n')); return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };

// ---------------- onglets ----------------
let curTab = 'models';
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(t) {
  curTab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t));
  if (t === 'library') renderLibrary();
  if (t === 'printer') refreshPrinter(true);
}

// Bouton retour Android : ferme la feuille ouverte au lieu de quitter.
const sheets = [];
// replace : la feuille remplace celle du dessus (une seule entrée d'historique).
function openSheet(id, replace = false) {
  if (replace && sheets.length) { const top = sheets.pop(); $(top).hidden = true; if (top === 'atelier') atelierClose(); }
  $(id).hidden = false;
  if (!sheets.includes(id)) sheets.push(id);
  if (replace) history.replaceState({ sheet: id }, ''); else history.pushState({ sheet: id }, '');
}
function closeSheet(id, fromPop = false) {
  $(id).hidden = true;
  const i = sheets.indexOf(id);
  if (i >= 0) sheets.splice(i, 1);
  if (id === 'atelier') atelierClose();
  if (!fromPop) history.back();
}
window.addEventListener('popstate', () => { const id = sheets[sheets.length - 1]; if (id) closeSheet(id, true); });
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet(b.closest('.sheet').id)));

// ---------------- bibliothèque locale (IndexedDB) ----------------
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('imprim3d', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('models', { keyPath: 'id' });
      r.onsuccess = () => { this._db = r.result; res(this._db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('models', mode);
      const st = t.objectStore('models');
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  put(m) { return this.tx('readwrite', s => s.put(m)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  all() { return this.tx('readonly', s => s.getAll()); },
};
async function keepFile(name, data, meta = {}) {
  const id = (meta.src || 'local') + ':' + (meta.fileId || name) + ':' + data.byteLength;
  await DB.put({ id, name, data, size: data.byteLength, date: Date.now(), ...meta });
  if (curTab === 'library') renderLibrary();
  return id;
}

async function renderLibrary() {
  let all = [];
  try { all = (await DB.all()).sort((a, b) => b.date - a.date); } catch (e) { toast('Stockage local indisponible'); }
  $('libEmpty').hidden = all.length > 0;
  $('libList').innerHTML = all.map(m => `
    <div class="item" data-id="${esc(m.id)}">
      ${m.preview ? `<img src="${esc(m.preview)}" alt="" loading="lazy">` : '<div class="ph">🧊</div>'}
      <div class="body"><div class="name">${esc(m.name)}</div>
        <div class="meta">${esc(m.model || '')}${m.model ? ' · ' : ''}${fmtSize(m.size)} · ${new Date(m.date).toLocaleDateString('fr-FR')}</div></div>
      <div class="acts"><button data-act="open" class="primary">✂️</button><button data-act="del">🗑️</button></div>
    </div>`).join('');
}
$('libList').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = b.closest('.item').dataset.id;
  if (b.dataset.act === 'del') {
    if (!confirm('Supprimer ce fichier de l\'appli ?')) return;
    await DB.del(id);
    renderLibrary();
  } else {
    const m = await DB.get(id);
    if (m) openAtelier(m.name, m.data, m.model || '', { litho: m.src === 'litho' });
  }
});
$('fileInput').addEventListener('change', async e => {
  const fromDetail = !$('detail').hidden;
  const one = e.target.files.length === 1;
  if (fromDetail) { showTab('library'); if (!one) closeSheet('detail'); }
  for (const f of e.target.files) {
    const data = await f.arrayBuffer();
    await keepFile(f.name, data, { src: 'local' });
    if (one) openAtelier(f.name, data, '', { replace: fromDetail });
  }
  e.target.value = '';
  renderLibrary();
});

// ---------------- parcourir les sources ----------------
SOURCES.all = allSources(() => cfg.tvToken);
const browse = { src: 'all', mode: null, query: '', next: null, loading: false };
$('srcSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  browse.src = b.dataset.src;
  browse.mode = null;
  $('srcSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  loadList(true);
});
$('modeChips').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  browse.mode = b.dataset.mode;
  browse.query = '';
  $('searchInput').value = '';
  loadList(true);
});
$('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('searchInput').value.trim();
  if (/^https?:\/\//i.test(v) || /\.(com|org)\//i.test(v)) { handleLink(v); return; }
  browse.query = v;
  loadList(true);
});
$('pasteBtn').addEventListener('click', () => askLink());
$('linkBtn').addEventListener('click', () => askLink({ toLibrary: true }));
$('moreBtn').addEventListener('click', () => loadList(false));
// Défilement infini : charge la suite quand le bas de la liste approche.
if ('IntersectionObserver' in window) {
  new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && browse.next != null && !browse.loading) loadList(false); },
    { rootMargin: '600px' }).observe($('moreBtn'));
}

const DIRECT = new Set(['printables', 'thingiverse']);   // téléchargement sans quitter l'appli
function renderModes() {
  const S = SOURCES[browse.src];
  if (!browse.mode) browse.mode = S.modes[0][0];
  $('modeChips').innerHTML = S.modes.map(([k, l]) => `<button data-mode="${k}" class="${!browse.query && k === browse.mode ? 'on' : ''}">${l}</button>`).join('');
  const note = $('srcNote');
  if (browse.src === 'thingiverse' && !cfg.tvToken) {
    note.hidden = false;
    note.innerHTML = 'Thingiverse demande un jeton gratuit : ⚙️ Réglages → Thingiverse.';
  } else if (browse.src === 'makerworld' || browse.src === 'thangs') {
    note.hidden = false;
    note.textContent = `${SOURCES[browse.src].label} : parcourir sans compte, modèles gratuits uniquement. Le téléchargement exige un compte : la fiche explique comment récupérer le fichier.`;
  } else if (browse.src === 'all' && isNative) {
    note.hidden = false;
    note.textContent = 'Modèles gratuits de Printables, MakerWorld, Thangs' + (cfg.tvToken ? ', Thingiverse' : '') + '. ⬇️ = téléchargement direct dans l\'appli.';
  } else if (!isNative) {
    note.hidden = false;
    note.textContent = 'Version web : les sites de modèles refusent les requêtes du navigateur (CORS). Les sources marchent dans l\'appli Android ; ici, importe un fichier depuis 📂 Mes fichiers.';
  } else note.hidden = true;
}

async function loadList(reset) {
  if (browse.loading) return;
  renderModes();
  const S = SOURCES[browse.src];
  if (reset) { browse.next = null; $('grid').innerHTML = ''; }
  $('gridEmpty').hidden = true;
  $('moreBtn').hidden = true;
  browse.loading = true;
  const ph = document.createElement('p');
  ph.className = 'empty';
  ph.textContent = '⏳ Chargement…';
  $('grid').after(ph);
  try {
    const r = await S.list({ mode: browse.mode, query: browse.query, page: browse.next, token: cfg.tvToken });
    browse.next = r.next;
    const seen = new Set([...$('grid').children].map(c => c.dataset.src + c.dataset.id));
    r.items = r.items.filter(it => !seen.has(it.src + it.id));
    $('grid').insertAdjacentHTML('beforeend', r.items.map(it => `
      <button class="mcard" data-src="${it.src}" data-id="${esc(it.id)}">
        <img src="${esc(it.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span class="t">${esc(it.name)}</span>
        <span class="m">${browse.src === 'all' ? `<i class="badge">${DIRECT.has(it.src) ? '⬇️ ' : ''}${esc(SOURCES[it.src].label)}</i> ` : ''}${esc(it.author)}${it.likes != null ? ' · ❤️ ' + it.likes : ''}</span>
      </button>`).join(''));
    $('moreBtn').hidden = !r.next;
    if (!$('grid').children.length) { $('gridEmpty').hidden = false; $('gridEmpty').textContent = 'Aucun résultat.'; }
  } catch (e) {
    $('gridEmpty').hidden = false;
    $('gridEmpty').textContent = '⚠️ ' + e.message;
  } finally {
    ph.remove();
    browse.loading = false;
  }
}
$('grid').addEventListener('click', e => {
  const c = e.target.closest('.mcard');
  if (c) openDetail(c.dataset.src, c.dataset.id);
});

// ---------------- fiche modèle ----------------
let curDetail = null;
async function openDetail(src, id) {
  openSheet('detail');
  $('dTitle').textContent = '⏳';
  $('dGallery').innerHTML = '';
  $('dFiles').innerHTML = '<p class="muted small">Chargement…</p>';
  $('dDesc').textContent = '';
  $('dAuthor').textContent = '';
  $('dExternal').hidden = true;
  try {
    const d = await SOURCES[src].detail(id, { token: cfg.tvToken });
    curDetail = d;
    $('dTitle').textContent = d.name;
    $('dAuthor').textContent = (d.author ? 'par ' + d.author + ' · ' : '') + SOURCES[src].label;
    $('dGallery').innerHTML = d.images.slice(0, 12).map(u => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">`).join('');
    $('dDesc').textContent = htmlToText(d.html) || '—';
    if (d.external) {
      $('dExternal').hidden = false;
      const site = SOURCES[src].label, acct = src === 'makerworld' ? 'Bambu' : site;
      $('dExternal').innerHTML = `<b>${site} ne donne pas le fichier sans compte ${acct} (gratuit).</b>
        <ol class="steps">
          <li>Touche <b>Ouvrir sur ${site}</b> et connecte-toi si besoin.</li>
          <li>Touche <b>Télécharger</b> sur le site : le fichier (.3mf / .stl) va dans <b>Téléchargements</b>.</li>
          <li>Reviens ici et touche <b>Importer le fichier téléchargé</b>.</li>
        </ol>
        <div class="btns"><button class="primary" id="dOpen2">↗️ 1. Ouvrir sur ${site}</button>
        <button id="dImport2">📂 3. Importer le fichier téléchargé</button></div>`;
      $('dOpen2').onclick = () => openExternal(d.url);
      $('dImport2').onclick = () => $('fileInput').click();
      $('dFiles').innerHTML = '';
    } else {
      $('dFiles').innerHTML = d.files.length ? d.files.map((f, i) => `
        <div class="item" data-i="${i}">
          ${f.preview ? `<img src="${esc(f.preview)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ph">🧊</div>'}
          <div class="body"><div class="name">${esc(f.name)}</div><div class="meta">${f.size ? fmtSize(f.size) : ''}</div></div>
          <div class="acts"><button data-act="open" class="primary">✂️</button><button data-act="keep">💾</button></div>
        </div>`).join('') : '<p class="muted small">Aucun fichier .stl / .3mf dans ce modèle.</p>';
    }
  } catch (e) {
    $('dTitle').textContent = 'Erreur';
    $('dFiles').innerHTML = `<p class="note">⚠️ ${esc(e.message)}</p>`;
  }
}
$('dOpen').addEventListener('click', () => curDetail && openExternal(curDetail.url));
$('dFiles').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || !curDetail) return;
  const f = curDetail.files[+b.closest('.item').dataset.i];
  const old = b.textContent;
  b.disabled = true;
  b.textContent = '⏳';
  try {
    const data = await f.get();
    const meta = { src: curDetail.src, fileId: f.id, model: curDetail.name, preview: f.preview || curDetail.images[0] || '', url: curDetail.url };
    if (b.dataset.act === 'keep') {
      await keepFile(f.name, data, meta);
      toast('💾 Gardé dans Mes fichiers');
    } else {
      keepFile(f.name, data, meta).catch(() => {});
      openAtelier(f.name, data, curDetail.name);
    }
  } catch (err) {
    toast('⚠️ ' + err.message, 5000);
  } finally {
    b.disabled = false;
    b.textContent = old;
  }
});

async function openExternal(url) {
  const B = Cap && Cap.Plugins && Cap.Plugins.Browser;
  if (B) { try { await B.open({ url }); return; } catch (e) { /* repli */ } }
  window.open(url, '_blank');
}

// ---------------- liens collés / partagés ----------------
// toLibrary : import depuis Mes fichiers → les fichiers sont rangés dans la
// collection sans passer par la fiche du modèle ni l'atelier.
async function handleLink(text, { toLibrary = false } = {}) {
  const l = parseLink(text);
  if (!l) { toast('Aucun lien reconnu'); return; }
  if (l.src && !toLibrary) { openDetail(l.src, l.id); return; }
  toast('⏳ Téléchargement…', 60000);
  try {
    if (l.src) {
      const d = await SOURCES[l.src].detail(l.id, { token: cfg.tvToken });
      if (d.external) { toast(SOURCES[l.src].label + ' : suis les étapes', 2500); openDetail(l.src, l.id); return; }
      if (!d.files.length) { toast('Aucun fichier .stl / .3mf dans ce modèle', 5000); return; }
      let n = 0;
      for (const f of d.files) {
        toast(`⏳ ${++n}/${d.files.length} · ${f.name}`, 60000);
        const data = await f.get();
        await keepFile(f.name, data, { src: d.src, fileId: f.id, model: d.name, preview: f.preview || d.images[0] || '', url: d.url });
      }
      toast(`💾 ${n} fichier${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} : ${d.name}`);
      return;
    }
    const { name, data } = await downloadModel(l.direct);
    await keepFile(name, data, { src: 'lien', url: l.direct });
    if (toLibrary) toast('💾 Ajouté à Mes fichiers : ' + name);
    else openAtelier(name, data);
  } catch (e) { toast('⚠️ ' + e.message, 5000); }
}

async function askLink(opts) {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch (e) { /* refusé */ }
  if (!parseLink(t)) t = prompt('Colle le lien du modèle (Printables, Thingiverse, MakerWorld, Thangs, ou lien vers un .stl / .3mf : Dropbox, Google Drive, GitHub…) :', '') || '';
  if (t) handleLink(t, opts);
}

// Partage Android → Imprim 3D (texte/lien ou fichier .stl/.3mf).
async function onShare(ev) {
  try {
    for (const f of ev.files || []) {
      const path = f.uri.startsWith('file:') || f.uri.startsWith('content:') ? f.uri : 'file://' + f.uri;
      const data = await (await fetch(Cap.convertFileSrc(path))).arrayBuffer();
      const name = /\.(stl|3mf)$/i.test(f.name) ? f.name : (f.name || 'modele') + (new Uint8Array(data)[0] === 0x50 ? '.3mf' : '.stl');
      await keepFile(name, data, { src: 'partage' });
      openAtelier(name, data);
      return;
    }
    const t = (ev.texts || []).join(' ') || ev.title || '';
    if (t) handleLink(t);
  } catch (e) { toast('⚠️ Partage : ' + e.message, 5000); }
}
const ST = Cap && Cap.Plugins && Cap.Plugins.CapacitorShareTarget;
if (ST) ST.addListener('shareReceived', onShare);

// ---------------- lithophane ----------------
const L = { img: null, name: '', mod: null, timer: 0 };
cfg.litho = { width: 100, minT: 0.8, maxT: 3.0, frame: 3, res: 0.25, shape: 'flat', angle: 120, negative: false, mirror: false, smooth: true, upright: true, ...cfg.litho };
const lithoOpts = () => ({ ...cfg.litho, frameT: Math.max(cfg.litho.maxT, cfg.litho.frame ? cfg.litho.maxT + 1 : 0) });
function lithoForm() {
  const o = cfg.litho;
  $('lWidth').value = o.width; $('lWidthV').textContent = o.width + ' mm';
  $('lAngle').value = o.angle; $('lAngleV').textContent = o.angle + '°';
  $('lMin').value = o.minT; $('lMinV').textContent = (+o.minT).toFixed(1) + ' mm';
  $('lMax').value = o.maxT; $('lMaxV').textContent = (+o.maxT).toFixed(1) + ' mm';
  $('lFrame').value = o.frame; $('lFrameV').textContent = o.frame ? o.frame + ' mm' : 'aucun';
  $('lRes').value = String(o.res); $('lNeg').checked = o.negative; $('lMirror').checked = o.mirror; $('lSmooth').checked = o.smooth; $('lUpright').checked = o.upright;
  $('lShape').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.shape === o.shape));
  $('lAngleWrap').hidden = o.shape !== 'curved';
  $('lUprightWrap').hidden = o.shape === 'curved';
}
function lithoRead() {
  const o = cfg.litho;
  o.width = +$('lWidth').value; o.angle = +$('lAngle').value; o.minT = +$('lMin').value;
  o.maxT = Math.max(+$('lMax').value, o.minT + 0.4); o.frame = +$('lFrame').value; o.res = +$('lRes').value;
  o.negative = $('lNeg').checked; o.mirror = $('lMirror').checked; o.smooth = $('lSmooth').checked; o.upright = $('lUpright').checked;
  saveCfg();
  lithoForm();
  clearTimeout(L.timer);
  L.timer = setTimeout(lithoPreview, 150);
}
async function lithoPreview() {
  if (!L.img) return;
  if (!L.mod) L.mod = await import('./lithophane.js');
  // Aperçu à résolution réduite (rapide), même calcul que le modèle final.
  const o = lithoOpts();
  const map = L.mod.thicknessMap(L.img, { ...o, res: Math.max(o.res, o.width / 300) });
  L.mod.backlitPreview(map, $('lPrev'));
  $('lPrevWrap').hidden = false;
  const w = map.w, h = map.h;
  const cells = Math.round((w / o.res) * (h / o.res));
  const curved = o.shape === 'curved';
  const tooBig = w > cfg.bed * (curved ? 3 : 1) || h > (curved || o.upright ? 250 : cfg.bed);
  $('lInfo').innerHTML = `${w.toFixed(0)} × ${h.toFixed(0)} mm` + (curved ? ` · arc ${o.angle}°` : '') +
    ` · ~${(cells * 2 / 1000).toFixed(0)} k triangles` + (tooBig ? ' · <b class="bad-txt">trop grand pour le plateau</b>' : '');
  $('lMake').disabled = tooBig;
}
function loadLithoImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { L.img = img; L.name = file.name.replace(/\.[^.]+$/, '') || 'photo'; lithoPreview(); };
  img.onerror = () => { URL.revokeObjectURL(url); toast('⚠️ Image illisible'); };
  img.src = url;
}
$('lithoBtn').addEventListener('click', () => { lithoForm(); openSheet('litho'); if (!L.img) $('lImg').click(); });
$('lImg').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadLithoImage(f); e.target.value = ''; });
['lWidth', 'lAngle', 'lMin', 'lMax', 'lFrame'].forEach(id => $(id).addEventListener('input', lithoRead));
['lRes', 'lNeg', 'lMirror', 'lSmooth', 'lUpright'].forEach(id => $(id).addEventListener('change', lithoRead));
$('lShape').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  cfg.litho.shape = b.dataset.shape;
  lithoForm(); lithoRead();
});
$('lMake').addEventListener('click', async () => {
  if (!L.img) return;
  const b = $('lMake');
  b.disabled = true; b.textContent = '⏳ Calcul du relief…';
  await new Promise(r => setTimeout(r, 30));
  try {
    if (!L.mod) L.mod = await import('./lithophane.js');
    const o = lithoOpts();
    const { tris } = L.mod.buildMesh(L.mod.thicknessMap(L.img, o), o);
    const data = toBinarySTL(tris);
    const name = `${L.name}-lithophane.stl`;
    const thumb = (() => { try { return $('lPrev').toDataURL('image/jpeg', 0.7); } catch (e) { return ''; } })();
    await keepFile(name, data, { src: 'litho', fileId: name + Date.now(), model: 'Lithophane', preview: thumb });
    showTab('library');
    openAtelier(name, data, 'Lithophane', { litho: true, replace: true });
  } catch (e) {
    toast('⚠️ ' + e.message, 5000);
  } finally {
    b.disabled = false; b.textContent = '🧊 Créer le lithophane';
  }
});

// ---------------- atelier : aperçu + tranchage ----------------
const A = { name: '', objects: [], sel: -1, rot: [0, 0, 0], scale: 100, tris: null, viewer: null, gcode: null, meta: null };

async function openAtelier(name, data, model = '', { litho = false, replace = false } = {}) {
  openSheet('atelier', replace);
  $('aTitle').textContent = name;
  $('aResult').hidden = true;
  $('aProg').hidden = true;
  $('aSize').textContent = '⏳ Lecture du fichier…';
  A.name = name; A.model = model; A.gcode = null; A.rot = [0, 0, 0]; A.scale = 100;
  $('aScale').value = 100;
  $('aScaleV').textContent = '100 %';
  try {
    const { objects } = await loadModel(name, data);
    A.objects = objects;
    A.sel = -1;
    $('aObjWrap').hidden = objects.length < 2;
    $('aObj').innerHTML = (objects.length > 1 ? '<option value="-1">Tous les objets</option>' : '') +
      objects.map((o, i) => `<option value="${i}">${esc(o.name || 'Objet ' + (i + 1))}</option>`).join('');
    if (!A.viewer) {
      const { Viewer } = await import('./viewer.js');
      A.viewer = new Viewer($('viewer'), cfg.bed);
    }
    A.sel = objects.length > 1 ? -1 : 0;
    $('aObj').value = String(A.sel);
    // Pièces mécaniques : poser d'office la plus grande face à plat.
    // Lithophane : orientation voulue (debout) et réglages adaptés.
    A.rot = litho ? [0, 0, 0] : bestFlatRotation(currentRaw());
    if (litho) applyLithoPreset();
    updateMesh();
  } catch (e) {
    $('aSize').textContent = '⚠️ ' + e.message;
  }
}
// Réglages lithophane le temps de l'atelier, puis retour aux réglages habituels.
function applyLithoPreset() {
  if (!A.savedSlice) A.savedSlice = { ...DEFAULT_OPTS, ...cfg.slice };
  cfg.slice = { ...A.savedSlice, quality: 'fine', infill: 100, walls: 2, support: 'none', adhesion: 'brim' };
  loadSliceForm();
  toast('🖼️ Réglages lithophane : fin 0,12 mm, 100 %, bordure', 4000);
}
function atelierClose() {
  if (A.savedSlice) { cfg.slice = A.savedSlice; A.savedSlice = null; saveCfg(); loadSliceForm(); }
  if (A.viewer) { A.viewer.dispose(); A.viewer = null; }
  A.objects = []; A.tris = null; A.gcode = null;
}
const currentRaw = () => A.sel < 0 ? concat(A.objects.map(o => o.tris)) : A.objects[A.sel].tris;

function updateMesh() {
  A.tris = prepare(currentRaw(), { rot: A.rot, scale: A.scale });
  const b = bounds(A.tris);
  const [x, y, z] = b.size;
  const big = x > cfg.bed || y > cfg.bed || z > 250;
  $('aSize').textContent = `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm` + (big ? ' — trop grand pour le plateau !' : '');
  $('aSize').classList.toggle('bad', big);
  $('aSlice').disabled = big;
  A.viewer && A.viewer.show(A.tris, big);
  A.gcode = null;
  $('aResult').hidden = true;
}
$('aObj').addEventListener('change', () => { A.sel = +$('aObj').value; A.rot = bestFlatRotation(currentRaw()); updateMesh(); });
document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => {
  const k = +b.dataset.rot;
  A.rot = [...A.rot];
  A.rot[k] = (A.rot[k] + 90) % 360;
  updateMesh();
}));
$('aFlat').addEventListener('click', () => { A.rot = bestFlatRotation(currentRaw()); updateMesh(); });
$('aReset').addEventListener('click', () => { A.rot = [0, 0, 0]; A.scale = 100; $('aScale').value = 100; $('aScaleV').textContent = '100 %'; updateMesh(); });
$('aScale').addEventListener('input', () => { $('aScaleV').textContent = $('aScale').value + ' %'; });
$('aScale').addEventListener('change', () => { A.scale = +$('aScale').value; updateMesh(); });

// Formulaire de tranchage (mémorise les derniers choix)
$('sQuality').innerHTML = Object.entries(QUALITIES).map(([k, q]) => `<option value="${k}">${q.label}</option>`).join('');
$('sMaterial').innerHTML = Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
function loadSliceForm() {
  const s = { ...DEFAULT_OPTS, ...cfg.slice };
  $('sQuality').value = s.quality; $('sMaterial').value = s.material; $('sInfill').value = s.infill;
  $('sInfillV').textContent = s.infill + ' %'; $('sWalls').value = s.walls; $('sSupport').value = s.support; $('sAdhesion').value = s.adhesion;
}
function readSliceForm() {
  cfg.slice = {
    quality: $('sQuality').value, material: $('sMaterial').value, infill: +$('sInfill').value,
    walls: +$('sWalls').value, support: $('sSupport').value, adhesion: $('sAdhesion').value,
  };
  saveCfg();
  return { ...cfg.slice, bed: cfg.bed };
}
['sQuality', 'sMaterial', 'sWalls', 'sSupport', 'sAdhesion'].forEach(id => $(id).addEventListener('change', () => { readSliceForm(); A.gcode = null; $('aResult').hidden = true; }));
$('sInfill').addEventListener('input', () => { $('sInfillV').textContent = $('sInfill').value + ' %'; });
$('sInfill').addEventListener('change', () => { readSliceForm(); A.gcode = null; $('aResult').hidden = true; });
loadSliceForm();

let curaMod = null, enderDef = null;
async function slice() {
  if (!A.tris) return;
  const opts = readSliceForm();
  $('aSlice').disabled = true;
  $('aProg').hidden = false;
  $('aResult').hidden = true;
  $('aBar').style.width = '0%';
  $('aProgTxt').textContent = 'Chargement du trancheur…';
  const t0 = Date.now();
  let slicer = null;
  try {
    if (!curaMod) curaMod = await import('./vendor/cura-wasm.es.js');
    if (!enderDef) enderDef = await (await fetch('vendor/ender3.def.json')).json();
    const { overrides, layerHeight } = curaSettings(opts);
    slicer = new curaMod.CuraWASM({ definition: JSON.parse(JSON.stringify(enderDef)), overrides, transfer: true, verbose: false });
    slicer.on('progress', p => {
      $('aBar').style.width = p.toFixed(0) + '%';
      $('aProgTxt').textContent = `Tranchage… ${p.toFixed(0)} %`;
    });
    $('aProgTxt').textContent = 'Tranchage…';
    const { gcode, metadata } = await slicer.slice(toBinarySTL(A.tris), 'stl');
    let g = new TextDecoder().decode(gcode);
    const grams = filamentGrams(metadata.filamentUsage, opts.material);
    // En-tête : CuraEngine laisse des valeurs factices que le Cura de bureau remplace.
    g = g.replace(/^;TIME:\d+/m, ';TIME:' + Math.round(metadata.printTime))
      .replace(/^;Filament used: .*$/m, `;Filament used: ${(metadata.filamentUsage / 1000).toFixed(3)}m`);
    const layers = +(g.match(/^;LAYER_COUNT:(\d+)/m) || [])[1] || 0;
    A.gcode = g;
    A.meta = { time: metadata.printTime, grams, mm: metadata.filamentUsage, layers, opts, layerHeight };
    $('rTime').textContent = fmtDur(metadata.printTime);
    $('rFil').textContent = `${grams.toFixed(1)} g · ${(metadata.filamentUsage / 1000).toFixed(2)} m`;
    $('rLayers').textContent = layers;
    $('rMsg').textContent = `Tranché en ${((Date.now() - t0) / 1000).toFixed(0)} s · ${MATERIALS[opts.material].label} ${MATERIALS[opts.material].nozzle}/${MATERIALS[opts.material].bed} °C`;
    $('aResult').hidden = false;
    $('aResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    toast('⚠️ Tranchage : ' + (e.message || e), 6000);
  } finally {
    if (slicer) slicer.destroy().catch(() => {});
    $('aProg').hidden = true;
    $('aSlice').disabled = false;
  }
}
$('aSlice').addEventListener('click', slice);

function gcodeName() {
  const base = (A.name || 'modele').replace(/\.(stl|3mf)$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 50);
  const o = A.meta.opts;
  return `${base}_${o.material}_${A.meta.layerHeight}mm_${o.infill}pc.gcode`;
}
async function send(print) {
  if (!A.gcode) return;
  const op = octo();
  if (!op.ok) { toast('Règle OctoPrint dans ⚙️ Réglages'); return; }
  const msg = $('rMsg');
  try {
    if (print) {
      const st = await op.state().catch(() => null);
      const s = st && st.printer && st.printer.state && st.printer.state.flags;
      if (!s) { if (!confirm('L\'imprimante n\'est pas connectée à OctoPrint. Envoyer quand même et tenter l\'impression ?')) return; await op.connect().catch(() => {}); }
      else if (s.printing || s.paused) { toast('Une impression est déjà en cours'); return; }
      if (!confirm(`Lancer l'impression de « ${A.name} » (${fmtDur(A.meta.time)}) ? Plateau propre et filament ${A.meta.opts.material} chargé ?`)) return;
    }
    msg.textContent = '⏳ Envoi à OctoPrint…';
    const name = gcodeName();
    await op.upload(name, A.gcode, print);
    msg.textContent = print ? `▶️ Impression lancée : ${name}` : `📤 Envoyé : ${name}`;
    toast(print ? '▶️ Impression lancée' : '📤 Envoyé à OctoPrint');
  } catch (e) {
    msg.textContent = '⚠️ ' + e.message;
  }
}
$('rSend').addEventListener('click', () => send(false));
$('rPrint').addEventListener('click', () => send(true));
$('rSave').addEventListener('click', async () => {
  if (!A.gcode) return;
  const name = gcodeName();
  const FS = Cap && Cap.Plugins && Cap.Plugins.Filesystem;
  if (isNative && FS) {
    try {
      await FS.writeFile({ path: 'Imprim3D/' + name, data: A.gcode, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
      toast('💾 Documents/Imprim3D/' + name, 5000);
    } catch (e) { toast('⚠️ ' + e.message, 5000); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([A.gcode], { type: 'text/x-gcode' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// ---------------- imprimante ----------------
let prTimer = null, prBusy = false, camTimer = null;
async function refreshPrinter(force) {
  const op = octo();
  $('prNotConf').hidden = op.ok;
  if (!op.ok) { setChip('bad', 'Non réglé'); return; }
  if (prBusy && !force) return;
  prBusy = true;
  try {
    const { printer, job, conn } = await op.state();
    $('prAway').hidden = true;
    const flags = printer?.state?.flags || {};
    const stText = printer?.state?.text || conn?.current?.state || 'Déconnectée';
    $('prState').textContent = stText;
    const t = printer?.temperature || {};
    const fmtT = x => x ? `${Math.round(x.actual)} / ${Math.round(x.target || 0)} °C` : '—';
    $('prTool').textContent = fmtT(t.tool0);
    $('prBed').textContent = fmtT(t.bed);
    const active = flags.printing || flags.paused;
    $('prJob').hidden = !active;
    if (active) {
      const pct = job?.progress?.completion || 0;
      $('prJobName').textContent = job?.job?.file?.display || job?.job?.file?.name || '';
      $('prBar').style.width = pct.toFixed(1) + '%';
      $('prPct').textContent = pct.toFixed(1) + ' %';
      $('prLeft').textContent = job?.progress?.printTimeLeft ? 'reste ' + fmtDur(job.progress.printTimeLeft) : '';
    }
    $('prConnect').hidden = !!printer;
    $('prPause').textContent = flags.paused ? '▶️ Reprendre' : '⏸️ Pause';
    $('prPause').disabled = !active;
    $('prCancel').disabled = !active;
    setChip(active ? 'busy' : printer ? 'ok' : 'bad', active ? `${(job?.progress?.completion || 0).toFixed(0)} %` : printer ? 'Prête' : 'Déconnectée');
    if (curTab === 'printer') {
      const files = await op.files().catch(() => null);
      renderOpFiles(files);
    }
  } catch (e) {
    $('prState').textContent = '⚠️ ' + e.message;
    setChip('bad', 'Hors ligne');
    $('prAway').hidden = false;
  } finally { prBusy = false; }
}
// Caméra : image rafraîchie toutes les 2 s, indépendamment d'OctoPrint.
// L'image suivante n'est demandée qu'une fois la précédente chargée (ou en échec).
let camBusy = false, camFails = 0;
function refreshCam() {
  const show = curTab === 'printer' && !!cfg.cam;
  $('camCard').hidden = !show;
  if (!show || document.hidden || camBusy) return;
  camBusy = true;
  const im = new Image();
  const stop = setTimeout(() => im.onerror(), 8000);
  im.onload = () => { clearTimeout(stop); camBusy = false; camFails = 0; $('camImg').src = im.src; $('camMsg').textContent = '🔴 en direct · ' + new Date().toLocaleTimeString('fr-FR'); };
  im.onerror = () => { clearTimeout(stop); camBusy = false; im.onload = im.onerror = null; if (++camFails >= 2) $('camMsg').textContent = '⚠️ Caméra injoignable (téléphone à la maison ou VPN actif ?)'; };
  im.src = cfg.cam + (cfg.cam.includes('?') ? '&' : '?') + '_=' + Date.now();
}
$('camImg').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if ($('camCard').requestFullscreen) $('camCard').requestFullscreen().catch(() => {});
});
function setChip(cls, txt) {
  const c = $('printerChip');
  c.querySelector('.dot').className = 'dot ' + cls;
  c.querySelector('span').textContent = txt;
}
function renderOpFiles(r) {
  const files = ((r && r.files) || []).filter(f => f.type === 'machinecode').sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 30);
  $('opFiles').innerHTML = files.length ? files.map(f => `
    <div class="item" data-path="${esc(f.path)}">
      <div class="ph">📄</div>
      <div class="body"><div class="name">${esc(f.display || f.name)}</div>
        <div class="meta">${f.gcodeAnalysis?.estimatedPrintTime ? fmtDur(f.gcodeAnalysis.estimatedPrintTime) + ' · ' : ''}${f.date ? new Date(f.date * 1000).toLocaleDateString('fr-FR') : ''}</div></div>
      <div class="acts"><button data-act="print">▶️</button><button data-act="del">🗑️</button></div>
    </div>`).join('') : '<p class="muted small">Aucun fichier.</p>';
}
$('opFiles').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const path = b.closest('.item').dataset.path;
  try {
    if (b.dataset.act === 'print') {
      if (!confirm('Imprimer « ' + path + ' » ?')) return;
      await octo().printFile(path);
      toast('▶️ Impression lancée');
    } else {
      if (!confirm('Supprimer « ' + path + ' » d\'OctoPrint ?')) return;
      await octo().deleteFile(path);
    }
    refreshPrinter(true);
  } catch (err) { toast('⚠️ ' + err.message, 5000); }
});
$('prRefresh').addEventListener('click', () => refreshPrinter(true));
$('printerChip').addEventListener('click', () => showTab('printer'));
$('prConnect').addEventListener('click', async () => { try { await octo().connect(); toast('🔌 Connexion…'); setTimeout(() => refreshPrinter(true), 3000); } catch (e) { toast('⚠️ ' + e.message); } });
$('prPause').addEventListener('click', async () => { try { await octo().jobCmd('pause', 'toggle'); refreshPrinter(true); } catch (e) { toast('⚠️ ' + e.message); } });
$('prCancel').addEventListener('click', async () => {
  if (!confirm('Annuler l\'impression en cours ?')) return;
  try { await octo().jobCmd('cancel'); refreshPrinter(true); } catch (e) { toast('⚠️ ' + e.message); }
});
document.querySelectorAll('[data-heat]').forEach(b => b.addEventListener('click', async () => {
  const m = MATERIALS[b.dataset.heat];
  try { await octo().preheat(m ? m.nozzle : 0, m ? m.bed : 0); toast(m ? `🔥 Chauffe ${m.nozzle}/${m.bed} °C` : '❄️ Chauffe coupée'); setTimeout(() => refreshPrinter(true), 1500); }
  catch (e) { toast('⚠️ ' + e.message); }
}));
function startPolling() {
  clearInterval(prTimer);
  prTimer = setInterval(() => { if (!document.hidden) refreshPrinter(false); }, 6000);
  clearInterval(camTimer);
  camTimer = setInterval(refreshCam, 2000);
  refreshCam();
}

// ---------------- réglages ----------------
function loadCfgForm() {
  $('cfgOctoUrl').value = cfg.octoUrl; $('cfgOctoKey').value = cfg.octoKey; $('cfgCam').value = cfg.cam;
  $('cfgTvToken').value = cfg.tvToken; $('cfgBed').value = cfg.bed;
}
[['cfgOctoUrl', 'octoUrl'], ['cfgOctoKey', 'octoKey'], ['cfgCam', 'cam'], ['cfgTvToken', 'tvToken']].forEach(([id, k]) =>
  $(id).addEventListener('change', () => { cfg[k] = $(id).value.trim(); saveCfg(); if (k.startsWith('octo')) refreshPrinter(true); }));
$('cfgBed').addEventListener('change', () => { cfg.bed = Math.max(150, Math.min(300, +$('cfgBed').value || 220)); saveCfg(); });
$('cfgTest').addEventListener('click', async () => {
  const m = $('cfgOctoMsg');
  m.textContent = '⏳ Test…';
  try {
    const v = await octo().version();
    m.textContent = `✅ ${v.text || 'OctoPrint'} (API ${v.api})`;
    refreshPrinter(true);
  } catch (e) { m.textContent = '⚠️ ' + e.message; }
});
$('cfgAskKey').addEventListener('click', async () => {
  const m = $('cfgOctoMsg');
  cfg.octoUrl = $('cfgOctoUrl').value.trim();
  saveCfg();
  try {
    const key = await new OctoPrint(cfg.octoUrl, '').requestKey('Imprim 3D', i => {
      m.textContent = `🔑 Ouvre OctoPrint (${cfg.octoUrl}) sur un ordinateur et accepte « Imprim 3D »… ${i * 2} s`;
    });
    cfg.octoKey = key;
    saveCfg();
    $('cfgOctoKey').value = key;
    m.textContent = '✅ Clé reçue et enregistrée';
    refreshPrinter(true);
  } catch (e) { m.textContent = '⚠️ ' + e.message; }
});

// ---------------- version / mise à jour manuelle ----------------
function cmpVer(a, b) {
  const x = String(a).replace(/^v/, '').split('.'), y = String(b).replace(/^v/, '').split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
    if (d) return d;
  }
  return 0;
}
async function installApkUpdate(apkUrl, statusEl, onEnd) {
  const UP = Cap && Cap.Plugins && Cap.Plugins.UpdatePlugin;
  if (UP && apkUrl) {
    if (statusEl) statusEl.textContent = '⏳ Téléchargement…';
    try { await UP.downloadAndInstall({ url: apkUrl }); }
    catch (e) {
      const msg = (e && e.message) || String(e);
      alert(/permission/i.test(msg) ? 'Autorise « Installer des applis inconnues » pour Imprim 3D dans les réglages Android, puis réessaie.' : 'Échec de la mise à jour : ' + msg);
      if (onEnd) onEnd();
    }
    return;
  }
  window.open(apkUrl, '_blank');
  if (onEnd) onEnd();
}
window.installApkUpdate = installApkUpdate;
$('checkUpd').addEventListener('click', async () => {
  const st = $('updState');
  st.textContent = ' · vérification…';
  try {
    const r = await fetch('https://api.github.com/repos/' + window.UPDATE_REPO + '/releases/latest?_=' + Date.now(), { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rel = await r.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (cmpVer(latest, window.APP_VERSION) > 0) {
      const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name));
      st.innerHTML = ` · <b style="color:#22c55e">v${esc(latest)} disponible</b> `;
      const b = document.createElement('button');
      b.textContent = '⬇️ Installer';
      b.onclick = () => installApkUpdate(apk ? apk.browser_download_url : rel.html_url, st);
      st.append(b);
    } else st.textContent = ' · à jour';
  } catch (e) { st.textContent = ' · ⚠️ ' + e.message; }
});

// ---------------- démarrage ----------------
$('appVersion').textContent = 'v' + window.APP_VERSION;
$('verChip').textContent = 'v' + window.APP_VERSION;
loadCfgForm();
loadList(true);
refreshPrinter(true);
startPolling();
if ('serviceWorker' in navigator && !isNative) navigator.serviceWorker.register('sw.js').catch(() => {});
