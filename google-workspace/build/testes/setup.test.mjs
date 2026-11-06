/* Roda gas/Setup.js (instalação + migração) contra um Supabase simulado. */
import fs from 'node:fs';
import vm from 'node:vm';
import assertBase from 'node:assert/strict';
import { criarGasFalso } from './gas-falso.mjs';
const j = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const assert = Object.assign((...a) => assertBase(...a), assertBase, { deepEqual: (a, b, m) => assertBase.deepEqual(j(a), j(b), m) });

const gas = criarGasFalso({ props: { PASTA_RAIZ: 'raiz', DOMINIO_PERMITIDO: 'premix.com.br', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' } });
const S = gas.globais.Session; S.getEffectiveUser = () => ({ getEmail: () => 'dono@premix.com.br' });
const orig = gas.globais.SpreadsheetApp.create;
gas.globais.SpreadsheetApp.create = (n) => { const ss = orig(n); ss.getSheets().forEach((sh) => { sh.protect = () => ({ setDescription() { return this; }, removeEditors() { return this; }, getEditors: () => [], canDomainEdit: () => true, setDomainEdit() {} }); }); const ins = ss.insertSheet.bind(ss); ss.insertSheet = (x) => { const sh = ins(x); sh.protect = () => ({ setDescription() { return this; }, removeEditors() { return this; }, getEditors: () => [], canDomainEdit: () => true, setDomainEdit() {} }); return sh; }; return ss; };
const ctx = vm.createContext({ ...gas.globais, console });
const dir = new URL('../../' + (process.env.GAS_DIR || 'gas') + '/', import.meta.url);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) vm.runInContext(fs.readFileSync(new URL(f, dir), 'utf8'), ctx, { filename: f });

const F = gas.globais.UrlFetchApp;
const fornecedores = [{ id: 'f1', created_at: '2026-05-01T10:00:00+00:00', razao_social: 'Alfa', email: 'a@a.com', cnpj: '11.111.111/0001-11', comprovante_cnpj_url: 'https://x.supabase.co/storage/v1/object/public/comprovantes/cnpj/1.pdf', status: 'pendente', campos_nao_existentes: 1 }];
F.respostas = [
  { url: 'https://x.supabase.co/rest/v1/fornecedores', corpo: (u) => (u.includes('offset=0') ? fornecedores : []) },
  { url: 'https://x.supabase.co/rest/v1/auditoria', corpo: (u) => (u.includes('offset=0') ? Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, acao: 'x', ator_nome: 'a', tipo_cadastro: 't', detalhes: { n: i } })) : u.includes('offset=1000') ? [{ id: 1001, acao: 'y', ator_nome: 'a', tipo_cadastro: 't' }] : []) },
  { url: 'https://x.supabase.co/rest/v1/usuarios_painel', corpo: (u) => (u.includes('offset=0') ? [{ id: 'u1', nome: 'Ana', email: 'ana@premix.com.br', senha_hash: '$2a$04$x', role: 'admin' }] : []) },
  { url: 'https://x.supabase.co/rest/v1/', corpo: [] },
  { url: 'https://x.supabase.co/storage/v1/object/authenticated/comprovantes/cnpj/1.pdf', tipo: 'application/pdf', corpo: '%PDF-1.4 conteudo' },
];
ctx.PMX = vm.runInContext('__pmx()', ctx);
const T = ctx.PMX.__tabelas;
const comForn = T.includes('fornecedores'), comCtr = T.includes('ctr_contratos');
let ok = 0; const t = (n, fn) => { try { fn(); ok++; } catch (e) { console.error('FALHOU:', n, '\n ', e.stack); process.exitCode = 1; } };

t('configurar cria planilhas, pastas e segredos', () => {
  ctx.configurar();
  const p = gas.propriedades;
  for (const k of ['PLANILHA_CADASTROS', 'PLANILHA_OPERACAO', 'PLANILHA_HISTORICO', ...(comForn ? ['PASTA_FORNECEDORES'] : []), 'PASTA_IMAGENS', 'SESSION_SECRET', 'CRON_SECRET', 'LANC_INGEST_SECRET']) assert.ok(p[k], k);
  const ab = (q) => gas.planilhas[p['PLANILHA_' + q]].getSheets().map((s) => s.getName());
  assert.ok((!comForn || ab('CADASTROS').includes('fornecedores')) && ab('CADASTROS').includes('usuarios_painel'));
  assert.ok((!comCtr || ab('OPERACAO').includes('ctr_contratos')) && ab('OPERACAO').includes('lanc_documentos'));
  assert.equal(ab('OPERACAO').includes('ctr_contratos'), comCtr, 'só as tabelas do perfil viram abas');
  assert.ok(ab('HISTORICO').includes('auditoria') && !ab('HISTORICO').includes('Página1'));
  assert.ok(!ab('OPERACAO').includes('lanc_fila'), 'visões não viram abas');
});
t('configurar é repetível', () => { const antes = gas.propriedades.PLANILHA_CADASTROS; ctx.configurar(); assert.equal(gas.propriedades.PLANILHA_CADASTROS, antes); });
t('migrarTudo copia tabelas (com paginação) e ignora colunas desconhecidas', () => {
  ctx.migrarTudo();
  const db = ctx.PMX.createClient();
  const q = (p) => ctx.PMX.agora(p);
  assert.equal(q(db.from('auditoria').select('id', { count: 'exact', head: true })).count, 1001);
  if (comForn) assert.equal(q(db.from('fornecedores').select('razao_social').single()).data.razao_social, 'Alfa');
  assert.equal(q(db.from('usuarios_painel').select('role').single()).data.role, 'admin');
});
t('migrarTudo não duplica', () => { ctx.migrarTudo(); const db = ctx.PMX.createClient(); assert.equal(ctx.PMX.agora(db.from('auditoria').select('id', { count: 'exact', head: true })).count, 1001); });
if (comForn) t('migrarArquivos leva o PDF para o Drive e troca o link', () => {
  ctx.migrarArquivos();
  const db = ctx.PMX.createClient();
  const f = ctx.PMX.agora(db.from('fornecedores').select('*').single()).data;
  assert.match(f.comprovante_cnpj_url, /drive\.google\.com\/file/);
  assert.match(f.pasta_drive_url, /drive\.google\.com\/drive\/folders/);
  assert.equal(f.arquivos_drive.length, 1);
  assert.equal(Object.keys(gas.arquivos).length, 1);
});
if (comForn) t('migrarArquivos é repetível (não refaz)', () => { ctx.migrarArquivos(); assert.equal(Object.keys(gas.arquivos).length, 1); });
t('reimportarTudo exige confirmação e refaz a cópia', () => {
  assert.throws(() => ctx.reimportarTudo(), /CONFIRMA_REIMPORTAR/);
  const db = ctx.PMX.createClient(); const q = (p) => ctx.PMX.agora(p);
  q(db.from('usuarios_painel').insert({ nome: 'Lixo', email: 'lixo@premix.com.br', senha_hash: 'x' }));
  gas.propriedades.CONFIRMA_REIMPORTAR = 'SIM';
  ctx.reimportarTudo();
  assert.ok(!gas.propriedades.CONFIRMA_REIMPORTAR, 'a confirmação é consumida');
  assert.equal(q(db.from('usuarios_painel').select('id', { count: 'exact', head: true })).count, 0);
  ctx.migrarTudo();
  const u = q(db.from('usuarios_painel').select('email')).data;
  assert.deepEqual(u.map((x) => x.email), ['ana@premix.com.br']);
  assert.equal(q(db.from('auditoria').select('id', { count: 'exact', head: true })).count, 1001);
});
t('instalarGatilhos', () => ctx.instalarGatilhos());
t('diagnostico', () => ctx.diagnostico());
console.log(`setup: ${ok} testes ok`);
