/* fetch() sobre UrlFetchApp. Síncrono por baixo; devolve Promise (Promessa) como o original. */
import { Buffer } from 'buffer';
import { Promessa } from './promessa.js';
import { Headers, URLSearchParams, Blob } from './ambiente.js';
import { ponteDrive } from './ponte.js';

class Resposta {
  constructor(corpo, { status = 200, headers = {}, url = '' } = {}) {
    this._corpo = corpo; // Buffer
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.statusText = String(status);
    this.headers = headers instanceof Headers ? headers : new Headers(headers);
    this.url = url;
    this.redirected = false;
    this.bodyUsed = false;
  }
  text() { return Promessa.resolve(this._corpo.toString('utf8')); }
  json() { return this.text().then((t) => JSON.parse(t)); }
  arrayBuffer() { const b = this._corpo; return Promessa.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  blob() { return Promessa.resolve(new Blob([this._corpo], { type: this.headers.get('content-type') || '' })); }
  clone() { return new Resposta(Buffer.from(this._corpo), { status: this.status, headers: this.headers, url: this.url }); }
  get body() { return null; }
}

function corpoParaPayload(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return Array.from(body._b).map((x) => (x > 127 ? x - 256 : x));
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (body instanceof Uint8Array) return Array.from(body).map((x) => (x > 127 ? x - 256 : x));
  return String(body);
}

export function fetch(entrada, init = {}) {
  try {
    const url = typeof entrada === 'string' ? entrada : entrada.url || String(entrada);
    if (url.startsWith('interno://ponte-drive')) {
      const resposta = ponteDrive(JSON.parse(init.body || '{}'));
      return Promessa.resolve(new Resposta(Buffer.from(JSON.stringify(resposta)), { headers: { 'content-type': 'application/json' }, url }));
    }
    const cab = new Headers(init.headers || (entrada && entrada.headers) || {});
    const opcoes = {
      method: String(init.method || 'GET').toLowerCase(),
      muteHttpExceptions: true,
      followRedirects: init.redirect !== 'manual',
      headers: {},
    };
    let tipo = cab.get('content-type');
    cab.forEach((v, k) => { if (!['content-type', 'content-length', 'host', 'connection', 'accept-encoding'].includes(k)) opcoes.headers[k] = v; });
    const payload = corpoParaPayload(init.body);
    if (payload !== undefined && opcoes.method !== 'get') {
      opcoes.payload = payload;
      if (!tipo && init.body instanceof URLSearchParams) tipo = 'application/x-www-form-urlencoded';
      if (!tipo && typeof payload === 'string') tipo = 'text/plain;charset=UTF-8';
    }
    if (tipo) opcoes.contentType = tipo;
    const r = UrlFetchApp.fetch(url, opcoes);
    const headers = {};
    const brutos = r.getAllHeaders ? r.getAllHeaders() : r.getHeaders();
    for (const [k, v] of Object.entries(brutos || {})) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    const conteudo = r.getContent ? r.getContent() : null;
    const buf = conteudo ? Buffer.from(conteudo.map((x) => x & 0xff)) : Buffer.from(r.getContentText(), 'utf8');
    return Promessa.resolve(new Resposta(buf, { status: r.getResponseCode(), headers, url }));
  } catch (e) {
    return Promessa.reject(Object.assign(new TypeError('fetch failed: ' + (e && e.message)), { cause: e }));
  }
}

export { Resposta as Response };
export class Request {
  constructor(url, init = {}) { this.url = String(url); this.method = init.method || 'GET'; this.headers = new Headers(init.headers); this.body = init.body; }
}
