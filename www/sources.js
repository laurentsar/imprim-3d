// Sources de modèles 3D. Format commun :
//   liste  : { src, id, name, img, author, likes, downloads }
//   détail : { src, id, name, url, author, images[], html, files[], external? }
//   fichier: { id, name, size, preview, get: async () => ArrayBuffer }
//
// Dans l'APK, fetch passe par CapacitorHttp (natif) : pas de CORS. Dans le
// navigateur, Printables et ses fichiers acceptent le CORS ; Thingiverse et
// MakerWorld ne marchent que dans l'APK.

const PR_API = 'https://api.printables.com/graphql/';
const PR_MEDIA = 'https://media.printables.com/';
const TV_API = 'https://api.thingiverse.com';
const MW_API = 'https://makerworld.com/api/v1';

async function getJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg += ' — ' + (j.error || j.message || JSON.stringify(j).slice(0, 120)); } catch (e) { /* corps non JSON */ }
    throw new Error(msg);
  }
  return r.json();
}

export async function getBinary(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('Téléchargement impossible (HTTP ' + r.status + ')');
  return r.arrayBuffer();
}

const isModelFile = n => /\.(stl|3mf)$/i.test(n || '');

// ================= Printables =================
async function gql(query, variables = {}) {
  const j = await getJSON(PR_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (j.errors && !j.data) throw new Error(j.errors[0].message);
  return j.data;
}
const PR_ITEM = 'id name slug image { filePath } likesCount downloadCount user { publicUsername }';
const prItem = p => ({
  src: 'printables', id: p.id, name: p.name,
  img: p.image ? PR_MEDIA + p.image.filePath : '',
  author: p.user?.publicUsername || '', likes: p.likesCount, downloads: p.downloadCount,
});

export const printables = {
  label: 'Printables',
  modes: [['-likes_count', '❤️ Populaires'], ['-first_publish', '🆕 Nouveautés'], ['-download_count', '⬇️ Téléchargés'], ['-makes_count', '🖨️ Imprimés']],
  async list({ mode = '-likes_count', query = '', page = null }) {
    if (query) {
      const off = page || 0;
      const d = await gql(`query($q:String!,$o:Int){ searchPrints2(query:$q, limit:20, offset:$o) { totalCount items { ${PR_ITEM} } } }`, { q: query, o: off });
      const items = d.searchPrints2.items.map(prItem);
      return { items, next: off + 20 < d.searchPrints2.totalCount ? off + 20 : null };
    }
    const d = await gql(`query($ord:String,$c:String){ morePrints(ordering:$ord, limit:20, cursor:$c) { cursor items { ${PR_ITEM} } } }`, { ord: mode, c: page });
    return { items: d.morePrints.items.map(prItem), next: d.morePrints.cursor || null };
  },
  async detail(id) {
    const d = await gql(`query($id:ID!){ print(id:$id) { id name slug summary description likesCount downloadCount
      user { publicUsername } images { filePath } stls { id name fileSize filePreviewPath } } }`, { id: String(id) });
    const p = d.print;
    if (!p) throw new Error('Modèle Printables introuvable');
    return {
      src: 'printables', id: p.id, name: p.name, author: p.user?.publicUsername || '',
      url: `https://www.printables.com/model/${p.id}-${p.slug}`,
      images: (p.images || []).map(i => PR_MEDIA + i.filePath),
      html: p.description || p.summary || '',
      files: (p.stls || []).filter(f => isModelFile(f.name)).map(f => ({
        id: f.id, name: f.name, size: f.fileSize,
        preview: f.filePreviewPath ? PR_MEDIA + f.filePreviewPath : '',
        get: async () => {
          const m = await gql(`mutation($id:ID!,$p:ID!){ getDownloadLink(id:$id, printId:$p, fileType:stl, source:model_detail) { ok errors { messages } output { link } } }`, { id: f.id, p: p.id });
          const g = m.getDownloadLink;
          if (!g.ok) throw new Error((g.errors?.[0]?.messages || ['refusé']).join(', '));
          return getBinary(g.output.link);
        },
      })),
    };
  },
};

// ================= Thingiverse =================
// Jeton d'application obligatoire (créé par l'utilisateur, stocké sur l'appareil).
function tvHeaders(token) {
  if (!token) throw new Error('Jeton Thingiverse manquant : ⚙️ Réglages → Thingiverse.');
  return { Authorization: 'Bearer ' + token };
}
const tvItem = t => ({
  src: 'thingiverse', id: t.id, name: t.name,
  img: t.preview_image || t.thumbnail || '', author: t.creator?.name || '',
  likes: t.like_count, downloads: t.download_count,
});
export const thingiverse = {
  label: 'Thingiverse',
  modes: [['popular', '🔥 Populaires'], ['newest', '🆕 Nouveautés'], ['makes', '🖨️ Imprimés']],
  async list({ mode = 'popular', query = '', page = null, token }) {
    const p = page || 1;
    const q = encodeURIComponent(query || '');
    const sort = query ? 'relevant' : mode;
    const d = await getJSON(`${TV_API}/search/${q}?type=things&per_page=20&page=${p}&sort=${sort}`, { headers: tvHeaders(token) });
    const hits = d.hits || d || [];
    return { items: hits.map(tvItem), next: hits.length === 20 ? p + 1 : null };
  },
  async detail(id, { token }) {
    const h = tvHeaders(token);
    const [t, files, imgs] = await Promise.all([
      getJSON(`${TV_API}/things/${id}`, { headers: h }),
      getJSON(`${TV_API}/things/${id}/files`, { headers: h }),
      getJSON(`${TV_API}/things/${id}/images`, { headers: h }).catch(() => []),
    ]);
    const pic = im => {
      const s = (im.sizes || []).find(z => z.type === 'display' && z.size === 'large') || (im.sizes || [])[0];
      return s ? s.url : '';
    };
    return {
      src: 'thingiverse', id: t.id, name: t.name, author: t.creator?.name || '',
      url: t.public_url || `https://www.thingiverse.com/thing:${t.id}`,
      images: (imgs || []).map(pic).filter(Boolean).concat(imgs?.length ? [] : [t.thumbnail]).filter(Boolean),
      html: t.description_html || t.description || '',
      files: (files || []).filter(f => isModelFile(f.name)).map(f => ({
        id: f.id, name: f.name, size: f.size, preview: f.thumbnail || '',
        get: () => getBinary(f.download_url || `${TV_API}/files/${f.id}/download`, h),
      })),
    };
  },
};

// ================= MakerWorld =================
// Parcourir et rechercher : OK sans compte. Télécharger : compte Bambu exigé
// (« Please log in to download models. ») → on ouvre le modèle sur le site, et
// le fichier téléchargé revient par 📂 Importer ou par « Partager → Imprim 3D ».
const mwItem = d => ({
  src: 'makerworld', id: d.id, name: d.title, img: d.cover || d.coverUrl || '',
  author: d.designCreator?.name || '', likes: d.likeCount, downloads: d.downloadCount,
});
export const makerworld = {
  label: 'MakerWorld',
  modes: [['Trending', '🔥 Tendances'], ['New', '🆕 Nouveautés'], ['Popular', '❤️ Populaires']],
  async list({ mode = 'Trending', query = '', page = null }) {
    const off = page || 0;
    const url = query
      ? `${MW_API}/search-service/select/design2?keyword=${encodeURIComponent(query)}&limit=20&offset=${off}`
      : `${MW_API}/search-service/select/design/nav?navKey=${mode}&offset=${off}&limit=20`;
    const d = await getJSON(url);
    const hits = d.hits || [];
    return { items: hits.map(mwItem), next: hits.length === 20 ? off + 20 : null };
  },
  async detail(id) {
    const d = await getJSON(`${MW_API}/design-service/design/${id}`);
    const pics = (d.designExtension?.design_pictures || []).map(p => p.url);
    return {
      src: 'makerworld', id: d.id, name: d.title, author: d.designCreator?.name || '',
      url: `https://makerworld.com/fr/models/${d.id}-${d.slug || ''}`,
      images: [d.coverUrl, ...pics].filter(Boolean),
      html: d.summary || '',
      files: [], external: true,
    };
  },
};

export const SOURCES = { printables, thingiverse, makerworld };

// ================= liens collés / partagés =================
// Renvoie { src, id } pour une page modèle connue, { direct: url } pour un lien
// direct vers un .stl/.3mf, ou null.
export function parseLink(text) {
  const m0 = String(text || '').match(/https?:\/\/[^\s"'<>]+/);
  if (!m0) return null;
  const url = m0[0].replace(/[).,;]+$/, '');
  let m;
  if ((m = url.match(/printables\.com\/(?:[a-z]{2}\/)?model\/(\d+)/i))) return { src: 'printables', id: m[1], url };
  if ((m = url.match(/thingiverse\.com\/thing:(\d+)/i))) return { src: 'thingiverse', id: m[1], url };
  if ((m = url.match(/makerworld\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)/i))) return { src: 'makerworld', id: m[1], url };
  const direct = directUrl(url);
  return { direct, name: fileNameFromUrl(direct) };
}

// Liens de partage courants → lien de téléchargement direct.
export function directUrl(url) {
  let m;
  // Dropbox : ?dl=0 → ?dl=1
  if (/(^|\.)dropbox\.com\//i.test(url)) {
    const u = new URL(url);
    u.searchParams.delete('dl'); u.searchParams.set('dl', '1');
    return u.toString();
  }
  // GitHub : /blob/ → raw.githubusercontent.com
  if ((m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i)))
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3].split(/[?#]/)[0]}`;
  // Google Drive : /file/d/ID/… ou ?id=ID → téléchargement direct
  if ((m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)/i)))
    return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`;
  return url;
}

function fileNameFromUrl(url) {
  let n = '';
  try { n = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (e) { /* URL invalide */ }
  return n;
}

// Télécharge un fichier 3D depuis un lien quelconque : nom tiré de
// Content-Disposition ou de l'URL, format vérifié sur le contenu (refuse une page HTML).
export async function downloadModel(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Téléchargement impossible (HTTP ' + r.status + ')');
  const data = await r.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(512, data.byteLength))).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml') && head.includes('<html'))
    throw new Error('Ce lien ouvre une page web, pas un fichier .stl / .3mf');
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  const isZip = b[0] === 0x50 && b[1] === 0x4b;
  const isStl = /^solid/.test(head) || (data.byteLength >= 84 && 84 + new DataView(data).getUint32(80, true) * 50 === data.byteLength);
  let name = '';
  const cd = r.headers.get('content-disposition') || '';
  const cm = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  if (cm) { try { name = decodeURIComponent(cm[1].trim()); } catch (e) { name = cm[1].trim(); } }
  if (!name) name = fileNameFromUrl(r.url || url);
  if (!/\.(stl|3mf)$/i.test(name)) {
    if (!isZip && !isStl) throw new Error('Le lien ne donne pas un fichier .stl / .3mf');
    name = (name.replace(/\.[a-z0-9]{1,5}$/i, '') || 'modele') + (isZip ? '.3mf' : '.stl');
  }
  return { name, data };
}
