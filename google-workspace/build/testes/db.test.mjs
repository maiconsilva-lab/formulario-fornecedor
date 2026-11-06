import * as esbuild from 'esbuild';
import vm from 'node:vm';
import assertBase from 'node:assert/strict';
const j = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const assert = Object.assign((...a) => assertBase(...a), assertBase, { deepEqual: (a, b, m) => assertBase.deepEqual(j(a), j(b), m) });
import { criarGasFalso } from './gas-falso.mjs';

const r = await esbuild.build({
  stdin: { contents: "export { createClient } from './db/consulta.js'; export { limparCache } from './db/armazem.js';", resolveDir: new URL('../../servidor', import.meta.url).pathname },
  bundle: true, format: 'iife', globalName: 'DB', write: false, loader: { '.txt': 'text' }, target: 'es2019',
});
const gas = criarGasFalso();
const ctx = vm.createContext({ ...gas.globais, console });
for (const q of ['cadastros', 'operacao', 'historico']) gas.globais.PropertiesService.getScriptProperties().setProperty('PLANILHA_' + q.toUpperCase(), gas.globais.SpreadsheetApp.create(q).getId());
vm.runInContext(r.outputFiles[0].text, ctx);
const { createClient, limparCache } = ctx.DB;
const s = createClient();
let ok = 0; const t = async (nome, fn) => { try { await fn(); ok++; } catch (e) { console.error('FALHOU:', nome, '\n ', e.message); process.exitCode = 1; } };

await t('insert com padrões e retorno', async () => {
  const { data, error } = await s.from('kanban_tarefas').insert({ titulo: 'A', criado_por: 'Ana', atribuido_para: 'Bia', prazo: '2026-11-10' }).select().single();
  assert.equal(error, null); assert.match(data.id, /^[0-9a-f-]{36}$/); assert.equal(data.status, 'backlog'); assert.deepEqual(data.checklist, []); assert.equal(data.prazo, '2026-11-10');
});
await t('insert vários + seq', async () => {
  const { data } = await s.from('lanc_documentos').insert([
    { filial: 'SP', tipo: 'NF', num_doc: '001', vencimento: '2026-11-08', valor_bruto: 100, valor_liquido: 90 },
    { filial: 'Paraguay', tipo: 'NF', num_doc: '002', status: 'Pendente', registros: 'aguardando pedido de compra' },
    { filial: 'MG', tipo: 'Nota Fiscal - Matéria prima', num_doc: '0003', status: 'Lançado', lancado_em: new Date().toISOString(), lancado_por: 'ana' },
  ]).select('id, num_doc, status');
  assert.deepEqual(data.map((d) => d.id), [1, 2, 3]); assert.equal(data[2].num_doc, '0003');
});
await t('releitura do disco preserva tipos', async () => {
  limparCache();
  const { data } = await s.from('lanc_documentos').select('*').eq('id', 3).single();
  assert.equal(data.num_doc, '0003'); assert.equal(typeof data.id, 'number'); assert.equal(data.vencimento, null);
  const { data: k } = await s.from('kanban_tarefas').select('prazo, checklist').maybeSingle();
  assert.equal(k.prazo, '2026-11-10'); assert.deepEqual(k.checklist, []);
});
await t('filtros: in, or, not, ilike, is, gte, order, range, count', async () => {
  const { data, count } = await s.from('lanc_documentos').select('id', { count: 'exact' }).in('status', ['Lançar', 'Pendente']).order('id', { ascending: false }).range(0, 0);
  assert.equal(count, 2); assert.deepEqual(data, [{ id: 2 }]);
  const o = await s.from('lanc_documentos').select('id').or('num_doc.eq.001,and(filial.ilike.*para*,status.eq.Pendente)').order('id');
  assert.deepEqual(o.data.map((x) => x.id), [1, 2]);
  const n = await s.from('lanc_documentos').select('id').not('status', 'in', '("Lançar","Pendente")');
  assert.deepEqual(n.data.map((x) => x.id), [3]);
  const i = await s.from('lanc_documentos').select('id').is('vencimento', null).gte('id', 2);
  assert.deepEqual(i.data.map((x) => x.id), [2, 3]);
  const h = await s.from('lanc_documentos').select('*', { count: 'exact', head: true }).not('lancado_em', 'is', null);
  assert.equal(h.count, 1); assert.equal(h.data, null);
});
await t('update + trigger updated_at + select', async () => {
  const { data: f } = await s.from('fornecedores').insert({ razao_social: 'X', email: 'x@y.com' }).select().single();
  await new Promise((r) => setTimeout(r, 5));
  const { data } = await s.from('fornecedores').update({ status: 'aprovado', codigo_fornecedor: '000123' }).eq('id', f.id).select().single();
  assert.equal(data.status, 'aprovado'); assert.equal(data.codigo_fornecedor, '000123'); assert.notEqual(data.updated_at, f.updated_at);
});
await t('unique e upsert onConflict', async () => {
  await s.from('ctr_config').insert({ chave: 'a', valor: '1' });
  const e = await s.from('ctr_config').insert({ chave: 'a', valor: '2' });
  assert.equal(e.error.code, '23505');
  await s.from('ctr_config').upsert([{ chave: 'a', valor: '3' }, { chave: 'b', valor: '4' }], { onConflict: 'chave' });
  const { data } = await s.from('ctr_config').select('*').order('chave');
  assert.deepEqual(data, [{ chave: 'a', valor: '3' }, { chave: 'b', valor: '4' }]);
  await s.from('ctr_config').upsert({ chave: 'a', valor: '9' }, { onConflict: 'chave', ignoreDuplicates: true });
  assert.equal((await s.from('ctr_config').select('valor').eq('chave', 'a').single()).data.valor, '3');
});
await t('single sem linha dá PGRST116, maybeSingle dá null', async () => {
  const a = await s.from('filiais').select('*').eq('codigo', 'zz').single();
  assert.equal(a.error.code, 'PGRST116');
  const b = await s.from('filiais').select('*').eq('codigo', 'zz').maybeSingle();
  assert.equal(b.data, null); assert.equal(b.error, null);
});
await t('coluna inexistente dá erro', async () => {
  const a = await s.from('filiais').insert({ codigo: 'x', descricao: 'y', nada: 1 });
  assert.equal(a.error.code, 'PGRST204');
});
await t('delete muitos (regrava aba) e poucos', async () => {
  await s.from('trilha_conferencia_revisados').insert(Array.from({ length: 30 }, (_, i) => ({ dia: '2026-11-0' + (i % 3), doc_k: 'k' + i })));
  await s.from('trilha_conferencia_revisados').delete().eq('dia', '2026-11-00');
  limparCache();
  const { count } = await s.from('trilha_conferencia_revisados').select('*', { count: 'exact', head: true });
  assert.equal(count, 20);
  await s.from('trilha_conferencia_revisados').delete().in('doc_k', ['k1', 'k2']);
  limparCache();
  const r2 = await s.from('trilha_conferencia_revisados').select('doc_k').order('doc_k');
  assert.equal(r2.data.length, 18); assert.ok(!r2.data.some((x) => ['k1', 'k2', 'k0', 'k3'].includes(x.doc_k)));
});
await t('texto gigante vai para _grandes e volta', async () => {
  const dados = { itens: Array.from({ length: 4000 }, (_, i) => ({ i, txt: 'abcdefghij'.repeat(3) })) };
  await s.from('trilha_conferencia_ultima').upsert({ id: 1, dados });
  limparCache();
  const { data } = await s.from('trilha_conferencia_ultima').select('dados').eq('id', 1).single();
  assert.equal(data.dados.itens.length, 4000);
  await s.from('trilha_conferencia_ultima').upsert({ id: 1, dados: { pequeno: true } });
  limparCache();
  assert.deepEqual((await s.from('trilha_conferencia_ultima').select('dados').single()).data.dados, { pequeno: true });
  const g = gas.planilhas[gas.propriedades.PLANILHA_OPERACAO].getSheetByName('_grandes');
  assert.equal(g.getLastRow(), 1, 'partes antigas foram apagadas');
});
await t('views lanc_fila / fretes / ajustes', async () => {
  const { data } = await s.from('lanc_fila').select('id, nivel, nivel_ordem, alerta_valor, dias_na_fila').order('nivel_ordem');
  assert.deepEqual(data.map((d) => d.nivel), ['MP', 'Urgente', 'Paraguai']);
  assert.equal(data.find((d) => d.id === 1).alerta_valor, true); assert.equal(data[0].dias_na_fila, 0);
  await s.from('lanc_fretes').insert({ num_cte: '1', vlr_tabela: 100, vlr_cte: 110 });
  const fv = (await s.from('lanc_fretes_v').select('*').single()).data;
  assert.equal(fv.diferenca, 10); assert.equal(fv.diferenca_pct, 10); assert.equal(fv.sla_nivel, 'Dentro do SLA');
  assert.equal((await s.from('lanc_fila').update({ status: 'x' }).eq('id', 1)).error.code, '55000');
});
await t('rpcs', async () => {
  assert.equal((await s.rpc('rate_limit_check', { p_chave: 'k', p_max: 2, p_janela_segundos: 60 })).data, true);
  await s.rpc('rate_limit_check', { p_chave: 'k', p_max: 2, p_janela_segundos: 60 });
  assert.equal((await s.rpc('rate_limit_check', { p_chave: 'k', p_max: 2, p_janela_segundos: 60 })).data, false);
  assert.equal((await s.rpc('sync_lock_claim', { p_job: 'j', p_ttl_seconds: 60 })).data, true);
  assert.equal((await s.rpc('sync_lock_claim', { p_job: 'j', p_ttl_seconds: 60 })).data, false);
  await s.rpc('sync_lock_release', { p_job: 'j' });
  assert.equal((await s.rpc('sync_lock_claim', { p_job: 'j', p_ttl_seconds: 60 })).data, true);
  assert.equal((await s.rpc('lanc_sync_travar', { p_dono: 'a' })).data, true);
  assert.equal((await s.rpc('lanc_sync_travar', { p_dono: 'b' })).data, false);
  await s.rpc('lanc_sync_liberar');
  assert.equal((await s.rpc('lanc_sync_travar', { p_dono: 'b' })).data, true);
  assert.equal((await s.rpc('lanc_classificar_pendencias')).data, 1);
  assert.equal((await s.from('lanc_documentos').select('motivo_pendencia').eq('id', 2).single()).data.motivo_pendencia, 'PO em Aprovação');
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const rel = (await s.rpc('lanc_relatorio_periodo', { p_ini: hoje, p_fim: hoje })).data;
  assert.equal(rel.periodo.recebidos, 3); assert.equal(rel.periodo.lancados, 1); assert.equal(rel.agora.pendentes, 1); assert.equal(rel.por_dia.length, 1);
  const ex = (await s.rpc('lanc_relatorio_extra', { p_ini: hoje, p_fim: hoje })).data;
  assert.equal(ex.excecao.recebidos, 3); assert.equal(ex.vencimento_fila.length, 5);
  await s.rpc('registrar_acesso_filial', { p_filial: 'SP' }); await s.rpc('registrar_acesso_filial', { p_filial: 'SP' });
  assert.equal((await s.from('filial_atividade').select('*').single()).data.total_acessos, 2);
  assert.equal((await s.rpc('nao_existe')).error.code, 'PGRST202');
});
await t('fórmula não é executada', async () => {
  await s.from('filiais').insert({ codigo: '=1+1', descricao: '+55 11' });
  limparCache();
  const { data } = await s.from('filiais').select('*').eq('codigo', '=1+1').single();
  assert.equal(data.descricao, '+55 11');
});
await t('ida e volta com formas reais de dados (textos que parecem número, IP, JSON, decimais)', async () => {
  const doc = { origem: 'portal', filial: 'Ribeirão Preto', tipo: 'Serviços (Compras Indiretos)', num_doc: '000022031', observacoes: 'Criar medição',
    registros: '[27/10, 08:54 Maicon Silva] Outro — Criar medição\n[30/10, 10:07 Victoria Costa] Pendência resolvida: 045969',
    valor_bruto: 106.20, valor_liquido: 1620.65, linha_digitavel: '00190000090375342500200101448173316270000162065', cnpj_emitente: '04765927000173',
    inconsistencias: ['valor diferente', 'sem vencimento'], vencimento: '2026-11-11', lancado_em: '2026-10-30T14:45:27.501+00:00' };
  await s.from('lanc_documentos').insert(doc);
  const ct = { chave: '000000000000383 1 companhia', numero: '000000000000383', cod_fornecedor: '000030', loja: '1', filial: '1', data_inicio: '2024-10-15', valor_contrato: 360000.00, saldo_pct: 38.56,
    meses: { '1': 5264.54, '10': 8816.84 }, extra: { 'C. DE CUSTO': '7.01.2001', 'DESCRIÇÃO': 'ADMINISTRATIVO' }, na_planilha: true, segue_protheus: false, objeto: 'x'.repeat(900) };
  await s.from('ctr_contratos').insert(ct);
  await s.from('auditoria').insert({ ator_nome: 'Ana', acao: 'login_sucesso', tipo_cadastro: 'auth', detalhes: {}, ip: '177.103.138.22', user_agent: 'Mozilla/5.0 (X11)' });
  await s.from('monitor_xml').insert({ chave: '35261025062769000165550020070283831462527210', documento: '007028383', serie: '2', filial: '11', produto_protheus: '', quantidade: 1, valor_unitario: 65.9 });
  limparCache();
  const d = (await s.from('lanc_documentos').select('*').eq('num_doc', '000022031').single()).data;
  assert.equal(d.num_doc, '000022031'); assert.equal(d.registros, doc.registros); assert.equal(d.valor_bruto, 106.2);
  assert.equal(d.linha_digitavel, doc.linha_digitavel); assert.equal(d.cnpj_emitente, '04765927000173'); assert.deepEqual(d.inconsistencias, doc.inconsistencias);
  assert.equal(d.vencimento, '2026-11-11'); assert.equal(d.lancado_em, '2026-10-30T14:45:27.501+00:00');
  const c = (await s.from('ctr_contratos').select('*').single()).data;
  assert.equal(c.cod_fornecedor, '000030'); assert.equal(c.numero, '000000000000383'); assert.deepEqual(c.meses, ct.meses); assert.deepEqual(c.extra, ct.extra);
  assert.equal(c.valor_contrato, 360000); assert.equal(c.objeto.length, 900); assert.equal(c.na_planilha, true); assert.equal(c.segue_protheus, false);
  const a = (await s.from('auditoria').select('*').single()).data;
  assert.equal(a.ip, '177.103.138.22'); assert.deepEqual(a.detalhes, {});
  const m = (await s.from('monitor_xml').select('*').single()).data;
  assert.equal(m.chave, '35261025062769000165550020070283831462527210'); assert.equal(m.serie, '2'); assert.equal(m.quantidade, 1);
  const eq = await s.from('monitor_xml').select('id').eq('chave', '35261025062769000165550020070283831462527210');
  assert.equal(eq.data.length, 1);
});
console.log(`db: ${ok} testes ok`);
