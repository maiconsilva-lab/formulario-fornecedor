/* Sincronização com a planilha de recepção do Portal (Demandas_Sync) e espelhamento de volta (Lancamentos!R). */
import { createRequire } from 'node:module';
import { montar } from './servidor.test.mjs';
const bcrypt = createRequire('/home/user/painel-fornecedores/package.json')('bcryptjs');
process.env.GAS_DIR = process.env.GAS_DIR || 'gas';
const { ctx, gas, chamar } = montar();
gas.propriedades.DOMINIO_PERMITIDO = '';
const db = ctx.PMX.createClient(); const q = (p) => ctx.PMX.agora(p);
let falhou = false; const ok = (c, m) => { if (!c) { falhou = true; console.error('FALHOU:', m); } else console.log('ok -', m); };

q(db.from('usuarios_painel').insert({ nome: 'Ana Fiscal', email: 'ana@premix.com.br', senha_hash: bcrypt.hashSync('Senha#123', 4), role: 'admin', primeiro_login: false }));
q(db.from('lanc_config').insert([{ chave: 'fonte_planilha', valor: 'sync' }, { chave: 'sync_planilha', valor: '1' }]));
chamar('POST', '/api/auth/login', { email: 'ana@premix.com.br', senha: 'Senha#123' });

const SYNC = 'PLANILHA_SYNC_ID', BASE = 'PLANILHA_BASE_ID';
gas.propriedades.LANC_SYNC_SHEET_ID = SYNC;
gas.propriedades.LANC_BASE_SHEET_ID = BASE;
const F = gas.globais.UrlFetchApp;
let linhas = [
  ['17/10/2026 13:42:44', 'maria@premix.com.br', 'Ribeirão Preto', 'Nota Fiscal - Produto Acabado', "'000012345", '2026-11-20', 'urgente', 'Lançar', 'https://drive.google.com/file/d/NF11111111111/view', '', ''],
  ['17/10/2026 14:05:10', 'joao@premix.com.br', 'Matão', 'Frete (CT-e)', '9876', '20/11/2026', '', 'Lançar', 'https://drive.google.com/file/d/CT22222222222/view', '', ''],
];
const chamadasSheets = [];
F.respostas = [
  { url: /sheets\.googleapis\.com\/v4\/spreadsheets\/PLANILHA_SYNC_ID\/values\//, corpo: () => ({ values: linhas }) },
  { url: /sheets\.googleapis\.com\/v4\/spreadsheets\/PLANILHA_BASE_ID\/values\/.*R2/, corpo: () => ({ values: [[ `${Math.floor(Date.parse('2026-10-17T13:42:44-03:00') / 1000)}|Ribeirão Preto` ]] }) },
  { url: /sheets\.googleapis\.com\/v4\/spreadsheets\/PLANILHA_BASE_ID\/values:batchUpdate/, corpo: (u, o) => { chamadasSheets.push(JSON.parse(o.payload)); return { totalUpdatedCells: 1 }; } },
];

const s1 = chamar('POST', '/api/lancamentos/sincronizar');
ok(s1.status === 200, 'sincronizar responde 200: ' + (s1.corpo || '').slice(0, 160));
const docs = q(db.from('lanc_documentos').select('*').order('id')).data;
ok(docs.length === 2, 'os 2 documentos da planilha entraram no painel');
const d1 = docs.find((d) => d.num_doc === '000012345'), d2 = docs.find((d) => d.num_doc === '000009876');
ok(d1 && d1.filial === 'Ribeirão Preto' && d1.vencimento === '2026-11-20' && d1.status === 'Lançar' && d1.origem === 'importacao', 'campos (data, filial, vencimento, nº com 9 dígitos) vieram certos');
ok(d1.recebido_em === '2026-10-17T16:42:44.000+00:00', 'carimbo da planilha (horário de Brasília) virou o instante certo');
ok(d2 && d2.vencimento === '2026-11-20' && /Frete/.test(d2.tipo), 'vencimento em dd/mm/aaaa também é entendido');
chamar('POST', '/api/lancamentos/sincronizar');
ok(q(db.from('lanc_documentos').select('id', { count: 'exact', head: true })).count === 2, 'sincronizar de novo não duplica');

linhas = [...linhas, ['18/10/2026 09:00:00', 'maria@premix.com.br', 'Matão', 'Nota Fiscal - Matéria prima', '555', '2026-11-25', '', 'Lançar', 'https://drive.google.com/file/d/NF33333333333/view', '', '']];
linhas[0] = linhas[0].map((v, i) => (i === 7 ? 'Lançado' : v));
const s3 = chamar('POST', '/api/lancamentos/sincronizar').json;
ok(s3.inseridos === 1 && s3.atualizados === 0, 'no modo "sync" só entram documentos novos; os existentes não são alterados pela planilha');
ok(q(db.from('lanc_documentos').select('status').eq('id', d1.id).single()).data.status === 'Lançar', 'documento existente mantém o status do painel');

// lançado pelo painel → espelha de volta na planilha-base
const jaMovido = chamar('PATCH', `/api/lancamentos/${d2.id}`, { acao: 'pendenciar', motivo: 'PO em Aprovação' });
ok(jaMovido.status === 200, 'analista marca pendente no painel');
q(db.from('lanc_documentos').update({ recebido_em: '2026-10-17T16:42:44+00:00', filial: 'Ribeirão Preto', origem: 'portal', status: 'Lançar' }).eq('id', d2.id));
chamadasSheets.length = 0;
const lanc = chamar('PATCH', `/api/lancamentos/${d2.id}`, { acao: 'lancar', confirmado: true });
ok(lanc.status === 200, 'analista lança');
const escrito = chamadasSheets.flatMap((c) => c.data || []);
ok(escrito.some((c) => /Lancamentos'?!I2$/.test(c.range) && c.values[0][0] === 'Lançado'), 'status "Lançado" foi gravado na planilha-base (coluna I)');
ok(escrito.some((c) => /!N2$/.test(c.range) && c.values[0][0] === 'Ana Fiscal'), 'responsável gravado na planilha-base (coluna N)');

F.respostas = [{ url: /sheets\.googleapis\.com/, status: 403, corpo: { error: { message: 'The caller does not have permission' } } }];
const bad = chamar('POST', '/api/lancamentos/sincronizar');
ok(bad.status >= 400 && /permission|permiss|Não consegui ler/i.test(bad.corpo), 'sem permissão na planilha: erro claro, sem derrubar o sistema');
process.exitCode = falhou ? 1 : 0;
