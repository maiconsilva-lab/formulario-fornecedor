/* Formulários públicos (fornecedor e produtos): validam no servidor, gravam nas
   planilhas e guardam os documentos numa pasta por fornecedor no Drive compartilhado. */
import { createClient } from './db/consulta.js';
import { resolverAgora } from './shims/promessa.js';

const sync = (p) => resolverAgora(p);
const TIPOS = ['pj', 'pf', 'motorista', 'atualizacao_bancaria'];
const MAX_ARQUIVO = 5 * 1024 * 1024;

const ARQUIVOS = {
  comprovante_cnpj:         { coluna: 'comprovante_cnpj_url',     rotulo: 'Cartão CNPJ',                tipos: ['pj'] },
  contrato_social:          { coluna: 'contrato_social_url',      rotulo: 'Contrato Social',            tipos: ['pj'] },
  comprovante_bancario:     { coluna: 'comprovante_bancario_url', rotulo: 'Comprovante Bancário',       tipos: ['pj'] },
  comprovante_ie:           { coluna: 'comprovante_ie_url',       rotulo: 'Comprovante IE',             tipos: ['pj'] },
  documento_identidade:     { coluna: 'documento_identidade_url', rotulo: 'Documento com Foto',         tipos: ['pf'] },
  comprovante_bancario_pf:  { coluna: 'comprovante_bancario_url', rotulo: 'Comprovante Bancário',       tipos: ['pf'] },
  documento_identidade_mot: { coluna: 'documento_identidade_url', rotulo: 'CNH - Documento com Foto',   tipos: ['motorista'] },
  comprovante_endereco_mot: { coluna: 'comprovante_endereco_url', rotulo: 'Comprovante de Endereço',    tipos: ['motorista'] },
  comprovante_bancario_atu: { coluna: 'comprovante_bancario_url', rotulo: 'Novo Comprovante Bancário',  tipos: ['atualizacao_bancaria'] },
};
const CAMPOS = [
  'tipo_cadastro', 'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual', 'ramo_atividade', 'produtos_servicos',
  'nome_completo', 'cpf', 'rg', 'data_nascimento', 'cnh_categoria', 'antt',
  'responsavel_nome', 'responsavel_cargo', 'telefone', 'celular', 'email', 'website',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado',
  'banco', 'tipo_conta', 'agencia', 'conta', 'titular_conta', 'cpf_cnpj_titular', 'pix',
  'condicoes_pagamento', 'nome_solicitante', 'email_solicitante', 'inscricao_estadual_isento', 'apenas_boleto',
];

function limitarEnvios(chave, max) {
  const c = CacheService.getScriptCache();
  const k = chave + '_' + Math.floor(Date.now() / 600000);
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 700);
  if (n > max) throw new Error('Muitos envios no momento. Tente novamente em alguns minutos.');
}

function tipoReal(b) {
  const u = (i) => b[i] & 0xff;
  if (u(0) === 0x25 && u(1) === 0x50 && u(2) === 0x44 && u(3) === 0x46) return ['application/pdf', 'pdf'];
  if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return ['image/jpeg', 'jpg'];
  if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47) return ['image/png', 'png'];
  return null;
}

function limpar(entrada) {
  const d = {};
  for (const c of CAMPOS) {
    let v = entrada[c];
    if (v === undefined || v === null || v === '') continue;
    if (c === 'inscricao_estadual_isento' || c === 'apenas_boleto') { d[c] = v === true || v === 'true'; continue; }
    v = String(v).trim().slice(0, 2000);
    if (v) d[c] = v;
  }
  if (!TIPOS.includes(d.tipo_cadastro)) throw new Error('Tipo de cadastro inválido.');
  if (d.tipo_cadastro === 'motorista' || d.tipo_cadastro === 'atualizacao_bancaria') d.apenas_boleto = false;
  if (d.apenas_boleto) for (const c of ['banco', 'agencia', 'conta', 'titular_conta', 'cpf_cnpj_titular', 'pix', 'tipo_conta']) delete d[c];
  if (!d.razao_social) d.razao_social = d.nome_completo || d.responsavel_nome || 'Sem nome';
  return d;
}

function obrigatorios(d, arquivos) {
  const t = d.tipo_cadastro;
  let req = ['responsavel_nome', 'celular', 'email', 'cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado', 'nome_solicitante', 'email_solicitante'];
  if (t === 'pj') req = req.concat(['razao_social', 'cnpj', 'inscricao_estadual']);
  if (t === 'pf') req = req.concat(['nome_completo', 'cpf', 'rg', 'data_nascimento']);
  if (t === 'motorista') req = req.concat(['nome_completo', 'cpf', 'rg', 'data_nascimento', 'cnh_categoria', 'antt']);
  if (t !== 'motorista' && !d.apenas_boleto) req = req.concat(['banco', 'agencia', 'conta', 'titular_conta', 'cpf_cnpj_titular']);
  const falta = req.filter((c) => !d[c]);
  if (t === 'atualizacao_bancaria' && !d.cnpj && !d.cpf) falta.push('cnpj/cpf');
  if (falta.length) throw new Error('Campos obrigatórios não preenchidos: ' + falta.join(', '));
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.test(d.email) || !email.test(d.email_solicitante)) throw new Error('E-mail inválido.');
  if (d.cnpj && d.cnpj.replace(/\D/g, '').length !== 14) throw new Error('CNPJ inválido.');
  if (d.cpf && d.cpf.replace(/\D/g, '').length !== 11) throw new Error('CPF inválido.');
  let docs = [];
  if (t === 'pj') { docs = ['comprovante_cnpj', 'contrato_social']; if (!d.apenas_boleto) docs.push('comprovante_bancario'); }
  if (t === 'pf') { docs = ['documento_identidade']; if (!d.apenas_boleto) docs.push('comprovante_bancario_pf'); }
  if (t === 'motorista') docs = ['documento_identidade_mot'];
  if (t === 'atualizacao_bancaria') docs = ['comprovante_bancario_atu'];
  const sem = docs.filter((c) => !arquivos.some((a) => a.campo === c));
  if (sem.length) throw new Error('Anexe: ' + sem.map((c) => ARQUIVOS[c].rotulo).join(', '));
}

function decodificar(lista, tipo) {
  if (!Array.isArray(lista) || lista.length > 6) throw new Error('Anexos inválidos.');
  const vistos = {};
  return lista.map((a) => {
    const def = ARQUIVOS[a && a.campo];
    if (!def || !def.tipos.includes(tipo) || vistos[a.campo]) throw new Error('Anexo inválido.');
    vistos[a.campo] = true;
    const bytes = Utilities.base64Decode(String(a.base64 || ''));
    if (!bytes.length) throw new Error('Arquivo vazio: ' + def.rotulo);
    if (bytes.length > MAX_ARQUIVO) throw new Error('Arquivo maior que 5MB: ' + def.rotulo);
    const real = tipoReal(bytes);
    if (!real) throw new Error('Formato não aceito em "' + def.rotulo + '". Envie PDF, JPG ou PNG.');
    return { campo: a.campo, def, bytes, mime: real[0], ext: real[1] };
  });
}

function nomePasta(r) {
  const nome = r.razao_social || r.nome_completo || 'Sem nome';
  const doc = (r.cnpj || r.cpf || '').replace(/\D/g, '');
  return ((r.tipo_cadastro === 'atualizacao_bancaria' ? '[Atualização] ' : '') + nome + (doc ? ' - ' + doc : '') + ' - ' + String(r.id).slice(0, 8))
    .replace(/[\\/:*?"<>|]/g, '-').slice(0, 150);
}

export function salvarFornecedor(payload) {
  try {
    if (!payload || typeof payload !== 'object') throw new Error('Envio inválido.');
    if (payload.hp) return { ok: true };
    limitarEnvios('forn', 40);
    const dados = limpar(payload.dados || {});
    const arquivos = decodificar(payload.arquivos || [], dados.tipo_cadastro);
    obrigatorios(dados, arquivos);

    const db = createClient();
    const { data: criado, error } = sync(db.from('fornecedores').insert({ ...dados, status: 'pendente' }).select('id').single());
    if (error) throw new Error('Não foi possível gravar o cadastro. Tente novamente.');

    if (arquivos.length) {
      const raiz = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PASTA_FORNECEDORES'));
      const pasta = raiz.createFolder(nomePasta({ ...dados, id: criado.id }));
      const atualizar = { arquivos_drive: [], pasta_drive_url: pasta.getUrl() };
      for (const a of arquivos) {
        const f = pasta.createFile(Utilities.newBlob(a.bytes, a.mime, a.def.rotulo + '.' + a.ext));
        atualizar[a.def.coluna] = f.getUrl();
        atualizar.arquivos_drive.push({ campo: a.campo, id: f.getId(), nome: f.getName(), url: f.getUrl() });
      }
      const r = sync(db.from('fornecedores').update(atualizar).eq('id', criado.id));
      if (r.error) throw new Error('Não foi possível vincular os documentos. Tente novamente.');
    }
    return { ok: true, id: criado.id };
  } catch (e) {
    console.error(e);
    return { ok: false, erro: e.message || String(e) };
  }
}

/* Produtos e desbloqueios: vários itens na mesma solicitação. */
export function salvarProduto(payload) {
  try {
    limitarEnvios('prod', 60);
    const tabela = payload && payload.tabela;
    if (!['produtos', 'desbloqueios'].includes(tabela)) throw new Error('Tipo de solicitação inválido.');
    const lista = Array.isArray(payload.records) ? payload.records.slice(0, 100) : [];
    if (!lista.length) throw new Error('Adicione pelo menos um item.');
    const permitidos = tabela === 'produtos'
      ? ['nome_solicitante', 'email_solicitante', 'solicitacao_id', 'descricao', 'finalidade', 'ncm', 'unidade_medida', 'principais_marcas', 'imagem_url']
      : ['nome_solicitante', 'email_solicitante', 'solicitacao_id', 'codigo_produto', 'nome_produto', 'motivo'];
    const obrig = tabela === 'produtos'
      ? ['nome_solicitante', 'email_solicitante', 'solicitacao_id', 'descricao', 'finalidade', 'unidade_medida']
      : ['nome_solicitante', 'email_solicitante', 'solicitacao_id', 'codigo_produto', 'motivo'];
    const registros = lista.map((r) => {
      const o = {};
      for (const c of permitidos) if (r[c] !== undefined && r[c] !== null && r[c] !== '') o[c] = String(r[c]).slice(0, 2000);
      if (obrig.some((c) => !o[c])) throw new Error('Campos obrigatórios não preenchidos.');
      if (!/^[A-Za-z0-9._%+\-]+@premix\.com\.br$/i.test(o.email_solicitante)) throw new Error('E-mail inválido. Use seu e-mail @premix.com.br.');
      o.email_solicitante = o.email_solicitante.toLowerCase();
      o.status = 'pendente';
      return o;
    });
    const { error } = sync(createClient().from(tabela).insert(registros));
    if (error) throw new Error(error.message && error.message.indexOf('Limite') === 0 ? error.message : 'Falha ao enviar. Revise os dados ou tente em instantes.');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, erro: e.message || String(e) };
  }
}
