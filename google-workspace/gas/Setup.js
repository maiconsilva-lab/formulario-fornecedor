/**
 * INSTALAÇÃO E MIGRAÇÃO — rode pelo editor do Apps Script, nesta ordem:
 *
 *   1. configurar()          cria as 3 planilhas, as pastas do Drive e os segredos
 *   2. migrarTudo()          copia as tabelas do Supabase (rode de novo até dizer "Concluído")
 *   3. migrarArquivos()      copia os comprovantes do bucket para o Drive (idem)
 *   4. instalarGatilhos()    agenda a rotina de Lançamentos (a cada 10 min)
 *
 * Antes do passo 1, em Configurações do projeto → Propriedades do script, crie:
 *   PASTA_RAIZ        id da pasta do Drive compartilhado onde ficará tudo
 *   DOMINIO_PERMITIDO premix.com.br   (só contas desse domínio usam o painel)
 * Antes do passo 1 (se existir na Vercel), crie também:
 *   CTR_CHAVE              o mesmo valor da variável CTR_CHAVE do painel (cifra as senhas dos acessos de Contratos)
 * Antes do passo 2, crie ainda (e APAGUE depois do passo 3):
 *   SUPABASE_URL           https://frudrwxdygfticgcwigv.supabase.co
 *   SUPABASE_SERVICE_KEY   chave service_role do Supabase
 * (rode configurar() DEPOIS de criar essas duas, para a CTR_CHAVE herdar a chave certa quando a Vercel não tinha CTR_CHAVE)
 */

function props_() { return PropertiesService.getScriptProperties(); }
function exigir_(k) {
  var v = props_().getProperty(k);
  if (!v) throw new Error('Falta a propriedade do script: ' + k);
  return v;
}
function segredo_() {
  var h = Utilities.getUuid() + Utilities.getUuid();
  return h.replace(/-/g, '');
}

/** Cria planilhas, pastas e segredos (pode rodar de novo sem duplicar nada). */
function configurar() {
  var p = props_();
  var raiz = DriveApp.getFolderById(exigir_('PASTA_RAIZ'));

  function subpasta(nome, chave) {
    var id = p.getProperty(chave);
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recria */ } }
    var it = raiz.getFoldersByName(nome);
    var f = it.hasNext() ? it.next() : raiz.createFolder(nome);
    p.setProperty(chave, f.getId());
    return f;
  }
  subpasta('Fornecedores', 'PASTA_FORNECEDORES');
  subpasta('Imagens do painel', 'PASTA_IMAGENS');

  [['CADASTROS', 'Premix — Cadastros (banco de dados)'],
   ['OPERACAO', 'Premix — Operação (banco de dados)'],
   ['HISTORICO', 'Premix — Histórico (banco de dados)']].forEach(function (par) {
    var chave = 'PLANILHA_' + par[0];
    if (p.getProperty(chave)) return;
    var ss = SpreadsheetApp.create(par[1]);
    DriveApp.getFileById(ss.getId()).moveTo(raiz);
    var padrao = ss.getSheets()[0];
    p.setProperty(chave, ss.getId());
    p.setProperty('_PADRAO_' + par[0], padrao.getName());
  });

  ['SESSION_SECRET', 'CRON_SECRET', 'LANC_INGEST_SECRET'].forEach(function (k) {
    if (!p.getProperty(k)) p.setProperty(k, segredo_());
  });
  // As senhas dos "acessos" de Contratos estão cifradas com CTR_CHAVE; se ela não existia na Vercel,
  // a chave era derivada da service_role do Supabase. Mantém a mesma para as senhas migradas continuarem legíveis.
  if (!p.getProperty('CTR_CHAVE')) {
    var antiga = p.getProperty('SUPABASE_SERVICE_KEY');
    if (antiga) p.setProperty('CTR_CHAVE', antiga);
    else Logger.log('ATENÇÃO: defina CTR_CHAVE (a mesma da Vercel) antes de migrar, senão as senhas dos acessos de Contratos não poderão ser lidas.');
  }

  var n = __pmx().prepararAbas();
  // Remove a aba em branco que o Google cria junto com cada planilha.
  ['CADASTROS', 'OPERACAO', 'HISTORICO'].forEach(function (q) {
    var ss = SpreadsheetApp.openById(p.getProperty('PLANILHA_' + q));
    var nome = p.getProperty('_PADRAO_' + q);
    var aba = nome && ss.getSheetByName(nome);
    if (aba && ss.getSheets().length > 1) ss.deleteSheet(aba);
    // Protege contra edição manual: só o app (conta do script) grava.
    ss.getSheets().forEach(function (sh) {
      var prot = sh.protect().setDescription('Gravado apenas pelo sistema');
      prot.removeEditors(prot.getEditors().filter(function (u) { return u.getEmail() !== Session.getEffectiveUser().getEmail(); }));
      if (prot.canDomainEdit()) prot.setDomainEdit(false);
    });
  });

  Logger.log('Abas criadas: ' + n);
  ['CADASTROS', 'OPERACAO', 'HISTORICO'].forEach(function (q) {
    Logger.log(q + ': ' + SpreadsheetApp.openById(p.getProperty('PLANILHA_' + q)).getUrl());
  });
  Logger.log('SEGREDO do Portal de Lançamentos (LANC_INGEST_SECRET): veja em Propriedades do script.');
}

/* ── Supabase → Planilhas ── */
function sb_(caminho, opts) {
  var url = exigir_('SUPABASE_URL') + caminho;
  var key = exigir_('SUPABASE_SERVICE_KEY');
  var res = UrlFetchApp.fetch(url, Object.assign({ headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true }, opts || {}));
  if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ' em ' + caminho + ': ' + res.getContentText().slice(0, 200));
  return res;
}

// Tabelas efêmeras (limites de uso, travas, chat de 10 min) não precisam ir.
var NAO_MIGRAR_ = ['rate_limits', 'sync_lock', 'chat_messages', 'chat_sessions'];
var CHAVE_ORDEM_ = {
  auditoria: 'id', ctr_historico: 'id', lanc_historico: 'id', logs_atividade: 'created_at',
};

function migrarTudo() {
  var inicio = Date.now();
  var tabelas = __pmx().__tabelas || [];
  if (!tabelas.length) { tabelas = Object.keys(__pmx().esquema()); }
  var feitas = [], puladas = [], pendentes = [];
  tabelas.forEach(function (t) {
    if (NAO_MIGRAR_.indexOf(t) >= 0) return;
    if (Date.now() - inicio > 270000) { pendentes.push(t); return; }
    var todas = [];
    var tam = 1000, pag = 0;
    for (;;) {
      var ordem = CHAVE_ORDEM_[t] ? '&order=' + CHAVE_ORDEM_[t] + '.asc' : '';
      var lote = JSON.parse(sb_('/rest/v1/' + t + '?select=*&limit=' + tam + '&offset=' + (pag * tam) + ordem).getContentText());
      todas = todas.concat(lote);
      if (lote.length < tam) break;
      pag++;
    }
    if (!todas.length) { puladas.push(t + ' (vazia)'); return; }
    var n = __pmx().importarTabela(t, todas);
    if (n < 0) puladas.push(t + ' (já tinha ' + (-n) + ' linhas)'); else feitas.push(t + ': ' + n);
  });
  Logger.log('Importadas: ' + (feitas.join(' | ') || '—'));
  Logger.log('Puladas: ' + (puladas.join(' | ') || '—'));
  Logger.log(pendentes.length ? 'Faltam: ' + pendentes.join(', ') + ' — rode migrarTudo() de novo.' : 'Concluído.');
}

/** Copia os comprovantes do bucket para o Drive e troca os links nas linhas dos fornecedores. */
var COLUNAS_URL_ = ['comprovante_cnpj_url', 'contrato_social_url', 'comprovante_bancario_url',
  'comprovante_ie_url', 'documento_identidade_url', 'comprovante_endereco_url'];

function migrarArquivos() {
  var inicio = Date.now();
  var base = exigir_('SUPABASE_URL');
  var raiz = DriveApp.getFolderById(exigir_('PASTA_FORNECEDORES'));
  var db = __pmx().createClient();
  var linhas = __pmx().agora(db.from('fornecedores').select('*')).data || [];
  var feitos = 0, falhas = 0, restantes = 0;
  linhas.forEach(function (r) {
    var colunas = COLUNAS_URL_.filter(function (c) { return String(r[c] || '').indexOf(base) === 0; });
    if (!colunas.length) return;
    if (Date.now() - inicio > 270000) { restantes++; return; }
    var nome = String(r.razao_social || r.nome_completo || 'Sem nome');
    var doc = String(r.cnpj || r.cpf || '').replace(/\D/g, '');
    var pasta = raiz.createFolder((nome + (doc ? ' - ' + doc : '') + ' - ' + String(r.id).slice(0, 8)).replace(/[\\/:*?"<>|]/g, '-').slice(0, 150));
    var atualiza = { pasta_drive_url: pasta.getUrl() };
    var lista = Array.isArray(r.arquivos_drive) ? r.arquivos_drive : [];
    try {
      colunas.forEach(function (c) {
        var caminho = String(r[c]).slice(base.length).replace('/object/public/', '/object/authenticated/');
        var blob = sb_(caminho).getBlob();
        var ext = (String(r[c]).split('.').pop() || 'pdf').toLowerCase();
        blob.setName(c.replace(/_url$/, '') + '.' + ext);
        var f = pasta.createFile(blob);
        atualiza[c] = f.getUrl();
        lista.push({ campo: c, id: f.getId(), nome: f.getName(), url: f.getUrl(), origem: 'supabase' });
      });
      atualiza.arquivos_drive = lista;
      __pmx().agora(db.from('fornecedores').update(atualiza).eq('id', r.id));
      feitos++;
    } catch (e) {
      falhas++;
      Logger.log('Falhou ' + nome + ': ' + e.message);
      pasta.setTrashed(true);
    }
  });
  Logger.log('Fornecedores com arquivos migrados agora: ' + feitos + ' | falhas: ' + falhas +
    (restantes ? ' | Ainda faltam ' + restantes + ' — rode migrarArquivos() de novo.' : ' | Concluído.'));
}

/** Rotinas agendadas (equivalem ao cron do painel). Rode uma vez. */
function instalarGatilhos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gatilhoLancamentos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('gatilhoLancamentos').timeBased().everyMinutes(10).create();
  Logger.log('Gatilho de Lançamentos instalado (a cada 10 minutos).');
}

/** Mostra o que falta configurar para cada integração. */
function diagnostico() {
  var p = props_();
  ['PASTA_RAIZ', 'PASTA_FORNECEDORES', 'PASTA_IMAGENS', 'PLANILHA_CADASTROS', 'PLANILHA_OPERACAO', 'PLANILHA_HISTORICO',
   'DOMINIO_PERMITIDO', 'SESSION_SECRET', 'CRON_SECRET', 'LANC_INGEST_SECRET'].forEach(function (k) {
    Logger.log((p.getProperty(k) ? 'OK      ' : 'FALTA   ') + k);
  });
  ['PONTE_PLANILHA_ID', 'LANC_SYNC_SHEET_ID', 'LANC_BASE_SHEET_ID', 'CTR_PLANILHA_ID', 'GOOGLE_SHEET_ID', 'GEMINI_API_KEY', 'EMAILJS_SERVICE'].forEach(function (k) {
    Logger.log((p.getProperty(k) ? 'OK      ' : 'opcional') + ' ' + k);
  });
}
