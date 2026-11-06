/* Ponto de entrada do servidor no Apps Script.
 *
 *  - api(req)      chamado pelo navegador via google.script.run: executa a rota /api/... do painel
 *  - doGet(e)      entrega as telas (painel, formulários públicos)
 *  - doPost(e)     integrações externas (Portal de Lançamentos → /api/lancamentos/ingest etc.)
 *  - gatilhos      tarefas agendadas (equivalentes aos crons da Vercel)
 *
 * As rotas são os próprios arquivos app/api/** /route.js do painel, empacotados sem mudança.
 */
import { ROTAS } from 'virtual:rotas';
import { resolverAgora, limparTemporizadores, Promessa } from './shims/promessa.js';
import { carregarEnv } from './shims/ambiente.js';
import { criarRequisicao, NextResponse, tarefasDepois } from './shims/next-server.js';
import { createClient } from './db/consulta.js';

const compiladas = ROTAS.map((r) => {
  const nomes = [];
  const re = r.padrao.split('/').map((seg) => {
    let m = seg.match(/^\[\.\.\.(.+)\]$/);
    if (m) { nomes.push(m[1]); return '(.+)'; }
    m = seg.match(/^\[(.+)\]$/);
    if (m) { nomes.push(m[1]); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  const dinamicos = nomes.length;
  return { ...r, re: new RegExp('^' + re + '/?$'), nomes, dinamicos };
}).sort((a, b) => a.dinamicos - b.dinamicos); // rotas fixas antes das com [parâmetro]

function acharRota(caminho) {
  for (const r of compiladas) {
    const m = caminho.match(r.re);
    if (m) return { rota: r, params: Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

/* Limite global extra para tentativas de código de filial (o IP real não chega ao Apps Script). */
function limiteGlobal(chave, max, janelaS) {
  const c = CacheService.getScriptCache();
  const k = 'lim:' + chave + ':' + Math.floor(Date.now() / (janelaS * 1000));
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), janelaS + 60);
  return n <= max;
}

function json(status, dados) {
  return { status, headers: { 'content-type': 'application/json' }, corpo: JSON.stringify(dados), base64: false, cookies: [] };
}

/** Executa uma rota do painel. `req` = { metodo, caminho, consulta, cabecalhos, corpo, cookies }. */
export function executar(req, opcoes = {}) {
  carregarEnv();
  limparTemporizadores();
  const metodo = String(req.metodo || 'GET').toUpperCase();
  const caminho = String(req.caminho || '/').split('?')[0];
  const achou = acharRota(caminho);
  if (!achou) return json(404, { error: 'Rota não encontrada: ' + caminho });
  const fn = achou.rota.mod[metodo];
  if (typeof fn !== 'function') return json(405, { error: 'Método não permitido.' });
  if (caminho === '/api/filial-acesso' && metodo === 'POST' && !limiteGlobal('filial', 300, 600)) {
    return json(429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const requisicao = criarRequisicao({
    metodo, caminho,
    consulta: req.consulta || '',
    cabecalhos: req.cabecalhos || {},
    corpo: req.corpo ?? null,
    cookies: req.cookies || {},
  });
  const params = achou.params;
  const contexto = { params: Object.assign(Promessa.resolve(params), params) };
  try {
    const resp = resolverAgora(Promessa.resolve().then(() => fn(requisicao, contexto)));
    const saida = resp && typeof resp.serializar === 'function' ? resp.serializar() : json(500, { error: 'A rota não devolveu resposta.' });
    // Chamadas externas (Portal) não esperam a leitura dos PDFs: o gatilho de 10 min e a abertura do documento a fazem.
    for (const t of (opcoes.semDepois ? (tarefasDepois(), []) : tarefasDepois())) {
      try { resolverAgora(Promessa.resolve().then(() => (typeof t === 'function' ? t() : t))); } catch (e) { console.error('[after]', e && e.stack || e); }
    }
    return saida;
  } catch (e) {
    console.error('[api] ' + metodo + ' ' + caminho, e && e.stack || e);
    return json(500, { error: 'Erro inesperado no servidor.', detalhe: String(e && e.message || e) });
  }
}

export { createClient, carregarEnv };
