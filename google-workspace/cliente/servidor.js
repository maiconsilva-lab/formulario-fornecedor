/* Ponte navegador → Apps Script. Substitui o fetch das rotas /api/... por
   google.script.run.api(...) e mantém os cookies da sessão no navegador
   (o iframe do Apps Script não guarda cookies de terceiros). */
const ORIGINAL = window.fetch ? window.fetch.bind(window) : null;
const CHAVE = 'pmx_cookies';

function lerCookies() { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch { return {}; } }
function gravarCookies(lista) {
  if (!lista || !lista.length) return;
  const c = lerCookies();
  for (const k of lista) { if (k.value) c[k.name] = k.value; else delete c[k.name]; }
  try { localStorage.setItem(CHAVE, JSON.stringify(c)); } catch { /* sem armazenamento */ }
}

function b64ParaBytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

const emVoo = new Map();      // GETs idênticos em andamento viram uma só chamada
const recentes = new Map();   // pequeno cache de GETs muito frequentes
const CACHE_MS = { '/api/auth/session': 20000, '/api/system-health': 60000, '/api/dashboard/news': 600000, '/api/dashboard/mercado': 300000 };

function chamarApi(req) {
  return new Promise((ok, falha) => {
    google.script.run
      .withSuccessHandler(ok)
      .withFailureHandler((e) => falha(new TypeError('Falha de conexão com o servidor. ' + (e && e.message || ''))))
      .api(req);
  });
}

function montarResposta(r) {
  gravarCookies(r.cookies);
  const corpo = r.corpo === null || r.corpo === undefined ? null : (r.base64 ? b64ParaBytes(r.corpo) : r.corpo);
  const semCorpo = r.status === 204 || r.status === 304;
  return new Response(semCorpo ? null : corpo, { status: r.status, headers: r.headers || {} });
}

export function fetchServidor(entrada, init = {}) {
  const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || String(entrada);
  if (!url.startsWith('/api/')) return ORIGINAL ? ORIGINAL(entrada, init) : Promise.reject(new TypeError('fetch indisponível'));
  const metodo = String(init.method || (entrada && entrada.method) || 'GET').toUpperCase();
  const [caminho, consulta = ''] = url.split('?');
  const cab = {};
  const h = init.headers || {};
  if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { cab[k.toLowerCase()] = v; });
  else for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) cab[String(k).toLowerCase()] = v;
  const corpo = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : null;
  const chave = metodo + ' ' + url + ' ' + (corpo || '');
  const ttl = metodo === 'GET' ? CACHE_MS[caminho] : 0;
  if (ttl) { const r = recentes.get(chave); if (r && Date.now() - r.em < ttl) return Promise.resolve(montarResposta(r.dados)); }
  if (metodo === 'GET' && emVoo.has(chave)) return emVoo.get(chave).then(montarResposta);
  const p = chamarApi({ metodo, caminho, consulta, cabecalhos: cab, corpo, cookies: lerCookies() });
  if (metodo === 'GET') {
    emVoo.set(chave, p);
    p.finally(() => emVoo.delete(chave)).catch(() => {});
    if (ttl) p.then((d) => { if (d.status < 400) recentes.set(chave, { em: Date.now(), dados: d }); }).catch(() => {});
  } else {
    recentes.clear(); // qualquer escrita invalida o cache curto
  }
  return p.then(montarResposta);
}

export function instalar() { window.fetch = fetchServidor; }
