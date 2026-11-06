/* Executa gas/Servidor.js (o arquivo que vai para o Apps Script) no Google simulado. */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import assertBase from 'node:assert/strict';
import { criarGasFalso } from './gas-falso.mjs';

const j = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const assert = Object.assign((...a) => assertBase(...a), assertBase, { deepEqual: (a, b, m) => assertBase.deepEqual(j(a), j(b), m) });
const require = createRequire('/home/user/painel-fornecedores/package.json');
const bcrypt = require('bcryptjs');

export function montar() {
  const gas = criarGasFalso({ props: { SESSION_SECRET: 'segredo-de-teste-com-32-bytes-ou-mais!!' } });
  for (const q of ['cadastros', 'operacao', 'historico']) gas.propriedades['PLANILHA_' + q.toUpperCase()] = gas.globais.SpreadsheetApp.create(q).getId();
  const ctx = vm.createContext({ ...gas.globais, console });
  const dir = new URL('../../' + (process.env.GAS_DIR || 'gas') + '/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) vm.runInContext(fs.readFileSync(new URL(f, dir), 'utf8'), ctx, { filename: f });
  ctx.PMX = vm.runInContext('__pmx()', ctx);
  const jar = {};
  const chamar = (metodo, caminho, corpo, extra = {}) => {
    const [c, q] = caminho.split('?');
    const r = ctx.api({ metodo, caminho: c, consulta: q || '', cabecalhos: { 'user-agent': 'teste', 'x-forwarded-for': 'disp-1', 'content-type': 'application/json', ...(extra.cabecalhos || {}) }, corpo: corpo === undefined ? null : JSON.stringify(corpo), cookies: { ...jar } });
    for (const ck of r.cookies || []) { if (ck.value) jar[ck.name] = ck.value; else delete jar[ck.name]; }
    return { ...r, json: r.corpo && !r.base64 ? JSON.parse(r.corpo) : null };
  };
  return { gas, ctx, chamar, jar };
}

if (process.argv[1] && process.argv[1].endsWith('servidor.test.mjs')) {
  const { ctx, chamar, jar } = montar();
  const db = ctx.PMX.createClient();
  let ok = 0;
  const t = (nome, fn) => { try { fn(); ok++; } catch (e) { console.error('FALHOU:', nome, '\n ', e.stack); process.exitCode = 1; } };
  const sinc = (p) => ({ v: ctx.PMX.agora(p) });

  t('semear usuário', () => {
    const r = sinc(db.from('usuarios_painel').insert({ nome: 'Ana Admin', email: 'ana@premix.com.br', senha_hash: bcrypt.hashSync('Senha#123', 4), role: 'admin', primeiro_login: false }));
    assert.equal(r.v.error, null);
  });
  t('login errado', () => { const r = chamar('POST', '/api/auth/login', { email: 'ana@premix.com.br', senha: 'x' }); assert.equal(r.status, 401); });
  t('login certo + cookie', () => {
    const r = chamar('POST', '/api/auth/login', { email: 'ana@premix.com.br', senha: 'Senha#123' });
    assert.equal(r.status, 200, r.corpo); assert.equal(r.json.user.nome, 'Ana Admin'); assert.ok(jar.premix_session);
  });
  t('sessão', () => { const r = chamar('GET', '/api/auth/session'); assert.equal(r.status, 200, r.corpo); assert.equal(r.json.user.email, 'ana@premix.com.br'); });
  t('auditoria gravou tentativas', () => { const r = sinc(db.from('auditoria').select('acao').order('id')); assert.deepEqual(r.v.data.map((x) => x.acao), ['login_falhou', 'login_sucesso']); });
  t('listar fornecedores', () => {
    sinc(db.from('fornecedores').insert([{ razao_social: 'Alfa', email: 'a@a.com', cnpj: '11.111.111/0001-11' }, { razao_social: 'Beta', email: 'b@b.com', status: 'aprovado' }]));
    const r = chamar('GET', '/api/data/list?table=fornecedores&page=1&pageSize=50');
    assert.equal(r.status, 200, r.corpo);
    const rows = r.json.rows || r.json.data || r.json;
    assert.ok(JSON.stringify(rows).includes('Alfa'), r.corpo.slice(0, 300));
  });
  t('busca com or/ilike', () => {
    const r = chamar('GET', '/api/data/list?table=fornecedores&q=alf');
    assert.equal(r.status, 200, r.corpo); assert.ok(r.corpo.includes('Alfa') && !r.corpo.includes('Beta'), r.corpo.slice(0, 300));
  });
  t('atualizar via /api/data', () => {
    const id = sinc(db.from('fornecedores').select('id').eq('razao_social', 'Alfa').single()).v.data.id;
    const r = chamar('POST', '/api/data', { table: 'fornecedores', action: 'update', id, data: { status: 'aprovado', codigo_fornecedor: '000777' }, returning: true });
    assert.equal(r.status, 200, r.corpo); assert.equal(r.json.row.codigo_fornecedor, '000777');
  });
  t('sem sessão = 401', () => { const s = jar.premix_session; delete jar.premix_session; const r = chamar('GET', '/api/data/list?table=fornecedores'); assert.equal(r.status, 401); jar.premix_session = s; });
  t('rota inexistente = 404', () => assert.equal(chamar('GET', '/api/nada').status, 404));
  t('logout', () => { const r = chamar('POST', '/api/auth/logout'); assert.ok(r.status < 300, r.corpo); assert.ok(!jar.premix_session); });
  console.log(`servidor: ${ok} testes ok`);
}
