/* Páginas, integrações externas e tarefas agendadas. */
import { executar } from './principal.js';

/* Quem usa o painel: conta Google da organização (DOMINIO_PERMITIDO, ex.: premix.com.br).
   Visitantes anônimos (fornecedores) só chegam aos formulários públicos. */
export function usuarioInterno() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { email = ''; }
  if (!email) return false;
  const dom = String(PropertiesService.getScriptProperties().getProperty('DOMINIO_PERMITIDO') || '').toLowerCase().replace(/^@/, '');
  return !dom || email.endsWith('@' + dom);
}

const _perfil = typeof __PERFIL__ === 'undefined' ? { publicas: ['fornecedor', 'produtos'] } : __PERFIL__;
const PUBLICAS = _perfil.publicas;
const PAGINAS = {
  painel: { arquivo: 'Painel', titulo: 'Premix — Central de Cadastros' },
  fornecedor: { arquivo: 'Fornecedor', titulo: 'Cadastro de Fornecedor — Premix' },
  produtos: { arquivo: 'Produtos', titulo: 'Cadastro de Produtos — Premix' },
};

export function paginaHtml(e) {
  const interno = usuarioInterno();
  const pedida = (e.parameter && e.parameter.pagina) || (interno ? 'painel' : PUBLICAS[0]);
  let chave = PAGINAS[pedida] && (PUBLICAS.includes(pedida) || interno) ? pedida : (interno ? 'painel' : PUBLICAS[0]);
  if (!chave) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:40px;color:#444">Acesso restrito a contas da organização. Entre com seu e-mail da Premix e tente novamente.</p>')
      .setTitle('Premix').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  const p = PAGINAS[chave];
  return HtmlService.createHtmlOutputFromFile(p.arquivo)
    .setTitle(p.titulo)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* O Portal de Lançamentos (outro Apps Script) envia o documento recebido por POST.
   O Apps Script não repassa cabeçalhos, então o segredo vai no corpo ("segredo") ou na URL (?segredo=). */
export function doPostExterno(e) {
  const saida = (obj) => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  try {
    const corpo = e.postData && e.postData.contents ? e.postData.contents : '';
    let dados = {};
    try { dados = corpo ? JSON.parse(corpo) : {}; } catch (err) { return saida({ error: 'JSON inválido.' }); }
    const segredo = (e.parameter && e.parameter.segredo) || dados.segredo || '';
    delete dados.segredo;
    const rota = (e.parameter && e.parameter.rota) || 'lancamentos/ingest';
    if (rota !== 'lancamentos/ingest') return saida({ error: 'Rota não permitida.' });
    const r = executar({
      metodo: 'POST', caminho: '/api/' + rota,
      cabecalhos: { 'x-lanc-secret': segredo, 'content-type': 'application/json' },
      corpo: JSON.stringify(dados),
    }, { semDepois: true });
    return saida(r.corpo ? JSON.parse(r.corpo) : { status: r.status });
  } catch (err) {
    return saida({ error: String(err && err.message || err) });
  }
}

/* Equivalentes dos crons: a rota continua a mesma, autenticada com o CRON_SECRET do próprio script. */
const GATILHOS = {
  lancamentos: { metodo: 'POST', caminho: '/api/lancamentos/cron' },
  pendencias: { metodo: 'GET', caminho: '/api/sync-sheets' },
};
export function executarGatilho(qual) {
  const g = GATILHOS[qual];
  if (!g) throw new Error('Gatilho desconhecido: ' + qual);
  const segredo = PropertiesService.getScriptProperties().getProperty('CRON_SECRET');
  const r = executar({ ...g, cabecalhos: { authorization: 'Bearer ' + segredo } });
  console.log('[gatilho ' + qual + '] ' + r.status + ' ' + String(r.corpo || '').slice(0, 500));
  return r.status;
}
