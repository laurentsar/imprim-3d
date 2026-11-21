// Lecture STL (binaire/ASCII) et 3MF → triangles (Float32Array, 9 floats par
// triangle), transformations (rotation, échelle, mise à plat), écriture STL.
//
// Le tranchage exige que la pièce soit centrée autour de l'origine en X/Y et
// posée sur Z=0 : CuraEngine en ligne de commande place l'origine du maillage au
// centre du plateau (vérifié : un cube 0..20 sortait en 110..130, pas centré).

export function detectFormat(name, buf) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.3mf')) return '3mf';
  if (n.endsWith('.stl')) return 'stl';
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (b[0] === 0x50 && b[1] === 0x4b) return '3mf';   // « PK » = zip
  return 'stl';
}

// ---------- STL ----------
export function parseSTL(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) return parseBinary(dv, n);
  }
  // ASCII (ou binaire mal formé commençant par « solid »)
  const txt = new TextDecoder().decode(buf);
  if (/^\s*solid/.test(txt) && /facet/.test(txt)) return parseAscii(txt);
  if (buf.byteLength >= 84) return parseBinary(dv, Math.floor((buf.byteLength - 84) / 50));
  throw new Error('Fichier STL illisible');
}

function parseBinary(dv, n) {
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return out;
}

function parseAscii(txt) {
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const v = [];
  let m;
  while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3]);
  return new Float32Array(v.slice(0, v.length - (v.length % 9)));
}

// ---------- 3MF ----------
// Gère : objets maillés, composants (objet = assemblage d'autres objets), fichiers
// d'objets séparés (extension « production » de Bambu/Prusa : 3D/Objects/*.model),
// transformations des composants et des éléments de « build ».
// Renvoie [{ name, tris }] : un élément par objet posé sur le plateau.
export async function parse3MF(buf) {
  const zip = await window.JSZip.loadAsync(buf);
  const files = Object.keys(zip.files);
  const rootPath = files.find(f => /^3D\/3dmodel\.model$/i.test(f))
    || files.find(f => /\.model$/i.test(f));
  if (!rootPath) throw new Error('3MF sans modèle 3D');
  const docs = {};                       // chemin → { objects: Map(id → obj), build }
  const parser = new DOMParser();

  async function load(path) {
    path = path.replace(/^\//, '');
    if (docs[path]) return docs[path];
    const f = zip.file(path) || zip.file(files.find(x => x.toLowerCase() === path.toLowerCase()) || '');
    if (!f) return (docs[path] = { objects: new Map(), build: [] });
    const xml = parser.parseFromString(await f.async('string'), 'application/xml');
    const doc = { objects: new Map(), build: [] };
    docs[path] = doc;
    for (const o of byTag(xml, 'object')) {
      const id = o.getAttribute('id');
      const obj = { name: o.getAttribute('name') || '', tris: null, comps: [] };
      const mesh = byTag(o, 'mesh')[0];
      if (mesh) {
        const vs = byTag(mesh, 'vertex');
        const pts = new Float32Array(vs.length * 3);
        vs.forEach((v, i) => {
          pts[i * 3] = +v.getAttribute('x'); pts[i * 3 + 1] = +v.getAttribute('y'); pts[i * 3 + 2] = +v.getAttribute('z');
        });
        const ts = byTag(mesh, 'triangle');
        const tris = new Float32Array(ts.length * 9);
        ts.forEach((t, i) => {
          ['v1', 'v2', 'v3'].forEach((a, k) => {
            const j = +t.getAttribute(a) * 3;
            tris[i * 9 + k * 3] = pts[j]; tris[i * 9 + k * 3 + 1] = pts[j + 1]; tris[i * 9 + k * 3 + 2] = pts[j + 2];
          });
        });
        obj.tris = tris;
      }
      for (const c of byTag(o, 'component')) {
        obj.comps.push({
          id: c.getAttribute('objectid'),
          path: attrNS(c, 'path') || path,
          m: parseMatrix(c.getAttribute('transform')),
        });
      }
      doc.objects.set(id, obj);
    }
    for (const it of byTag(xml, 'item')) {
      doc.build.push({ id: it.getAttribute('objectid'), path: attrNS(it, 'path') || path, m: parseMatrix(it.getAttribute('transform')) });
    }
    return doc;
  }

  async function flatten(path, id, m, depth = 0) {
    if (depth > 16) return [];
    const doc = await load(path);
    const obj = doc.objects.get(id);
    if (!obj) return [];
    const parts = [];
    if (obj.tris) parts.push(applyMatrix(obj.tris, m));
    for (const c of obj.comps) parts.push(...await flatten(c.path, c.id, mulMatrix(m, c.m), depth + 1));
    return parts;
  }

  const root = await load(rootPath);
  const items = root.build.length ? root.build : [...root.objects.keys()].map(id => ({ id, path: rootPath, m: null }));
  const out = [];
  for (const it of items) {
    const parts = await flatten(it.path, it.id, it.m || identity());
    const tris = concat(parts);
    if (tris.length) out.push({ name: (await load(it.path)).objects.get(it.id)?.name || ('Objet ' + it.id), tris });
  }
  if (!out.length) throw new Error('Aucun maillage dans ce 3MF');
  return out;
}

function byTag(node, tag) {
  // Les 3MF utilisent un espace de noms par défaut : getElementsByTagNameNS('*').
  return [...node.getElementsByTagNameNS('*', tag)];
}
function attrNS(el, local) {
  for (const a of el.attributes) if (a.localName === local) return a.value;
  return null;
}
// Matrice 3MF « m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32 » (vecteur ligne).
function parseMatrix(s) {
  if (!s) return identity();
  const a = s.trim().split(/\s+/).map(Number);
  return a.length === 12 ? a : identity();
}
function identity() { return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; }
function mulMatrix(p, c) {
  // point' = (point · C) · P  → composition C puis P
  const r = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = c[i * 3] * p[j] + c[i * 3 + 1] * p[3 + j] + c[i * 3 + 2] * p[6 + j];
  for (let j = 0; j < 3; j++)
    r[9 + j] = c[9] * p[j] + c[10] * p[3 + j] + c[11] * p[6 + j] + p[9 + j];
  return r;
}
function applyMatrix(tris, m) {
  const o = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    o[i] = x * m[0] + y * m[3] + z * m[6] + m[9];
    o[i + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
    o[i + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
  }
  return o;
}
export function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const o = new Float32Array(n);
  let k = 0;
  for (const p of parts) { o.set(p, k); k += p.length; }
  return o;
}

// ---------- chargement unifié ----------
// Renvoie { objects: [{ name, tris }] }.
export async function loadModel(name, buf) {
  if (detectFormat(name, buf) === '3mf') return { objects: await parse3MF(buf) };
  return { objects: [{ name: name || 'Modèle', tris: parseSTL(buf) }] };
}

// ---------- transformations ----------
export function bounds(tris) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

// rot = [rx, ry, rz] en degrés (multiples de 90 dans l'UI), scale en %.
// Résultat : centré en X/Y sur 0, posé sur Z = 0.
export function prepare(tris, { rot = [0, 0, 0], scale = 100 } = {}) {
  const s = scale / 100;
  const r = rot.map(d => d * Math.PI / 180);
  const [cx, sx] = [Math.cos(r[0]), Math.sin(r[0])];
  const [cy, sy] = [Math.cos(r[1]), Math.sin(r[1])];
  const [cz, sz] = [Math.cos(r[2]), Math.sin(r[2])];
  const o = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    let x = tris[i] * s, y = tris[i + 1] * s, z = tris[i + 2] * s;
    let t = y * cx - z * sx; z = y * sx + z * cx; y = t;           // X
    t = x * cy + z * sy; z = -x * sy + z * cy; x = t;              // Y
    t = x * cz - y * sz; y = x * sz + y * cz; x = t;               // Z
    o[i] = x; o[i + 1] = y; o[i + 2] = z;
  }
  const b = bounds(o);
  const dx = (b.min[0] + b.max[0]) / 2, dy = (b.min[1] + b.max[1]) / 2, dz = b.min[2];
  for (let i = 0; i < o.length; i += 3) { o[i] -= dx; o[i + 1] -= dy; o[i + 2] -= dz; }
  return o;
}

// Rotation qui pose la plus grande face plane sur le plateau (« mise à plat »).
// Cherche, parmi les normales des triangles, celle qui cumule la plus grande
// surface, et renvoie la rotation (multiples de 90°) la plus proche qui l'oriente
// vers -Z. Suffisant pour les pièces mécaniques typiques.
export function bestFlatRotation(tris) {
  const acc = new Map();
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i + 3] - tris[i], ay = tris[i + 4] - tris[i + 1], az = tris[i + 5] - tris[i + 2];
    const bx = tris[i + 6] - tris[i], by = tris[i + 7] - tris[i + 1], bz = tris[i + 8] - tris[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    if (!len) continue;
    const ux = nx / len, uy = ny / len, uz = nz / len;
    let key = null;
    if (Math.abs(ux) > 0.98) key = ux > 0 ? '+x' : '-x';
    else if (Math.abs(uy) > 0.98) key = uy > 0 ? '+y' : '-y';
    else if (Math.abs(uz) > 0.98) key = uz > 0 ? '+z' : '-z';
    if (key) acc.set(key, (acc.get(key) || 0) + len / 2);
  }
  let best = '-z', area = -1;
  for (const [k, a] of acc) if (a > area) { area = a; best = k; }
  return { '-z': [0, 0, 0], '+z': [180, 0, 0], '+x': [0, 90, 0], '-x': [0, -90, 0], '+y': [-90, 0, 0], '-y': [90, 0, 0] }[best];
}

export function toBinarySTL(tris) {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const t = i * 9;
    const ax = tris[t + 3] - tris[t], ay = tris[t + 4] - tris[t + 1], az = tris[t + 5] - tris[t + 2];
    const bx = tris[t + 6] - tris[t], by = tris[t + 7] - tris[t + 1], bz = tris[t + 8] - tris[t + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[t + k], true);
  }
  return buf;
}
