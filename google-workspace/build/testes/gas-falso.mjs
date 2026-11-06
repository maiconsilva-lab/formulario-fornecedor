/* Simulação mínima dos serviços do Apps Script para testar localmente (Node).
   Reproduz o comportamento que importa das planilhas: apóstrofo força texto,
   texto numérico sem apóstrofo vira número, células vazias são ''. */
import crypto from 'node:crypto';

function celula(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (v.startsWith("'")) return v.slice(1);
    if (v !== '' && !isNaN(Number(v)) && /^[\d.\-+e ]+$/i.test(v)) return Number(v);
    if (v === 'TRUE' || v === 'FALSE') return v === 'TRUE';
    return v;
  }
  return v;
}

class Faixa {
  constructor(sh, r, c, nr = 1, nc = 1) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const linha = this.sh.dados[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = linha[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map((l) => l.map((v) => (v === '' || v === null || v === undefined ? '' : String(v)))); }
  createTextFinder(txt) {
    const self = this; const alvo = String(txt);
    return { matchEntireCell() { return this; }, findNext() {
      const vals = self.getValues();
      for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) if (String(vals[i][j]) === alvo) return new Faixa(self.sh, self.r + i, self.c + j, 1, 1);
      return null;
    } };
  }
  offset(dr, dc, nr, nc) { return new Faixa(this.sh, this.r + dr, this.c + dc, nr || this.nr, nc || this.nc); }
  getRow() { return this.r; }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((l) => l.length !== this.nc)) throw new Error(`setValues: tamanho ${vals.length}x${vals[0]?.length} ≠ ${this.nr}x${this.nc}`);
    vals.forEach((l, i) => {
      const r = this.r - 1 + i;
      while (this.sh.dados.length <= r) this.sh.dados.push([]);
      l.forEach((v, j) => {
        (this.sh.brutos = this.sh.brutos || []).push(v);
        const cv = (typeof v === 'string' && this.sh.texto && this.sh.texto.has((this.r + i) + ',' + (this.c + j))) ? v : celula(v);
        if (typeof cv === 'string' && cv.length > 50000) throw new Error('Célula com mais de 50000 caracteres');
        this.sh.dados[r][this.c - 1 + j] = cv;
      });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const l = this.sh.dados[this.r - 1 + i]; if (l) l[this.c - 1 + j] = ''; } return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setNumberFormat(f) {
    if (f === '@') { this.sh.texto = this.sh.texto || new Set(); for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.texto.add((this.r + i) + ',' + (this.c + j)); }
    return this;
  }
}

class Aba {
  constructor(nome) { this.nome = nome; this.dados = []; }
  getName() { return this.nome; }
  getLastRow() {
    for (let i = this.dados.length - 1; i >= 0; i--) if ((this.dados[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() { return this.dados.reduce((m, l) => { let k = 0; (l || []).forEach((v, j) => { if (v !== '' && v !== undefined) k = j + 1; }); return Math.max(m, k); }, 0); }
  getRange(r, c, nr, nc) { return new Faixa(this, r, c, nr, nc); }
  getDataRange() { return new Faixa(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  deleteRow(r) { this.dados.splice(r - 1, 1); }
  deleteRows(r, n) { this.dados.splice(r - 1, n); }
  setFrozenRows() {}
  hideColumns() {}
  protect() { return { setDescription() { return this; }, removeEditors() { return this; }, getEditors: () => [], setWarningOnly() {} }; }
  clear() { this.dados = []; }
}

class Planilha {
  constructor(id, nome) { this.id = id; this.nome = nome; this.abas = [new Aba('Página1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getName() { return this.nome; }
  getSheetByName(n) { return this.abas.find((a) => a.nome === n) || null; }
  insertSheet(n) { const a = new Aba(n); this.abas.push(a); return a; }
  getSheets() { return this.abas; }
  deleteSheet(a) { this.abas = this.abas.filter((x) => x !== a); }
}

export function criarGasFalso({ props = {} } = {}) {
  const planilhas = {};
  const propriedades = { ...props };
  const arquivos = {};
  const pastas = { raiz: { id: 'raiz', nome: 'raiz', filhos: [] } };
  let n = 0;

  const SpreadsheetApp = {
    openById(id) { if (!planilhas[id]) throw new Error('Planilha não encontrada: ' + id); return planilhas[id]; },
    create(nome) { const id = 'plan' + ++n; planilhas[id] = new Planilha(id, nome); return planilhas[id]; },
    flush() {},
  };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => propriedades[k] ?? null,
      setProperty: (k, v) => { propriedades[k] = String(v); },
      deleteProperty: (k) => { delete propriedades[k]; },
      getProperties: () => ({ ...propriedades }),
      setProperties: (o) => Object.assign(propriedades, o),
    }),
  };
  const LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) };
  const memoria = {};
  const CacheService = { getScriptCache: () => ({ get: (k) => memoria[k] ?? null, put: (k, v) => { memoria[k] = v; }, remove: (k) => { delete memoria[k]; }, getAll: (ks) => Object.fromEntries(ks.filter((k) => k in memoria).map((k) => [k, memoria[k]])), putAll: (o) => Object.assign(memoria, o), removeAll: (ks) => ks.forEach((k) => delete memoria[k]) }) };

  const bytes = (b) => Array.from(b).map((x) => (x > 127 ? x - 256 : x));
  const buf = (arr) => Buffer.from(arr.map((x) => (x < 0 ? x + 256 : x)));
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    base64Encode: (d) => Buffer.from(typeof d === 'string' ? Buffer.from(d, 'utf8') : buf(d)).toString('base64'),
    base64EncodeWebSafe: (d) => Buffer.from(typeof d === 'string' ? Buffer.from(d, 'utf8') : buf(d)).toString('base64url'),
    base64Decode: (s) => bytes(Buffer.from(s, 'base64')),
    base64DecodeWebSafe: (s) => bytes(Buffer.from(s, 'base64url')),
    computeHmacSha256Signature: (v, k) => bytes(crypto.createHmac('sha256', typeof k === 'string' ? k : buf(k)).update(typeof v === 'string' ? v : buf(v)).digest()),
    computeDigest: (alg, v) => bytes(crypto.createHash(alg === 'MD5' ? 'md5' : alg === 'SHA_1' ? 'sha1' : 'sha256').update(typeof v === 'string' ? v : buf(v)).digest()),
    DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5', SHA_1: 'SHA_1' },
    Charset: { UTF_8: 'UTF_8' },
    newBlob: (dados, tipo, nome) => blob(typeof dados === 'string' ? Buffer.from(dados) : buf(dados), tipo, nome),
    sleep() {},
    formatDate: (d, tz, f) => {
      const t = new Date(d.getTime() - 3 * 3600e3); const iso = t.toISOString();
      const p = { yyyy: iso.slice(0, 4), MM: iso.slice(5, 7), M: String(Number(iso.slice(5, 7))), dd: iso.slice(8, 10), HH: iso.slice(11, 13), mm: iso.slice(14, 16), ss: iso.slice(17, 19) };
      return f.replace(/yyyy|MM|M|dd|HH|mm|ss/g, (k) => p[k]);
    },
  };
  function blob(b, tipo = 'application/octet-stream', nome = 'arquivo') {
    return {
      getBytes: () => bytes(b), getDataAsString: () => b.toString('utf8'), getContentType: () => tipo, getName: () => nome,
      setName(x) { nome = x; return this; }, setContentType(x) { tipo = x; return this; }, copyBlob() { return blob(b, tipo, nome); },
    };
  }
  const Logger = { log: (...a) => console.log('[Logger]', ...a) };

  function pasta(id) {
    const p = pastas[id];
    return {
      getId: () => p.id, getName: () => p.nome, getUrl: () => 'https://drive.google.com/drive/folders/' + p.id,
      createFolder(nome) { const nid = 'pasta' + ++n; pastas[nid] = { id: nid, nome, filhos: [], pai: p.id }; return pasta(nid); },
      createFile(b) { const fid = 'arq' + String(++n).padStart(20, '0'); arquivos[fid] = { id: fid, blob: b, pai: p.id }; return arquivo(fid); },
      getFiles() { const lista = Object.values(arquivos).filter((a) => a.pai === p.id); let i = 0; return { hasNext: () => i < lista.length, next: () => arquivo(lista[i++].id) }; },
      getFolders() { const lista = Object.values(pastas).filter((x) => x.pai === p.id); let i = 0; return { hasNext: () => i < lista.length, next: () => pasta(lista[i++].id) }; },
      getFoldersByName(nome) { const l = Object.values(pastas).filter((x) => x.pai === p.id && x.nome === nome); let i = 0; return { hasNext: () => i < l.length, next: () => pasta(l[i++].id) }; },
      getFilesByName(nome) { const l = Object.values(arquivos).filter((a) => a.pai === p.id && a.blob.getName() === nome); let i = 0; return { hasNext: () => i < l.length, next: () => arquivo(l[i++].id) }; },
      getParents() { let usado = false; return { hasNext: () => !usado && !!p.pai, next: () => { usado = true; return pasta(p.pai); } }; },
      setTrashed() {},
    };
  }
  function arquivo(id) {
    const a = arquivos[id];
    return {
      getId: () => id, getName: () => a.blob.getName(), getUrl: () => `https://drive.google.com/file/d/${id}/view`,
      getBlob: () => a.blob, getMimeType: () => a.blob.getContentType(), getSize: () => a.blob.getBytes().length,
      setSharing() {}, moveTo(destino) { a.pai = destino.getId(); return this; }, setTrashed() { delete arquivos[id]; },
    };
  }
  const DriveApp = {
    getFolderById: (id) => { if (!pastas[id]) pastas[id] = { id, nome: id, filhos: [] }; return pasta(id); },
    getFileById: (id) => { if (planilhas[id]) return { moveTo() { return this; }, getId: () => id }; if (!arquivos[id]) throw new Error('Arquivo não encontrado'); return arquivo(id); },
    getRootFolder: () => pasta('raiz'),
    Access: { DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
  };

  const chamadasHttp = [];
  const UrlFetchApp = {
    respostas: [],
    fetch(url, opts = {}) {
      chamadasHttp.push({ url, opts });
      const r = UrlFetchApp.respostas.find((x) => (typeof x.url === 'string' ? url.startsWith(x.url) : x.url.test(url)));
      const corpo = r ? (typeof r.corpo === 'function' ? r.corpo(url, opts) : r.corpo) : '{}';
      const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
      return {
        getResponseCode: () => (r ? r.status ?? 200 : 404),
        getContentText: () => texto,
        getHeaders: () => ({ 'Content-Type': r?.tipo || 'application/json' }),
        getAllHeaders: () => ({ 'Content-Type': r?.tipo || 'application/json' }),
        getBlob: () => blob(Buffer.from(texto), r?.tipo || 'application/json'),
        getContent: () => bytes(Buffer.from(texto)),
      };
    },
    fetchAll(reqs) { return reqs.map((q) => UrlFetchApp.fetch(q.url, q)); },
  };
  const ScriptApp = { getOAuthToken: () => 'token-falso', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FALSO/exec' }), newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }), everyHours: () => ({ create() {} }), atHour: () => ({ everyDays: () => ({ create() {} }) }) }) }), getProjectTriggers: () => [], deleteTrigger() {} };
  const Session = { getActiveUser: () => ({ getEmail: () => 'teste@premix.com.br' }), getEffectiveUser: () => ({ getEmail: () => 'dono@premix.com.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' };
  const HtmlService = {
    createHtmlOutputFromFile: (f) => saida(f), createTemplateFromFile: (f) => ({ evaluate: () => saida(f) }), createHtmlOutput: (h) => saida(h),
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
  };
  function saida(c) { const o = { conteudo: c, setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: () => o, setFaviconUrl: () => o, getContent: () => c }; return o; }
  const ContentService = { createTextOutput: (t) => { const o = { texto: t, setMimeType: () => o, getContent: () => t }; return o; }, MimeType: { JSON: 'JSON', TEXT: 'TEXT' } };
  const MailApp = { enviados: [], sendEmail: (o) => MailApp.enviados.push(o), getRemainingDailyQuota: () => 100 };

  return {
    globais: { SpreadsheetApp, PropertiesService, LockService, CacheService, Utilities, Logger, DriveApp, UrlFetchApp, ScriptApp, Session, HtmlService, ContentService, MailApp },
    planilhas, propriedades, arquivos, chamadasHttp,
  };
}
