/**
 * Recebe o cadastro do formulário público e grava:
 *   - os dados na aba `fornecedores` da planilha de Cadastros;
 *   - os documentos numa pasta própria do fornecedor no Drive compartilhado.
 *
 * Toda validação é refeita aqui no servidor: o navegador do fornecedor
 * não tem acesso direto à planilha nem ao Drive.
 */

var TIPOS_CADASTRO = ['pj', 'pf', 'motorista', 'atualizacao_bancaria'];

/** Campo de arquivo do formulário → coluna de URL e rótulo do arquivo no Drive. */
var ARQUIVOS = {
  comprovante_cnpj:         { coluna: 'comprovante_cnpj_url',     rotulo: 'Cartão CNPJ',           tipos: ['pj'] },
  contrato_social:          { coluna: 'contrato_social_url',      rotulo: 'Contrato Social',       tipos: ['pj'] },
  comprovante_bancario:     { coluna: 'comprovante_bancario_url', rotulo: 'Comprovante Bancário',  tipos: ['pj'] },
  comprovante_ie:           { coluna: 'comprovante_ie_url',       rotulo: 'Comprovante IE',        tipos: ['pj'] },
  documento_identidade:     { coluna: 'documento_identidade_url', rotulo: 'Documento com Foto',    tipos: ['pf'] },
  comprovante_bancario_pf:  { coluna: 'comprovante_bancario_url', rotulo: 'Comprovante Bancário',  tipos: ['pf'] },
  documento_identidade_mot: { coluna: 'documento_identidade_url', rotulo: 'CNH - Documento com Foto', tipos: ['motorista'] },
  comprovante_endereco_mot: { coluna: 'comprovante_endereco_url', rotulo: 'Comprovante de Endereço', tipos: ['motorista'] },
  comprovante_bancario_atu: { coluna: 'comprovante_bancario_url', rotulo: 'Novo Comprovante Bancário', tipos: ['atualizacao_bancaria'] }
};

/** Campos que o formulário pode preencher (o resto é do sistema). */
var CAMPOS_PUBLICOS = [
  'tipo_cadastro', 'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual', 'ramo_atividade',
  'produtos_servicos', 'nome_completo', 'cpf', 'rg', 'data_nascimento', 'cnh_categoria', 'antt',
  'responsavel_nome', 'responsavel_cargo', 'telefone', 'celular', 'email', 'website',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado',
  'banco', 'tipo_conta', 'agencia', 'conta', 'titular_conta', 'cpf_cnpj_titular', 'pix',
  'condicoes_pagamento', 'nome_solicitante', 'email_solicitante',
  'inscricao_estadual_isento', 'apenas_boleto'
];

var MAX_ARQUIVO_BYTES = 5 * 1024 * 1024;
var MAX_ENVIOS_POR_10MIN = 40;

/** Chamado pelo formulário via google.script.run. */
function salvarFornecedor(payload) {
  try {
    if (!payload || typeof payload !== 'object') throw new Error('Envio inválido.');
    if (payload.hp) return { ok: true }; // campo-isca preenchido por robô: ignora em silêncio
    limitarEnvios_();

    var dados = limparDados_(payload.dados || {});
    var arquivos = validarArquivos_(payload.arquivos || [], dados.tipo_cadastro);
    validarObrigatorios_(dados, arquivos);

    var id = Utilities.getUuid();
    var agora = new Date();
    var registro = {};
    Object.keys(dados).forEach(function (k) { registro[k] = dados[k]; });
    registro.id = id;
    registro.created_at = agora;
    registro.updated_at = agora;
    registro.status = 'pendente';

    var pasta = salvarArquivosNoDrive_(registro, arquivos);
    try {
      Db.inserir(PROP.PLANILHA_CADASTROS, 'fornecedores', registro);
    } catch (e) {
      pasta.setTrashed(true); // não deixa documentos órfãos se a gravação falhar
      throw e;
    }
    return { ok: true, id: id };
  } catch (e) {
    console.error(e);
    return { ok: false, erro: e.message || String(e) };
  }
}

function limitarEnvios_() {
  var cache = CacheService.getScriptCache();
  var chave = 'envios_' + Math.floor(Date.now() / 600000);
  var n = Number(cache.get(chave) || 0) + 1;
  if (n > MAX_ENVIOS_POR_10MIN) throw new Error('Muitos envios no momento. Tente novamente em alguns minutos.');
  cache.put(chave, String(n), 700);
}

function limparDados_(entrada) {
  var d = {};
  CAMPOS_PUBLICOS.forEach(function (c) {
    var v = entrada[c];
    if (v === undefined || v === null || v === '') return;
    if (c === 'inscricao_estadual_isento' || c === 'apenas_boleto') { d[c] = v === true || v === 'true'; return; }
    v = String(v).trim().slice(0, 2000);
    if (v) d[c] = v;
  });
  if (TIPOS_CADASTRO.indexOf(d.tipo_cadastro) === -1) throw new Error('Tipo de cadastro inválido.');
  if (d.tipo_cadastro === 'motorista') d.apenas_boleto = false;
  if (d.tipo_cadastro === 'atualizacao_bancaria') d.apenas_boleto = false;
  if (d.apenas_boleto) {
    ['banco', 'agencia', 'conta', 'titular_conta', 'cpf_cnpj_titular', 'pix', 'tipo_conta']
      .forEach(function (c) { delete d[c]; });
  }
  if (!d.razao_social) d.razao_social = d.nome_completo || d.responsavel_nome || 'Sem nome';
  return d;
}

function validarObrigatorios_(d, arquivos) {
  var t = d.tipo_cadastro;
  var req = ['responsavel_nome', 'celular', 'email', 'cep', 'logradouro', 'numero',
             'bairro', 'cidade', 'estado', 'nome_solicitante', 'email_solicitante'];
  if (t === 'pj') req = req.concat(['razao_social', 'cnpj', 'inscricao_estadual']);
  if (t === 'pf') req = req.concat(['nome_completo', 'cpf', 'rg', 'data_nascimento']);
  if (t === 'motorista') req = req.concat(['nome_completo', 'cpf', 'rg', 'data_nascimento', 'cnh_categoria', 'antt']);
  if (t !== 'motorista' && !d.apenas_boleto) req = req.concat(['banco', 'agencia', 'conta', 'titular_conta', 'cpf_cnpj_titular']);

  var faltando = req.filter(function (c) { return !d[c]; });
  if (t === 'atualizacao_bancaria' && !d.cnpj && !d.cpf) faltando.push('cnpj/cpf');
  if (faltando.length) throw new Error('Campos obrigatórios não preenchidos: ' + faltando.join(', '));

  var email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.test(d.email) || !email.test(d.email_solicitante)) throw new Error('E-mail inválido.');
  if (d.cnpj && d.cnpj.replace(/\D/g, '').length !== 14) throw new Error('CNPJ inválido.');
  if (d.cpf && d.cpf.replace(/\D/g, '').length !== 11) throw new Error('CPF inválido.');

  var temArquivo = function (campo) { return arquivos.some(function (a) { return a.campo === campo; }); };
  var docs = [];
  if (t === 'pj') { docs = ['comprovante_cnpj', 'contrato_social']; if (!d.apenas_boleto) docs.push('comprovante_bancario'); }
  if (t === 'pf') { docs = ['documento_identidade']; if (!d.apenas_boleto) docs.push('comprovante_bancario_pf'); }
  if (t === 'motorista') docs = ['documento_identidade_mot'];
  if (t === 'atualizacao_bancaria') docs = ['comprovante_bancario_atu'];
  var faltaDoc = docs.filter(function (c) { return !temArquivo(c); });
  if (faltaDoc.length) {
    throw new Error('Anexe: ' + faltaDoc.map(function (c) { return ARQUIVOS[c].rotulo; }).join(', '));
  }
}

/** Decodifica e confere o conteúdo real do arquivo (não só a extensão). */
function validarArquivos_(lista, tipo) {
  if (!Array.isArray(lista) || lista.length > 6) throw new Error('Anexos inválidos.');
  var vistos = {};
  return lista.map(function (a) {
    var def = ARQUIVOS[a && a.campo];
    if (!def || def.tipos.indexOf(tipo) === -1 || vistos[a.campo]) throw new Error('Anexo inválido.');
    vistos[a.campo] = true;
    var bytes = Utilities.base64Decode(String(a.base64 || ''));
    if (!bytes.length) throw new Error('Arquivo vazio: ' + def.rotulo);
    if (bytes.length > MAX_ARQUIVO_BYTES) throw new Error('Arquivo maior que 5MB: ' + def.rotulo);
    var mime = detectarTipo_(bytes);
    if (!mime) throw new Error('Formato não aceito em "' + def.rotulo + '". Envie PDF, JPG ou PNG.');
    var ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[mime];
    return { campo: a.campo, def: def, bytes: bytes, mime: mime, ext: ext };
  });
}

function detectarTipo_(b) {
  var u = function (i) { return b[i] & 0xff; };
  if (u(0) === 0x25 && u(1) === 0x50 && u(2) === 0x44 && u(3) === 0x46) return 'application/pdf'; // %PDF
  if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return 'image/jpeg';
  if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47) return 'image/png';
  return null;
}

function nomePasta_(r) {
  var nome = r.razao_social || r.nome_completo || 'Sem nome';
  var doc = (r.cnpj || r.cpf || '').replace(/\D/g, '');
  var prefixo = r.tipo_cadastro === 'atualizacao_bancaria' ? '[Atualização] ' : '';
  return (prefixo + nome + (doc ? ' - ' + doc : '') + ' - ' + r.id.slice(0, 8))
    .replace(/[\\/:*?"<>|]/g, '-').slice(0, 150);
}

function salvarArquivosNoDrive_(registro, arquivos) {
  var raiz = DriveApp.getFolderById(getProp_(PROP.PASTA_FORNECEDORES));
  var pasta = raiz.createFolder(nomePasta_(registro));
  var lista = [];
  arquivos.forEach(function (a) {
    var blob = Utilities.newBlob(a.bytes, a.mime, a.def.rotulo + '.' + a.ext);
    var f = pasta.createFile(blob);
    registro[a.def.coluna] = f.getUrl();
    lista.push({ campo: a.campo, id: f.getId(), nome: f.getName(), url: f.getUrl() });
  });
  registro.arquivos_drive = lista;
  registro.pasta_drive_url = pasta.getUrl();
  return pasta;
}
