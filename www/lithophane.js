// Lithophane : image → carte d'épaisseur → solide fermé (triangles, mm).
//
// Épaisseur : modèle de translucidité de Cura (plugin ImageReader, LGPL-3.0,
// réécrit ici). Loi de Beer-Lambert : une épaisseur e laisse passer T1^e de la
// lumière (T1 = transmission à travers 1 mm). Pour que la luminosité vue à
// contre-jour suive celle de la photo, on cherche e tel que
//   T1^(e - eMin) = Lmin + (1 - Lmin) · luminance,   Lmin = T1^(eMax - eMin)
// → blanc = eMin (fin), noir = eMax (épais). Plus fidèle qu'une rampe linéaire,
// qui bouche les ombres.
//
// Options inspirées de 3dp.rocks/lithophane (open source) : cadre, forme plate
// ou courbe, impression debout.

// Luminance 0..1 (1 = clair) à la taille nx × ny ; la transparence compte comme du blanc.
export function imageLuminance(img, nx, ny) {
  const c = document.createElement('canvas');
  c.width = nx; c.height = ny;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, nx, ny);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, nx, ny);
  const px = g.getImageData(0, 0, nx, ny).data;
  const lum = new Float32Array(nx * ny);
  for (let i = 0; i < lum.length; i++) {
    // sRGB → linéaire, puis luminance relative (Rec. 709)
    const r = lin(px[i * 4]), gg = lin(px[i * 4 + 1]), b = lin(px[i * 4 + 2]);
    lum[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  return lum;
}
const LIN = new Float32Array(256).map((_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const lin = v => LIN[v];

function blur(a, nx, ny) {
  const o = new Float32Array(a.length);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < nx && yy < ny) { s += a[yy * nx + xx]; n++; }
    }
    o[y * nx + x] = s / n;
  }
  return o;
}

export const DEFAULTS = {
  width: 100,        // mm, largeur de l'image (sans cadre)
  minT: 0.8,         // mm, épaisseur des blancs
  maxT: 3.0,         // mm, épaisseur des noirs
  frame: 3,          // mm, largeur du cadre (0 = sans)
  frameT: 4,         // mm, épaisseur du cadre
  res: 0.25,         // mm par pixel
  shape: 'flat',     // 'flat' | 'curved'
  angle: 120,        // degrés (forme courbe)
  negative: false,   // inverse clair/foncé
  mirror: false,     // image lisible depuis le côté lisse
  smooth: true,      // lissage léger (atténue le bruit JPEG)
  upright: true,     // imprimer debout (meilleur détail)
  t1: 0.5,           // transmission à travers 1 mm (PLA blanc ≈ 50 %)
};

// Carte d'épaisseur (mm) de nx × ny cellules, cadre compris.
export function thicknessMap(img, o) {
  o = { ...DEFAULTS, ...o };
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const height = o.width * ih / iw;
  const ix = Math.max(2, Math.round(o.width / o.res)), iy = Math.max(2, Math.round(height / o.res));
  let lum = imageLuminance(img, ix, iy);
  if (o.smooth) lum = blur(lum, ix, iy);
  const fc = o.frame > 0 ? Math.max(1, Math.round(o.frame / o.res)) : 0;
  const nx = ix + 2 * fc, ny = iy + 2 * fc;
  const t = new Float32Array(nx * ny).fill(Math.max(o.frameT, o.maxT));
  const t1 = Math.min(0.95, Math.max(0.05, o.t1));
  const span = Math.max(0.1, o.maxT - o.minT);
  const lmin = t1 ** span;
  const k = 1 / Math.log(t1);
  for (let y = 0; y < iy; y++) for (let x = 0; x < ix; x++) {
    let L = lum[y * ix + x];
    if (o.negative) L = 1 - L;
    // y image vers le bas → ligne retournée pour que le haut de la photo soit en haut
    t[(ny - 1 - fc - y) * nx + fc + (o.mirror ? ix - 1 - x : x)] = o.minT + k * Math.log(lmin + (1 - lmin) * L);
  }
  return { t, nx, ny, cell: o.res, w: nx * o.res, h: ny * o.res };
}

// Simulation à contre-jour (ce qu'on verra une fois imprimé et éclairé).
export function backlitPreview(map, canvas, t1 = DEFAULTS.t1) {
  const { t, nx, ny } = map;
  canvas.width = nx; canvas.height = ny;
  const g = canvas.getContext('2d');
  const im = g.createImageData(nx, ny);
  let tmin = Infinity;
  for (const v of t) tmin = Math.min(tmin, v);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const tr = t1 ** (t[(ny - 1 - y) * nx + x] - tmin);           // 1 = le plus lumineux
    const s = tr <= 0.0031308 ? tr * 12.92 : 1.055 * tr ** (1 / 2.4) - 0.055;
    const i = (y * nx + x) * 4;
    im.data[i] = 255 * s; im.data[i + 1] = 235 * s; im.data[i + 2] = 190 * s; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}

// Solide fermé : dessus = relief (une valeur par sommet), dessous plat, 4 côtés.
// Les sommets sont aux coins des cellules : (nx+1) × (ny+1), valeur = moyenne des cellules voisines.
export function buildMesh(map, o) {
  o = { ...DEFAULTS, ...o };
  const { t, nx, ny, cell } = map;
  const vx = nx + 1, vy = ny + 1;
  const h = new Float32Array(vx * vy);
  for (let j = 0; j < vy; j++) for (let i = 0; i < vx; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const x = i + di, y = j + dj;
      if (x >= 0 && y >= 0 && x < nx && y < ny) { s += t[y * nx + x]; n++; }
    }
    h[j * vx + i] = s / n;
  }
  const W = nx * cell, H = ny * cell;
  // Nombre de triangles : dessus 2·nx·ny, dessous 2·nx + 2·ny, côtés 4·(nx+ny)
  const nTri = 2 * nx * ny + 2 * (nx + 2) + 2 * ny + 4 * (nx + ny);
  const out = new Float32Array(nTri * 9);
  let p = 0;
  // Coordonnées « à plat » : X = largeur, Y = hauteur de l'image, Z = épaisseur.
  const P = (i, j, top) => [i * cell, j * cell, top ? h[j * vx + i] : 0];
  const tri = (a, b, c) => { out.set(a, p); out.set(b, p + 3); out.set(c, p + 6); p += 9; };
  // dessus (normale +Z)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = P(i, j, 1), b = P(i + 1, j, 1), c = P(i + 1, j + 1, 1), d = P(i, j + 1, 1);
    tri(a, b, c); tri(a, c, d);
  }
  // dessous (normale −Z) : bandes par colonne ; colonnes de bord en éventail pour
  // reprendre tous les sommets des côtés gauche/droit (pas de jonction en T).
  for (let i = 0; i < nx; i++) {
    const L = i === 0, R = i === nx - 1;
    if (!L && !R) {
      tri(P(i, 0, 0), P(i + 1, ny, 0), P(i + 1, 0, 0));
      tri(P(i, 0, 0), P(i, ny, 0), P(i + 1, ny, 0));
      continue;
    }
    if (L) {   // côté gauche détaillé, éventail depuis (1, 0)
      for (let j = 0; j < ny; j++) tri(P(1, 0, 0), P(0, j, 0), P(0, j + 1, 0));
      tri(P(1, 0, 0), P(0, ny, 0), P(1, ny, 0));
    }
    if (R) {   // côté droit détaillé, éventail depuis (nx-1, ny)
      for (let j = 0; j < ny; j++) tri(P(nx - 1, ny, 0), P(nx, j + 1, 0), P(nx, j, 0));
      tri(P(nx - 1, ny, 0), P(nx, 0, 0), P(nx - 1, 0, 0));
      if (L) continue;
    }
  }
  // côtés
  for (let i = 0; i < nx; i++) {
    // avant (y = 0, normale −Y)
    tri(P(i, 0, 0), P(i + 1, 0, 0), P(i + 1, 0, 1)); tri(P(i, 0, 0), P(i + 1, 0, 1), P(i, 0, 1));
    // arrière (y = ny, normale +Y)
    tri(P(i + 1, ny, 0), P(i, ny, 0), P(i, ny, 1)); tri(P(i + 1, ny, 0), P(i, ny, 1), P(i + 1, ny, 1));
  }
  for (let j = 0; j < ny; j++) {
    // gauche (x = 0, normale −X)
    tri(P(0, j + 1, 0), P(0, j, 0), P(0, j, 1)); tri(P(0, j + 1, 0), P(0, j, 1), P(0, j + 1, 1));
    // droite (x = nx, normale +X)
    tri(P(nx, j, 0), P(nx, j + 1, 0), P(nx, j + 1, 1)); tri(P(nx, j, 0), P(nx, j + 1, 1), P(nx, j, 1));
  }
  let tris = out.subarray(0, p);

  // Forme courbe : la largeur s'enroule sur un arc ; relief vers l'extérieur.
  if (o.shape === 'curved' && o.angle > 0) {
    const th = Math.min(300, o.angle) * Math.PI / 180, R = W / th;
    for (let k = 0; k < tris.length; k += 3) {
      const phi = (tris[k] - W / 2) / R, r = R + tris[k + 2];
      tris[k] = r * Math.sin(phi);
      tris[k + 2] = r * Math.cos(phi) - R;
    }
  }
  // Debout : hauteur de l'image → Z imprimante, épaisseur → Y.
  if (o.upright || o.shape === 'curved') {
    for (let k = 0; k < tris.length; k += 3) {
      const y = tris[k + 1], z = tris[k + 2];
      tris[k + 1] = -z; tris[k + 2] = y;
    }
  }
  // Orientation des faces : volume signé positif (normales vers l'extérieur).
  if (signedVolume(tris) < 0) {
    for (let k = 0; k < tris.length; k += 9) for (let c = 0; c < 3; c++) {
      const a = tris[k + 3 + c]; tris[k + 3 + c] = tris[k + 6 + c]; tris[k + 6 + c] = a;
    }
  }
  return { tris, W, H };
}

function signedVolume(t) {
  let v = 0;
  for (let k = 0; k < t.length; k += 9) {
    v += t[k] * (t[k + 4] * t[k + 8] - t[k + 5] * t[k + 7])
       - t[k + 1] * (t[k + 3] * t[k + 8] - t[k + 5] * t[k + 6])
       + t[k + 2] * (t[k + 3] * t[k + 7] - t[k + 4] * t[k + 6]);
  }
  return v / 6;
}
