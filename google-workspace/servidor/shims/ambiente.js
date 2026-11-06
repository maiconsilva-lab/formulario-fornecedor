/* Recursos do ambiente Node/Web que o Apps Script não tem: URL, URLSearchParams,
   TextEncoder/TextDecoder, atob/btoa, Headers, AbortController, structuredClone,
   process.env e fetch (sobre UrlFetchApp). */
import { Buffer } from 'buffer';
import { Promessa } from './promessa.js';

/* ── URLSearchParams ── */
export class URLSearchParams {
  constructor(init) {
    this._p = [];
    if (!init) return;
    if (typeof init === 'string') {
      const s = init.replace(/^\?/, '');
      for (const par of s.split('&')) {
        if (!par) continue;
        const i = par.indexOf('=');
        const k = i < 0 ? par : par.slice(0, i);
        const v = i < 0 ? '' : par.slice(i + 1);
        this._p.push([dec(k), dec(v)]);
      }
    } else if (init instanceof URLSearchParams) this._p = init._p.map((x) => x.slice());
    else if (Array.isArray(init)) this._p = init.map(([k, v]) => [String(k), String(v)]);
    else for (const [k, v] of Object.entries(init)) if (v !== undefined) this._p.push([k, String(v)]);
  }
  get(k) { const x = this._p.find((p) => p[0] === k); return x ? x[1] : null; }
  getAll(k) { return this._p.filter((p) => p[0] === k).map((p) => p[1]); }
  has(k) { return this._p.some((p) => p[0] === k); }
  set(k, v) { const i = this._p.findIndex((p) => p[0] === k); this._p = this._p.filter((p, j) => p[0] !== k || j === i); if (i >= 0) this._p[this._p.findIndex((p) => p[0] === k)][1] = String(v); else this._p.push([k, String(v)]); }
  append(k, v) { this._p.push([k, String(v)]); }
  delete(k) { this._p = this._p.filter((p) => p[0] !== k); }
  forEach(fn) { this._p.forEach(([k, v]) => fn(v, k, this)); }
  keys() { return this._p.map((p) => p[0])[Symbol.iterator](); }
  values() { return this._p.map((p) => p[1])[Symbol.iterator](); }
  entries() { return this._p.map((p) => p.slice())[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  get size() { return this._p.length; }
  toString() { return this._p.map(([k, v]) => enc(k) + '=' + enc(v)).join('&'); }
}
const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+');

/* ── URL (absolutas e relativas a uma base) ── */
const RE_URL = /^([a-z][a-z0-9+.-]*:)(?:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]*)(?::(\d+))?)?([^?#]*)(\?[^#]*)?(#.*)?$/i;
export class URL {
  constructor(entrada, base) {
    let s = String(entrada);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (base === undefined) throw new TypeError('Invalid URL: ' + s);
      const b = new URL(base);
      if (s.startsWith('//')) s = b.protocol + s;
      else if (s.startsWith('/')) s = b.origin + s;
      else if (s.startsWith('?')) s = b.origin + b.pathname + s;
      else if (s.startsWith('#')) s = b.origin + b.pathname + b.search + s;
      else s = b.origin + b.pathname.replace(/[^/]*$/, '') + s;
    }
    const m = s.match(RE_URL);
    if (!m) throw new TypeError('Invalid URL: ' + s);
    this.protocol = m[1].toLowerCase();
    this.username = m[2] || ''; this.password = m[3] || '';
    this.hostname = (m[4] || '').toLowerCase(); this.port = m[5] || '';
    this.pathname = normalizarCaminho(m[6] || (m[4] !== undefined ? '/' : ''));
    this.searchParams = new URLSearchParams(m[7] || '');
    this.hash = m[8] || '';
  }
  get host() { return this.hostname + (this.port ? ':' + this.port : ''); }
  get origin() { return this.protocol + '//' + this.host; }
  get search() { const q = this.searchParams.toString(); return q ? '?' + q : ''; }
  set search(v) { this.searchParams = new URLSearchParams(String(v)); }
  get href() { return this.origin + this.pathname + this.search + this.hash; }
  set href(v) { Object.assign(this, new URL(v)); }
  toString() { return this.href; }
  toJSON() { return this.href; }
}
function normalizarCaminho(p) {
  const partes = [];
  for (const seg of p.split('/')) { if (seg === '..') partes.pop(); else if (seg !== '.') partes.push(seg); }
  let r = partes.join('/');
  if (!r.startsWith('/')) r = '/' + r;
  return r;
}

/* ── Texto ── */
export class TextEncoder { get encoding() { return 'utf-8'; } encode(s = '') { return new Uint8Array(Buffer.from(String(s), 'utf8')); } }
export class TextDecoder {
  constructor(rotulo = 'utf-8') { this.encoding = String(rotulo).toLowerCase(); }
  decode(b) {
    if (!b) return '';
    const buf = Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b.buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b);
    return buf.toString(this.encoding === 'latin1' || this.encoding === 'iso-8859-1' || this.encoding === 'windows-1252' ? 'latin1' : 'utf8');
  }
}
export const atob = (s) => Buffer.from(String(s), 'base64').toString('latin1');
export const btoa = (s) => Buffer.from(String(s), 'latin1').toString('base64');
export function structuredClone(v) { return clonar(v, new Map()); }
function clonar(v, vistos) {
  if (v === null || typeof v !== 'object') return v;
  if (vistos.has(v)) return vistos.get(v);
  let c;
  if (v instanceof Date) c = new Date(v.getTime());
  else if (v instanceof RegExp) c = new RegExp(v.source, v.flags);
  else if (v instanceof ArrayBuffer) c = v.slice(0);
  else if (ArrayBuffer.isView(v)) c = new v.constructor(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  else if (v instanceof Map) { c = new Map(); vistos.set(v, c); v.forEach((x, k) => c.set(clonar(k, vistos), clonar(x, vistos))); return c; }
  else if (v instanceof Set) { c = new Set(); vistos.set(v, c); v.forEach((x) => c.add(clonar(x, vistos))); return c; }
  else if (Array.isArray(v)) { c = []; vistos.set(v, c); v.forEach((x, i) => { c[i] = clonar(x, vistos); }); return c; }
  else { c = {}; vistos.set(v, c); for (const k of Object.keys(v)) c[k] = clonar(v[k], vistos); return c; }
  vistos.set(v, c);
  return c;
}

/* ── Headers ── */
export class Headers {
  constructor(init) {
    this._h = {};
    if (!init) return;
    const pares = init instanceof Headers ? Object.entries(init._h) : Array.isArray(init) ? init : Object.entries(init);
    for (const [k, v] of pares) this._h[String(k).toLowerCase()] = String(v);
  }
  get(k) { const v = this._h[String(k).toLowerCase()]; return v === undefined ? null : v; }
  set(k, v) { this._h[String(k).toLowerCase()] = String(v); }
  append(k, v) { const c = String(k).toLowerCase(); this._h[c] = this._h[c] ? this._h[c] + ', ' + v : String(v); }
  has(k) { return String(k).toLowerCase() in this._h; }
  delete(k) { delete this._h[String(k).toLowerCase()]; }
  forEach(fn) { for (const [k, v] of Object.entries(this._h)) fn(v, k, this); }
  entries() { return Object.entries(this._h)[Symbol.iterator](); }
  keys() { return Object.keys(this._h)[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  getSetCookie() { return this._h['set-cookie'] ? [this._h['set-cookie']] : []; }
}

/* ── AbortController: as chamadas aqui são síncronas, então não há o que abortar. ── */
export class AbortSignal {
  constructor() { this.aborted = false; this.reason = undefined; this._l = []; }
  addEventListener(t, fn) { if (t === 'abort') this._l.push(fn); }
  removeEventListener() {}
  throwIfAborted() { if (this.aborted) throw this.reason; }
  static timeout() { return new AbortSignal(); }
  static any() { return new AbortSignal(); }
}
export class AbortController {
  constructor() { this.signal = new AbortSignal(); }
  abort(reason) { this.signal.aborted = true; this.signal.reason = reason; this.signal._l.forEach((f) => f()); }
}

/* ── Blob mínimo (usado para empacotar arquivos) ── */
export class Blob {
  constructor(partes = [], opts = {}) {
    this._b = Buffer.concat(partes.map((p) => (p instanceof Blob ? p._b : typeof p === 'string' ? Buffer.from(p) : Buffer.from(p.buffer ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : p))));
    this.type = opts.type || '';
  }
  get size() { return this._b.length; }
  arrayBuffer() { return Promessa.resolve(this._b.buffer.slice(this._b.byteOffset, this._b.byteOffset + this._b.length)); }
  text() { return Promessa.resolve(this._b.toString('utf8')); }
}

/* ── process.env a partir das Propriedades do script ── */
let envCache = null;
export function carregarEnv(extra = {}) {
  const props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties().getProperties() : {};
  envCache = {
    NODE_ENV: 'production',
    // O painel exige estas variáveis para montar o cliente do banco; aqui o "banco" são as planilhas.
    NEXT_PUBLIC_SUPABASE_URL: 'planilhas://premix',
    // As integrações Google usam a conta do script; estes valores só satisfazem as checagens do código.
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'conta-do-apps-script',
    GOOGLE_PRIVATE_KEY: 'conta-do-apps-script',
    // A "ponte do Drive" agora roda dentro do próprio app (ver ponte.js).
    DRIVE_PONTE_URL: 'interno://ponte-drive',
    DRIVE_PONTE_SEGREDO: 'interno',
    ...props,
    ...extra,
  };
  if (!envCache.SUPABASE_SERVICE_ROLE_KEY) envCache.SUPABASE_SERVICE_ROLE_KEY = envCache.SESSION_SECRET || 'sem-chave';
  process.env = envCache;
  return envCache;
}
export const process = {
  env: {},
  cwd: () => '/',
  version: 'v20.0.0',
  versions: { node: '20.0.0' },
  platform: 'linux',
  nextTick: (fn, ...a) => Promessa.resolve().then(() => fn(...a)),
  emitWarning() {},
  on() {}, once() {}, off() {},
  memoryUsage: () => ({ heapUsed: 0, rss: 0 }),
  hrtime: Object.assign(() => [0, 0], { bigint: () => 0 }),
  uptime: () => 0,
};

/* ── ReadableStream mínimo (o pdf.js usa para extrair o texto) ── */
export class ReadableStream {
  constructor(fonte = {}, estrategia = {}) {
    this._fila = []; this._leituras = []; this._fechado = false; this._erro = null; this._puxando = false;
    this._hwm = estrategia.highWaterMark ?? 1;
    this._tam = estrategia.size || (() => 1);
    this._fonte = fonte;
    const self = this;
    this._ctrl = {
      enqueue(c) {
        if (self._leituras.length) self._leituras.shift().resolver({ value: c, done: false });
        else self._fila.push(c);
      },
      close() { self._fechado = true; while (self._leituras.length) self._leituras.shift().resolver({ value: undefined, done: true }); },
      error(e) { self._erro = e; while (self._leituras.length) self._leituras.shift().rejeitar(e); },
      get desiredSize() { return self._hwm - self._fila.reduce((s, c) => s + self._tam(c), 0); },
    };
    if (fonte.start) Promessa.resolve(fonte.start(this._ctrl)).then(() => this._puxar(), (e) => this._ctrl.error(e));
  }
  _puxar() {
    if (this._puxando || this._fechado || this._erro || !this._fonte.pull) return;
    if (this._ctrl.desiredSize <= 0 && !this._leituras.length) return;
    this._puxando = true;
    Promessa.resolve(this._fonte.pull(this._ctrl)).then(() => { this._puxando = false; if (this._leituras.length) this._puxar(); }, (e) => this._ctrl.error(e));
  }
  getReader() {
    return {
      read: () => {
        if (this._erro) return Promessa.reject(this._erro);
        if (this._fila.length) { const value = this._fila.shift(); this._puxar(); return Promessa.resolve({ value, done: false }); }
        if (this._fechado) return Promessa.resolve({ value: undefined, done: true });
        return new Promessa((resolver, rejeitar) => { this._leituras.push({ resolver, rejeitar }); this._puxar(); });
      },
      cancel: (motivo) => { this._fechado = true; return Promessa.resolve(this._fonte.cancel && this._fonte.cancel(motivo)); },
      releaseLock() {},
      closed: Promessa.resolve(),
    };
  }
  cancel(motivo) { return this.getReader().cancel(motivo); }
}
