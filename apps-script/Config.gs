/**
 * Configuração central do sistema Premix no Google Workspace.
 *
 * Os IDs das planilhas e da pasta do Drive ficam nas Propriedades do Script
 * (Configurações do projeto → Propriedades do script), nunca no código.
 * Rode `setup()` uma vez para criar tudo automaticamente.
 */

var PROP = {
  PLANILHA_CADASTROS: 'PLANILHA_CADASTROS',   // fornecedores, produtos, filiais, usuários
  PASTA_FORNECEDORES: 'PASTA_FORNECEDORES'    // pasta no Drive compartilhado
};

/** Colunas da aba `fornecedores` — mesma ordem/nome da tabela no Supabase. */
var COLUNAS_FORNECEDORES = [
  'id', 'created_at', 'updated_at', 'status', 'observacoes_internas',
  'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual', 'ramo_atividade',
  'responsavel_nome', 'responsavel_cargo', 'telefone', 'celular', 'email', 'website',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado',
  'banco', 'agencia', 'conta', 'tipo_conta', 'pix', 'titular_conta', 'cpf_cnpj_titular',
  'comprovante_cnpj_url', 'comprovante_bancario_url', 'produtos_servicos', 'condicoes_pagamento',
  'tipo_cadastro', 'atribuido_para', 'finalizado_por', 'data_finalizacao',
  'cpf', 'rg', 'nome_completo', 'antt', 'cnh_categoria', 'documento_identidade_url',
  'contrato_social_url', 'inscricao_estadual_isento', 'motivo_devolucao', 'comprovante_ie_url',
  'comprovante_endereco_url', 'apenas_boleto', 'codigo_fornecedor', 'nome_solicitante',
  'email_solicitante', 'data_nascimento', 'devolvido_em', 'devolvido_por',
  'campos_a_corrigir', 'arquivos_drive', 'pasta_drive_url'
];

function getProp_(nome) {
  var v = PropertiesService.getScriptProperties().getProperty(nome);
  if (!v) throw new Error('Configuração ausente: ' + nome + '. Rode setup() primeiro.');
  return v;
}

/**
 * Cria a planilha de Cadastros e a pasta de documentos.
 *
 * Antes de rodar: crie no Drive compartilhado uma pasta (ex.: "Fornecedores")
 * e cole o ID dela abaixo — é o trecho da URL depois de /folders/.
 */
function setup() {
  var ID_PASTA_DRIVE_COMPARTILHADO = 'COLE_AQUI_O_ID_DA_PASTA';

  var props = PropertiesService.getScriptProperties();

  if (ID_PASTA_DRIVE_COMPARTILHADO.indexOf('COLE_AQUI') === 0) {
    throw new Error('Edite setup() e informe o ID da pasta do Drive compartilhado.');
  }
  var pasta = DriveApp.getFolderById(ID_PASTA_DRIVE_COMPARTILHADO);
  props.setProperty(PROP.PASTA_FORNECEDORES, pasta.getId());

  var ssId = props.getProperty(PROP.PLANILHA_CADASTROS);
  var ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create('Premix — Cadastros (banco de dados)');
    // Guarda a planilha dentro do Drive compartilhado, junto dos documentos.
    var arquivo = DriveApp.getFileById(ss.getId());
    arquivo.moveTo(pasta.getParents().hasNext() ? pasta.getParents().next() : pasta);
    props.setProperty(PROP.PLANILHA_CADASTROS, ss.getId());
  }

  garantirAba_(ss, 'fornecedores', COLUNAS_FORNECEDORES);

  var padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  Logger.log('Planilha: ' + ss.getUrl());
  Logger.log('Pasta de documentos: ' + pasta.getUrl());
}

function garantirAba_(ss, nome, colunas) {
  var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
  var atual = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String)
    : [];
  var faltando = colunas.filter(function (c) { return atual.indexOf(c) === -1; });
  if (faltando.length) {
    sh.getRange(1, atual.length + 1, 1, faltando.length).setValues([faltando]);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#E8F5E9');
  // Só o dono do script edita a aba; o app grava como dono (USER_DEPLOYING).
  var protecao = sh.protect().setDescription('Gravado apenas pelo sistema');
  protecao.removeEditors(protecao.getEditors());
  protecao.setWarningOnly(false);
  return sh;
}
