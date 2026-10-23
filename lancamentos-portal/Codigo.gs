/**
 * PORTAL DE LANÇAMENTOS FISCAIS — Apps Script (roda com a conta @premix de quem publica)
 *
 *  1) Formulário (app da Web, incorporado no Google Sites): recebe os dados e os PDFs.
 *  2) PDFs  -> Drive da Premix, pasta AAAA-MM / Filial. Nada vai para o Supabase.
 *  3) Dados -> uma linha na planilha-base (aba "Lancamentos") e um POST no painel (/api/lancamentos/ingest).
 *  4) Retorno: a cada 5 min o script pergunta ao painel o que foi lançado e grava na mesma linha
 *     Status, Responsável (quem lançou), Data Lançto e Nível de prioridade.
 *
 * Quem preenche o formulário não precisa de acesso à planilha nem à pasta: quem grava é o script.
 * Instalação passo a passo: LEIAME.md
 */

var ABA = 'Lancamentos';
var ABA_AUTORIZADOS = 'Autorizados';          // opcional: colunas E-mail | Nome | Ativo (Sim/Não)
var DOMINIO = '@premix.com.br';
var RESTRINGIR_A_AUTORIZADOS = false;         // true = só quem estiver ativo na aba "Autorizados"
var FUSO = 'America/Sao_Paulo';
var MAX_MB = 10;                              // por PDF
var MAX_TOTAL_MB = 20;                        // soma dos PDFs de um envio
var MAX_OBS = 300;
var COMPARTILHAR_COM_DOMINIO = true;          // quem tem o link e é da Premix abre o PDF (o painel usa isso)
var REENVIOS_POR_RODADA = 20;

var TIPOS = ['Nota Fiscal - Matéria prima', 'Nota Fiscal - Produto Acabado', 'Produtos (Compras Indiretos)',
  'Serviços (Compras Indiretos)', 'Frete - Produto Acabado', 'Frete - Matéria Prima', 'Frete - Compras Indiretos'];
var FILIAIS = ['Anápolis', 'Araguaina', 'Barra do Garças', 'Campo Grande', 'Centro de Pesquisa', 'Cuiabá', 'Estreito',
  'Goiânia', 'Gurupi', 'Linhares', 'Londrina', 'Paraguay', 'Patrocínio Paulista', 'Presidente Prudente',
  'Ribeirão Preto', 'Vilhena', 'Xinguara'];

// A..Q = as 17 colunas da base; R..T = apoio do script (ficam ocultas).
var CABECALHO = ['Data Envio', 'Usuário Solicitante', 'Filial', 'Tipo Doc', 'Nº Documento', 'Venc. Doc.', 'Nº CT-e',
  'Observações', 'Status Doc.', 'Link Doc.', 'Status Frete', 'Link Frete', 'Link Boleto', 'Responsável', 'Data Lançto',
  'Nível Prioridade', 'Observações Internas', 'ID', 'Painel', 'Venc. CT-e'];
var COL = { DATA: 1, USUARIO: 2, FILIAL: 3, TIPO: 4, NUMERO: 5, VENC: 6, CTE: 7, OBS: 8, STATUS_DOC: 9, LINK_DOC: 10,
  STATUS_FRETE: 11, LINK_FRETE: 12, LINK_BOLETO: 13, RESPONSAVEL: 14, DATA_LANC: 15, NIVEL: 16, OBS_INT: 17,
  ID: 18, PAINEL: 19, VENC_CTE: 20 };

/* ===================== Utilidades ===================== */

function prop_(k, opcional) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && !opcional) throw new Error('Falta a propriedade do script: ' + k);
  return v || '';
}
function limpar_(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim(); }
function digitos_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function pad9_(n) { return /^\d{1,8}$/.test(n) ? ('000000000' + n).slice(-9) : n; }   // 9 dígitos, como no Protheus
function ehFrete_(tipo) { return String(tipo).indexOf('Frete') === 0; }
function brDeIso_(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function isoDeBr_(br) { var m = String(br || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
function subpasta_(pai, nome) { var it = pai.getFoldersByName(nome); return it.hasNext() ? it.next() : pai.createFolder(nome); }

function abaLanc_() {
  var aba = SpreadsheetApp.openById(prop_('PLANILHA_ID')).getSheetByName(ABA);
  if (!aba) throw new Error('Aba "' + ABA + '" não encontrada. Rode a função "configurar" no editor.');
  return aba;
}

/* ===================== Quem pode enviar ===================== */

function pessoa_() {
  var email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email || email.slice(-DOMINIO.length) !== DOMINIO) return null;
  var nome = email.split('@')[0];
  var aba = SpreadsheetApp.openById(prop_('PLANILHA_ID')).getSheetByName(ABA_AUTORIZADOS);
  var achou = false;
  if (aba && aba.getLastRow() > 1) {
    var linhas = aba.getRange(2, 1, aba.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < linhas.length; i++) {
      if (String(linhas[i][0]).trim().toLowerCase() === email && /^(sim|s|ativo|1|x)$/i.test(String(linhas[i][2]).trim())) {
        achou = true; nome = String(linhas[i][1] || nome); break;
      }
    }
  }
  if (RESTRINGIR_A_AUTORIZADOS && !achou) return null;
  return { email: email, nome: nome };
}

/* ===================== Página ===================== */

function doGet() {
  var p = pessoa_();
  var t = HtmlService.createTemplateFromFile('Portal');
  t.pessoa = p;
  t.email = String(Session.getActiveUser().getEmail() || '');
  t.config = { tipos: TIPOS, filiais: FILIAIS, maxMb: MAX_MB, maxTotalMb: MAX_TOTAL_MB, maxObs: MAX_OBS };
  return t.evaluate()
    .setTitle('Lançamentos Fiscais · Premix')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);   // necessário para incorporar no Google Sites
}

/* ===================== 1) Arquivo -> Drive (uma chamada por PDF) ===================== */

function enviarArquivo(meta) {
  if (!pessoa_()) throw new Error('Você não está autorizado a enviar documentos. Fale com o Núcleo Fiscal.');
  if (!meta || !meta.base64 || !meta.nome) throw new Error('Arquivo vazio.');
  var filial = limpar_(meta.filial); var numero = digitos_(meta.numero);
  if (FILIAIS.indexOf(filial) < 0) throw new Error('Filial inválida.');
  if (!numero) throw new Error('Informe o número do documento antes de anexar.');

  var bytes = Utilities.base64Decode(meta.base64);
  if (bytes.length > MAX_MB * 1048576) throw new Error('"' + meta.nome + '" passa de ' + MAX_MB + ' MB.');
  // PDF de verdade: começa com "%PDF" (não confia só na extensão que o navegador mandou)
  if (!(bytes.length > 4 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) {
    throw new Error('"' + meta.nome + '" não é um PDF válido.');
  }

  var agora = new Date();
  var pasta = subpasta_(subpasta_(DriveApp.getFolderById(prop_('PASTA_RAIZ')), Utilities.formatDate(agora, FUSO, 'yyyy-MM')), filial);
  var papel = { nf: 'DOC', frete: 'CTE', boleto: 'BOLETO' }[meta.papel] || 'DOC';
  var nome = Utilities.formatDate(agora, FUSO, 'yyyyMMdd-HHmmss') + '_' + papel + '_' + numero + '.pdf';
  var arquivo = pasta.createFile(Utilities.newBlob(bytes, 'application/pdf', nome));
  if (COMPARTILHAR_COM_DOMINIO) {
    try { arquivo.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* política do domínio: segue com o acesso da pasta */ }
  }
  var md5 = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return { link: arquivo.getUrl(), nome: nome, md5: md5 };
}

/* ===================== 2) Linha na planilha + painel ===================== */

function validar_(d) {
  var f = {
    filial: limpar_(d.filial), tipo: limpar_(d.tipo), numero: digitos_(d.numero),
    venc: String(d.vencimento || ''), obs: limpar_(d.observacoes).slice(0, MAX_OBS),
    possuiFrete: !!d.possuiFrete, numCte: digitos_(d.numCte), vencCte: String(d.vencimentoCte || ''),
    linkNf: d.linkNf || '', linkFrete: d.linkFrete || '', linkBoleto: d.linkBoleto || '',
    md5Nf: d.md5Nf || '', md5Cte: d.md5Cte || '', possuiBoleto: !!d.possuiBoleto
  };
  var dataOk = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00')); };
  if (FILIAIS.indexOf(f.filial) < 0) throw new Error('Filial inválida.');
  if (TIPOS.indexOf(f.tipo) < 0) throw new Error('Tipo inválido.');
  if (!f.numero) throw new Error('Informe o número do documento.');
  if (!dataOk(f.venc)) throw new Error('Informe o vencimento do documento.');
  if (!f.linkNf) throw new Error('Anexe o documento principal.');
  if (ehFrete_(f.tipo)) f.possuiFrete = false;   // o próprio documento já é o frete
  if (f.possuiFrete) {
    if (!f.numCte) throw new Error('Informe o número do CT-e.');
    if (!dataOk(f.vencCte)) throw new Error('Informe o vencimento do CT-e.');
    if (!f.linkFrete) throw new Error('Anexe o PDF do CT-e.');
  } else { f.numCte = ''; f.vencCte = ''; f.linkFrete = ''; }
  if (f.possuiBoleto && !f.linkBoleto) throw new Error('Anexe o PDF do boleto.');
  if (!f.possuiBoleto) f.linkBoleto = '';
  return f;
}

function registrarEnvio(d) {
  var p = pessoa_();
  if (!p) throw new Error('Você não está autorizado a enviar documentos.');
  var f = validar_(d);
  var nro = pad9_(f.numero);
  var id, agora;

  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var aba = abaLanc_();
    if (!d.forcar && jaEnviado_(aba, f.filial, f.tipo, nro)) {
      return { ok: false, duplicado: true, mensagem: 'Já existe um envio igual (filial, tipo e número). Enviar mesmo assim?' };
    }
    // ID = segundo do envio + filial: é a mesma identidade que o painel usa. Duas filiais iguais no mesmo segundo ganham +1 s.
    var ids = aba.getLastRow() > 1 ? aba.getRange(Math.max(2, aba.getLastRow() - 300), COL.ID, Math.min(300, aba.getLastRow() - 1), 1).getValues().map(function (r) { return String(r[0]); }) : [];
    agora = new Date();
    do { id = Math.floor(agora.getTime() / 1000) + '|' + f.filial; if (ids.indexOf(id) >= 0) agora = new Date(agora.getTime() + 1000); } while (ids.indexOf(id) >= 0);

    var linha = aba.getLastRow() + 1;
    [COL.DATA, COL.NUMERO, COL.VENC, COL.CTE, COL.ID, COL.VENC_CTE].forEach(function (c) { aba.getRange(linha, c).setNumberFormat('@'); });  // texto: sem perder zeros nem trocar dia
    var valores = new Array(CABECALHO.length);
    for (var i = 0; i < valores.length; i++) valores[i] = '';
    valores[COL.DATA - 1] = Utilities.formatDate(agora, FUSO, 'dd/MM/yyyy HH:mm:ss');
    valores[COL.USUARIO - 1] = p.email;
    valores[COL.FILIAL - 1] = f.filial;
    valores[COL.TIPO - 1] = f.tipo;
    valores[COL.NUMERO - 1] = nro;
    valores[COL.VENC - 1] = brDeIso_(f.venc);
    valores[COL.CTE - 1] = f.numCte ? pad9_(f.numCte) : '';
    valores[COL.OBS - 1] = f.obs;
    valores[COL.STATUS_DOC - 1] = 'Lançar';
    valores[COL.LINK_DOC - 1] = f.linkNf;
    valores[COL.STATUS_FRETE - 1] = f.possuiFrete ? 'Lançar' : '';
    valores[COL.LINK_FRETE - 1] = f.linkFrete;
    valores[COL.LINK_BOLETO - 1] = f.linkBoleto;
    valores[COL.ID - 1] = id;
    valores[COL.PAINEL - 1] = 'Pendente';
    valores[COL.VENC_CTE - 1] = brDeIso_(f.vencCte);
    aba.getRange(linha, 1, 1, valores.length).setValues([valores]);
  } finally {
    trava.releaseLock();
  }

  // Painel: se estiver fora do ar, a linha fica "Pendente" e a rotina de 5 min reenvia. O envio do usuário não falha.
  var ok = enviarAoPainel_({
    filial: f.filial, tipo: f.tipo, numDoc: nro, vencimento: f.venc, observacoes: f.obs,
    linkNf: f.linkNf, linkFrete: f.linkFrete, linkBoleto: f.linkBoleto, usuario: p.email, recebidoEm: agora,
    arquivoMd5: f.md5Nf, cteMd5: f.md5Cte, numCte: f.numCte, vencimentoCte: f.vencCte
  });
  var celula = achaLinhaPorId_(abaLanc_(), id);
  if (celula && ok) celula.offset(0, COL.PAINEL - COL.ID).setValue('OK');
  return { ok: true, numero: nro, painel: ok };
}

function jaEnviado_(aba, filial, tipo, nro) {
  var ult = aba.getLastRow();
  if (ult < 2) return false;
  var n = Math.min(1500, ult - 1);
  var v = aba.getRange(ult - n + 1, COL.FILIAL, n, 3).getDisplayValues();   // C filial, D tipo, E nº
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] === filial && v[i][1] === tipo && digitos_(v[i][2]) === digitos_(nro)) return true;
  }
  return false;
}

function achaLinhaPorId_(aba, id) {
  if (aba.getLastRow() < 2) return null;
  return aba.getRange(2, COL.ID, aba.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
}

/* ===================== 3) Painel (envio) ===================== */

function painel_(metodo, caminho, corpo, segredoProp) {
  var url = prop_('PAINEL_URL').replace(/\/+$/, '');
  var op = { method: metodo, headers: { 'x-lanc-secret': prop_(segredoProp) }, muteHttpExceptions: true };
  if (corpo) { op.contentType = 'application/json'; op.payload = JSON.stringify(corpo); }
  var r = UrlFetchApp.fetch(url + caminho, op);
  var json = {};
  try { json = JSON.parse(r.getContentText()); } catch (e) { /* resposta não-JSON */ }
  return { codigo: r.getResponseCode(), json: json, texto: r.getContentText().slice(0, 200) };
}

function enviarAoPainel_(d) {
  try {
    var r = painel_('post', '/api/lancamentos/ingest', {
      filial: d.filial, tipo: d.tipo, numDoc: d.numDoc, vencimento: d.vencimento, observacoes: d.observacoes,
      linkNf: d.linkNf || null, linkFrete: d.linkFrete || null, linkBoleto: d.linkBoleto || null,
      usuario: d.usuario, recebidoEm: d.recebidoEm.toISOString(),
      arquivoMd5: d.arquivoMd5 || null, cteMd5: d.cteMd5 || null,
      numCte: d.numCte || '', vencimentoCte: d.vencimentoCte || null
    }, 'PAINEL_SEGREDO_ENVIO');
    if (r.codigo >= 200 && r.codigo < 300 && r.json.ok) return true;
    console.warn('Painel recusou o envio (' + r.codigo + '): ' + r.texto);
  } catch (e) {
    console.warn('Falha ao enviar ao painel: ' + e);
  }
  return false;
}

/* Linhas "Pendente" na coluna Painel: reconstrói o envio a partir da própria linha e tenta de novo. */
function reenviarPendentes_() {
  var aba = abaLanc_();
  var ult = aba.getLastRow();
  if (ult < 2) return 0;
  var painel = aba.getRange(2, COL.PAINEL, ult - 1, 1).getValues();
  var feitos = 0;
  for (var i = 0; i < painel.length && feitos < REENVIOS_POR_RODADA; i++) {
    if (painel[i][0] !== 'Pendente') continue;
    var linha = i + 2;
    var r = aba.getRange(linha, 1, 1, CABECALHO.length).getDisplayValues()[0];
    var id = r[COL.ID - 1];
    var segundos = Number(String(id).split('|')[0]);
    if (!segundos) continue;
    var ok = enviarAoPainel_({
      filial: r[COL.FILIAL - 1], tipo: r[COL.TIPO - 1], numDoc: r[COL.NUMERO - 1], vencimento: isoDeBr_(r[COL.VENC - 1]),
      observacoes: r[COL.OBS - 1], linkNf: r[COL.LINK_DOC - 1], linkFrete: r[COL.LINK_FRETE - 1], linkBoleto: r[COL.LINK_BOLETO - 1],
      usuario: r[COL.USUARIO - 1], recebidoEm: new Date(segundos * 1000),
      numCte: r[COL.CTE - 1], vencimentoCte: isoDeBr_(r[COL.VENC_CTE - 1])
    });
    if (ok) { aba.getRange(linha, COL.PAINEL).setValue('OK'); feitos++; }
  }
  return feitos;
}

/* ===================== 4) Retorno: painel -> planilha ===================== */

function sincronizarLancados_() {
  var props = PropertiesService.getScriptProperties();
  var aba = abaLanc_();
  var ult = aba.getLastRow();
  var atualizados = 0;
  for (var rodada = 0; rodada < 10; rodada++) {   // até 5.000 itens por execução
    var desde = props.getProperty('CURSOR_LANCADOS') || '';
    var r = painel_('get', '/api/lancamentos/lancados?limite=500' + (desde ? '&desde=' + encodeURIComponent(desde) : ''), null, 'PAINEL_SEGREDO_LEITURA');
    if (r.codigo !== 200) { console.warn('Painel (lançados): ' + r.codigo + ' ' + r.texto); return atualizados; }
    var itens = r.json.itens || [];
    if (!itens.length) return atualizados;
    if (ult < 2) { props.setProperty('CURSOR_LANCADOS', r.json.proximo); return atualizados; }

    var ids = aba.getRange(2, COL.ID, ult - 1, 1).getValues().map(function (x) { return String(x[0]); });
    itens.forEach(function (it) {
      var i = ids.indexOf(Math.floor(new Date(it.recebido_em).getTime() / 1000) + '|' + it.filial);
      if (i < 0) return;                         // documento que não veio por este portal
      var linha = i + 2;
      if (it.documento_pai_id) {                 // CT-e que veio junto com a NF
        aba.getRange(linha, COL.STATUS_FRETE).setValue(it.status || '');
      } else {
        var lancado = it.status === 'Lançado';
        aba.getRange(linha, COL.STATUS_DOC).setValue(it.status || '');
        aba.getRange(linha, COL.RESPONSAVEL).setValue(lancado ? (it.lancado_por || '') : '');
        aba.getRange(linha, COL.DATA_LANC).setNumberFormat('@').setValue(lancado && it.lancado_em ? Utilities.formatDate(new Date(it.lancado_em), FUSO, 'dd/MM/yyyy') : '');
        aba.getRange(linha, COL.NIVEL).setValue(it.nivel || '');
      }
      atualizados++;
    });
    props.setProperty('CURSOR_LANCADOS', r.json.proximo);   // só avança depois de gravar
    if (itens.length < 500) break;
  }
  return atualizados;
}

/* ===================== Rotina (gatilho de 5 min) ===================== */

function rotina() {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(2000)) return;   // execução anterior ainda rodando
  try {
    var reenviados = reenviarPendentes_();
    var atualizados = sincronizarLancados_();
    console.log('Reenviados ao painel: ' + reenviados + ' · linhas atualizadas com o retorno do painel: ' + atualizados);
  } finally {
    trava.releaseLock();
  }
}

/* ===================== Instalação (rode pelo editor, nesta ordem) ===================== */

function autorizar() {
  DriveApp.getFolderById(prop_('PASTA_RAIZ')).getName();
  SpreadsheetApp.openById(prop_('PLANILHA_ID')).getName();
  UrlFetchApp.fetch(prop_('PAINEL_URL'), { muteHttpExceptions: true });
  console.log('Permissões concedidas. Usuário do script: ' + Session.getEffectiveUser().getEmail());
}

/* Cria a aba "Lancamentos" com o cabeçalho, esconde as colunas de apoio e congela a primeira linha. */
function configurar() {
  var planilha = SpreadsheetApp.openById(prop_('PLANILHA_ID'));
  var aba = planilha.getSheetByName(ABA) || planilha.insertSheet(ABA);
  aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]).setFontWeight('bold').setBackground('#123d6b').setFontColor('#ffffff');
  aba.setFrozenRows(1);
  aba.hideColumns(COL.ID, 3);   // ID, Painel, Venc. CT-e
  if (!planilha.getSheetByName(ABA_AUTORIZADOS)) {
    var a = planilha.insertSheet(ABA_AUTORIZADOS);
    a.getRange(1, 1, 1, 3).setValues([['E-mail', 'Nome', 'Ativo']]).setFontWeight('bold');
  }
  console.log('Planilha pronta.');
}

function testarPainel() {
  var r = painel_('get', '/api/lancamentos/lancados?limite=1', null, 'PAINEL_SEGREDO_LEITURA');
  if (r.codigo === 200) console.log('Painel respondeu OK (leitura).');
  else console.warn('Falhou (' + r.codigo + '): ' + r.texto + ' — confira PAINEL_URL e PAINEL_SEGREDO_LEITURA e se o painel já tem a rota /lancados.');
}

function instalarGatilho() {
  removerGatilho();
  ScriptApp.newTrigger('rotina').timeBased().everyMinutes(5).create();
  console.log('Gatilho instalado: a cada 5 minutos.');
}

function removerGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rotina') ScriptApp.deleteTrigger(t); });
}
