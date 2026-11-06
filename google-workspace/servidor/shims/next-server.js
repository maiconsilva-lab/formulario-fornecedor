/* Substituto de next/server: NextResponse e a requisição que as rotas recebem. */
import { Buffer } from 'buffer';
import { Promessa } from './promessa.js';
import { Headers, URL } from './ambiente.js';

class Cookies {
  constructor(inicial = {}) { this._c = { ...inicial }; this._alterados = []; }
  get(nome) { return nome in this._c ? { name: nome, value: this._c[nome] } : undefined; }
  getAll() { return Object.entries(this._c).map(([name, value]) => ({ name, value })); }
  has(nome) { return nome in this._c; }
  set(a, b, c) {
    const o = typeof a === 'object' ? a : { name: a, value: b, ...(c || {}) };
    if (o.maxAge === 0 || o.value === '') delete this._c[o.name]; else this._c[o.name] = String(o.value);
    this._alterados.push({ name: o.name, value: o.maxAge === 0 ? '' : String(o.value ?? ''), maxAge: o.maxAge });
    return this;
  }
  delete(nome) { return this.set({ name: nome, value: '', maxAge: 0 }); }
}

export class NextResponse {
  constructor(corpo = null, init = {}) {
    this.status = init.status || 200;
    this.headers = new Headers(init.headers);
    this.cookies = new Cookies();
    this._corpo = corpo;
    this.ok = this.status >= 200 && this.status < 300;
  }
  static json(dados, init = {}) {
    const r = new NextResponse(JSON.stringify(dados === undefined ? null : dados), init);
    if (!r.headers.has('content-type')) r.headers.set('content-type', 'application/json');
    r._json = dados;
    return r;
  }
  static redirect(url, status = 307) {
    const r = new NextResponse(null, { status: typeof status === 'number' ? status : status.status || 307 });
    r.headers.set('location', String(url));
    return r;
  }
  static next() { return new NextResponse(null); }
  json() { return Promessa.resolve(this._json !== undefined ? this._json : JSON.parse(this._texto())); }
  text() { return Promessa.resolve(this._texto()); }
  _texto() { const c = this._corpo; return c === null ? '' : typeof c === 'string' ? c : Buffer.from(c).toString('utf8'); }

  /** Formato que volta para o navegador pelo google.script.run. */
  serializar() {
    const headers = {};
    this.headers.forEach((v, k) => { headers[k] = v; });
    const c = this._corpo;
    let corpo = null; let base64 = false;
    if (c === null || c === undefined) corpo = null;
    else if (typeof c === 'string') corpo = c;
    else { corpo = Buffer.from(c instanceof ArrayBuffer ? new Uint8Array(c) : c).toString('base64'); base64 = true; }
    return { status: this.status, headers, corpo, base64, cookies: this.cookies._alterados };
  }
}
export const Response = NextResponse;

/** Requisição no formato que as rotas do Next esperam (req.json(), req.nextUrl, req.cookies...). */
export function criarRequisicao({ metodo = 'GET', caminho = '/', consulta = '', cabecalhos = {}, corpo = null, cookies = {}, origem = 'https://painel.premix.local' }) {
  const url = new URL(caminho + (consulta ? (consulta.startsWith('?') ? consulta : '?' + consulta) : ''), origem);
  const headers = new Headers(cabecalhos);
  return {
    method: metodo.toUpperCase(),
    url: url.href,
    nextUrl: url,
    headers,
    cookies: new Cookies(cookies),
    ip: headers.get('x-forwarded-for') || undefined,
    json: () => (corpo === null || corpo === '' ? Promessa.reject(new SyntaxError('Unexpected end of JSON input')) : Promessa.resolve().then(() => JSON.parse(corpo))),
    text: () => Promessa.resolve(corpo || ''),
    arrayBuffer: () => { const b = Buffer.from(corpo || '', 'utf8'); return Promessa.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); },
    formData: () => Promessa.reject(new Error('formData não suportado')),
    signal: { aborted: false, addEventListener() {} },
  };
}

export function userAgent() { return { ua: '' }; }
export default { NextResponse };

/* after(): tarefas para depois da resposta. Aqui rodam ao fim da mesma execução. */
const depois = [];
export function after(tarefa) { depois.push(tarefa); }
export function tarefasDepois() { return depois.splice(0, depois.length); }
