/**
 * Migração única: Supabase → Planilha + Drive compartilhado.
 *
 * 1. Em Propriedades do script, crie SUPABASE_URL e SUPABASE_SERVICE_KEY
 *    (Supabase → Project Settings → API → service_role). APAGUE a chave
 *    quando a migração terminar.
 * 2. Rode importarFornecedores()  — copia as linhas (uma vez só).
 * 3. Rode migrarArquivos() quantas vezes for preciso — cada execução copia
 *    documentos por ~4,5 min e para; ela continua de onde parou.
 */

function sbGet_(caminho) {
  var props = PropertiesService.getScriptProperties();
  var url = getProp_('SUPABASE_URL') + caminho;
  var key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('Defina SUPABASE_SERVICE_KEY nas propriedades do script.');
  var res = UrlFetchApp.fetch(url, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText());
  return res;
}

function importarFornecedores() {
  var existentes = {};
  Db.listar(PROP.PLANILHA_CADASTROS, 'fornecedores').forEach(function (r) { existentes[r.id] = true; });

  var total = 0, pagina = 0, tamanho = 500;
  while (true) {
    var lote = JSON.parse(sbGet_('/rest/v1/fornecedores?select=*&order=created_at.asc&limit=' + tamanho +
      '&offset=' + (pagina * tamanho)).getContentText());
    var novos = lote.filter(function (r) { return !existentes[r.id]; }).map(function (r) {
      ['created_at', 'updated_at', 'data_finalizacao', 'devolvido_em'].forEach(function (c) {
        if (r[c]) r[c] = new Date(r[c]);
      });
      return r;
    });
    total += Db.inserirVarios(PROP.PLANILHA_CADASTROS, 'fornecedores', novos);
    if (lote.length < tamanho) break;
    pagina++;
  }
  Logger.log('Fornecedores importados: ' + total);
}

var COLUNAS_URL = ['comprovante_cnpj_url', 'contrato_social_url', 'comprovante_bancario_url',
  'comprovante_ie_url', 'documento_identidade_url', 'comprovante_endereco_url'];

function migrarArquivos() {
  var inicio = Date.now();
  var raiz = DriveApp.getFolderById(getProp_(PROP.PASTA_FORNECEDORES));
  var sbUrl = getProp_('SUPABASE_URL');
  var linhas = Db.listar(PROP.PLANILHA_CADASTROS, 'fornecedores');
  var feitos = 0, pendentes = 0;

  for (var i = 0; i < linhas.length; i++) {
    var r = linhas[i];
    var colunas = COLUNAS_URL.filter(function (c) { return String(r[c] || '').indexOf(sbUrl) === 0; });
    if (!colunas.length) continue;
    if (Date.now() - inicio > 270000) { pendentes++; continue; }

    var pasta = r.pasta_drive_url
      ? DriveApp.getFolderById(String(r.pasta_drive_url).match(/folders\/([\w-]+)/)[1])
      : raiz.createFolder(nomePasta_(r));
    var campos = { pasta_drive_url: pasta.getUrl() };
    var lista = [];
    try { lista = JSON.parse(r.arquivos_drive || '[]') || []; } catch (e) { lista = []; }
    if (!Array.isArray(lista)) lista = [];

    colunas.forEach(function (c) {
      var caminho = String(r[c]).slice(sbUrl.length).replace('/object/public/', '/object/authenticated/');
      var blob = sbGet_(caminho).getBlob();
      var ext = (String(r[c]).split('.').pop() || 'pdf').toLowerCase();
      blob.setName(c.replace(/_url$/, '') + '.' + ext);
      var f = pasta.createFile(blob);
      campos[c] = f.getUrl();
      lista.push({ campo: c, id: f.getId(), nome: f.getName(), url: f.getUrl(), origem: 'supabase' });
    });
    campos.arquivos_drive = lista;
    Db.atualizar(PROP.PLANILHA_CADASTROS, 'fornecedores', r.id, campos);
    feitos++;
  }
  Logger.log('Fornecedores com arquivos migrados agora: ' + feitos +
    (pendentes ? ' | Ainda faltam ' + pendentes + ' — rode migrarArquivos() de novo.' : ' | Concluído.'));
}
