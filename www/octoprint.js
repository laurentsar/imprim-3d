// Client OctoPrint minimal (API REST + plugin appkeys).
// Dans l'APK, fetch est natif (CapacitorHttp) : HTTP en clair sur le LAN et pas
// de CORS. L'envoi de fichier utilise FormData avec un *File* (pas un Blob) :
// c'est ce que le pont natif de Capacitor sait convertir en multipart.

export class OctoPrint {
  constructor(url, key) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.key = key || '';
  }
  get ok() { return !!(this.url && this.key); }

  async req(path, opts = {}) {
    if (!this.url) throw new Error('Adresse OctoPrint non réglée (⚙️ Réglages).');
    const headers = { ...(opts.headers || {}) };
    if (this.key) headers['X-Api-Key'] = this.key;
    let r;
    try {
      r = await fetch(this.url + path, { ...opts, headers });
    } catch (e) {
      throw new Error('OctoPrint injoignable (' + this.url + ') : téléphone sur le Wi-Fi de la maison ?');
    }
    if (r.status === 204) return null;
    const txt = await r.text();
    let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* texte brut */ }
    if (!r.ok) {
      const msg = (j && (j.error || j.message)) || txt.slice(0, 160) || ('HTTP ' + r.status);
      const e = new Error(r.status === 403 ? 'Clé API refusée par OctoPrint' : msg);
      e.status = r.status;
      throw e;
    }
    return j;
  }
  json(path, method, body) {
    return this.req(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  version() { return this.req('/api/version'); }
  async state() {
    const [printer, job, conn] = await Promise.all([
      this.req('/api/printer').catch(e => (e.status === 409 ? null : Promise.reject(e))),
      this.req('/api/job'),
      this.req('/api/connection'),
    ]);
    return { printer, job, conn };
  }
  connect() { return this.json('/api/connection', 'POST', { command: 'connect', autoconnect: true }); }
  jobCmd(command, action) { return this.json('/api/job', 'POST', action ? { command, action } : { command }); }
  files() { return this.req('/api/files/local?recursive=false'); }
  printFile(path) { return this.json('/api/files/local/' + encodeURI(path), 'POST', { command: 'select', print: true }); }
  deleteFile(path) { return this.req('/api/files/local/' + encodeURI(path), { method: 'DELETE' }); }
  preheat(tool, bed) {
    return Promise.all([
      this.json('/api/printer/tool', 'POST', { command: 'target', targets: { tool0: tool } }),
      this.json('/api/printer/bed', 'POST', { command: 'target', target: bed }),
    ]);
  }

  // gcode : string ; print : lancer tout de suite
  async upload(name, gcode, print = false) {
    const fd = new FormData();
    fd.append('file', new File([gcode], name, { type: 'text/x-gcode' }));
    fd.append('select', print ? 'true' : 'false');
    fd.append('print', print ? 'true' : 'false');
    return this.req('/api/files/local', { method: 'POST', body: fd });
  }

  // ---- obtention d'une clé sans la recopier : plugin « Application Keys » ----
  // OctoPrint affiche une demande « Imprim 3D veut accéder… » dans son interface
  // web ; on interroge jusqu'à acceptation (200 + api_key) ou refus (404).
  async requestKey(app, onWait, signal) {
    const r = await this.json('/plugin/appkeys/request', 'POST', { app });
    const token = r && r.app_token;
    if (!token) throw new Error('OctoPrint ne propose pas les clés d\'application');
    for (let i = 0; i < 120; i++) {               // ~ 4 min
      if (signal && signal.aborted) throw new Error('Annulé');
      onWait && onWait(i);
      await new Promise(res => setTimeout(res, 2000));
      let res;
      try {
        res = await fetch(this.url + '/plugin/appkeys/request/' + token);
      } catch (e) { continue; }
      if (res.status === 200) {
        const j = await res.json();
        if (j.api_key) return j.api_key;
      } else if (res.status === 404) {
        throw new Error('Demande refusée ou expirée dans OctoPrint');
      }
    }
    throw new Error('Pas de réponse : accepte la demande dans l\'interface OctoPrint');
  }
}
