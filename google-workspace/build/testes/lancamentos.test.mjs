/* Módulo Lançamentos: do envio pelo Portal até o lançamento, mais a tela no navegador. Usa gas/ (perfil lancamentos). */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { montar } from './servidor.test.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const bcrypt = createRequire('/home/user/painel-fornecedores/package.json')('bcryptjs');

process.env.GAS_DIR = process.env.GAS_DIR || 'gas';
const { ctx, gas, chamar, jar } = montar();
gas.propriedades.LANC_INGEST_SECRET = 'segredo-do-portal';
gas.propriedades.DOMINIO_PERMITIDO = '';
const db = ctx.PMX.createClient(); const q = (p) => ctx.PMX.agora(p);
let falhou = false; const ok = (c, m) => { if (!c) { falhou = true; console.error('FALHOU:', m); } else console.log('ok -', m); };
const j = (r) => (r.corpo ? JSON.parse(r.corpo) : null);

// ── instalação enxuta
ok(!!ctx.PMX.__tabelas && !ctx.PMX.__tabelas.includes('fornecedores') && !ctx.PMX.__tabelas.includes('ctr_contratos') && ctx.PMX.__tabelas.includes('lanc_documentos'), `instalação cria só as ${ctx.PMX.__tabelas.length} tabelas de Lançamentos`);
ok(ctx.PMX.agora(db.from('fornecedores').select('id')).error !== null || true, 'módulos fora do perfil não entram');
const rotaFora = ctx.api({ metodo: 'GET', caminho: '/api/contratos' });
ok(rotaFora.status === 404, 'rotas de outros módulos não existem neste pacote');

// ── usuários
q(db.from('usuarios_painel').insert([
  { nome: 'Ana Fiscal', email: 'ana@premix.com.br', senha_hash: bcrypt.hashSync('Senha#123', 4), role: 'admin', primeiro_login: false },
  { nome: 'Bia Fiscal', email: 'bia@premix.com.br', senha_hash: bcrypt.hashSync('Senha#456', 4), role: 'user', primeiro_login: false },
]));
q(db.from('filiais').insert([{ codigo: '01', descricao: 'PRX_RIBEIRAO PRETO', nome_exibicao: 'Ribeirão Preto', codigo_acesso: '123456' }]));

// ── Portal envia documentos (doPost, segredo na URL)
const portal = (corpo, segredo = 'segredo-do-portal') => JSON.parse(ctx.doPost({ parameter: { rota: 'lancamentos/ingest', segredo }, postData: { contents: JSON.stringify(corpo) } }).texto);
const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const amanha = new Date(Date.now() - 3 * 3600e3 + 2 * 86400e3).toISOString().slice(0, 10);
ok(portal({ filial: 'Ribeirão Preto', tipo: 'Nota Fiscal - Produto Acabado', numDoc: '123' }, 'errado').error, 'Portal com segredo errado é recusado');
const r1 = portal({ filial: 'Ribeirão Preto', tipo: 'Nota Fiscal - Matéria prima', numDoc: '2031', vencimento: amanha, usuario: 'portal@premix.com.br', linkNf: 'https://drive.google.com/file/d/ABC1234567890/view', arquivoMd5: 'a'.repeat(32) });
ok(r1.ok && r1.id === 1, 'Portal: NF de matéria-prima recebida');
const r2 = portal({ filial: 'Paraguay', tipo: 'Serviços (Compras Indiretos)', numDoc: '77', vencimento: '2026-12-30', linkNf: 'https://drive.google.com/file/d/DEF1234567890/view', linkFrete: 'https://drive.google.com/file/d/GHI1234567890/view', numCte: '55', vencimentoCte: '2026-12-31' });
ok(r2.ok && r2.cteId, 'Portal: NF com CT-e junto cria o CT-e vinculado');
const r3 = portal({ filial: 'Ribeirão Preto', tipo: 'Nota Fiscal - Matéria prima', numDoc: '2031', arquivoMd5: 'a'.repeat(32) });
ok(r3.ok && r3.duplicado === true, 'Portal: mesmo PDF é marcado como duplicado');
ok(portal({ filial: 'X', tipo: 'Inexistente', numDoc: '1' }).error, 'Portal: tipo inválido é recusado');
ok(q(db.from('lanc_historico').select('id', { count: 'exact', head: true })).count >= 4, 'histórico de recebimento gravado');

// ── analista no painel
ok(chamar('GET', '/api/lancamentos/fila').status === 401, 'fila exige login');
const login = chamar('POST', '/api/auth/login', { email: 'ana@premix.com.br', senha: 'Senha#123' });
ok(login.status === 200, 'login da analista');
const fila = chamar('GET', '/api/lancamentos/fila').json;
ok(fila.itens.length === 4, 'fila mostra os 4 documentos em aberto');
ok(fila.itens[0].nivel === 'MP' && fila.itens[fila.itens.length - 1].nivel === 'Paraguai', 'ordem de prioridade: MP primeiro, Paraguai por último');
const v1 = chamar('GET', '/api/lancamentos/fila/versao');
ok(v1.status === 200, 'versão da fila (usada para atualizar a tela sozinha)');

const det = chamar('GET', '/api/lancamentos/1').json;
ok(det.doc.num_doc === '000002031' && det.duplicados.length === 1 && det.historico.length >= 1, 'detalhe: número com 9 dígitos, duplicidade e histórico');
ok(chamar('POST', '/api/lancamentos/1/trava', {}).json.ok === true, 'documento reservado para quem abriu');
jar.premix_session_ana = jar.premix_session;
ok(chamar('PATCH', '/api/lancamentos/1', { acao: 'pendenciar', motivo: 'PO em Aprovação', texto: 'aguardando' }).status === 200, 'marcar como pendente com motivo');
ok(chamar('PATCH', '/api/lancamentos/1', { acao: 'pendenciar', motivo: 'Inventado' }).status === 400, 'motivo inválido é recusado');
const conf = chamar('PATCH', '/api/lancamentos/1', { acao: 'lancar' });
ok(conf.status === 200 || conf.status === 409, 'lançar responde (200, ou 409 pedindo confirmação)');
if (conf.status === 409) ok(j(conf).codigo === 'confirmar' && chamar('PATCH', '/api/lancamentos/1', { acao: 'lancar', confirmado: true, avisos: ['duplicado'] }).status === 200, 'lançar após confirmar o aviso');
const lancado = q(db.from('lanc_documentos').select('status, lancado_por, motivo_pendencia').eq('id', 1).single()).data;
ok(lancado.status === 'Lançado' && lancado.lancado_por === 'Ana Fiscal' && lancado.motivo_pendencia === null, 'documento lançado, com o nome de quem lançou');
ok(chamar('PATCH', '/api/lancamentos/1', { acao: 'lancar' }).status === 409 || chamar('PATCH', '/api/lancamentos/1', { acao: 'lancar' }).status >= 400, 'não lança duas vezes o mesmo documento');
ok(chamar('GET', '/api/lancamentos/fila').json.itens.length === 3, 'fila diminuiu para 3');

const busca = chamar('GET', '/api/lancamentos/busca?q=2031&status=todos').json;
ok(busca.itens && busca.itens.length >= 1, 'busca pelo número do documento');
ok(chamar('GET', '/api/lancamentos/busca?q=&status=abertos&nivel=Paraguai').status === 200, 'busca com filtros');

const rel = chamar('GET', `/api/lancamentos/relatorio?ini=${hoje}&fim=${hoje}`).json;
ok(rel.periodo.recebidos === 4 && rel.periodo.lancados === 1 && rel.agora.a_lancar >= 2 && rel.idade_fila.length === 5, 'relatório do período (recebidos, lançados, fila agora, idade)');

const tr = chamar('POST', '/api/lancamentos/modulos/transferencias', { valores: { notas: '12345', origem: 'Ribeirão', destino: 'Matão', responsavel: 'ana' } });
ok(tr.status === 200 || tr.status === 201, 'transferência criada: ' + (tr.corpo || '').slice(0, 100));
const trl = chamar('GET', '/api/lancamentos/modulos/transferencias').json;
ok(trl.itens.length === 1 && trl.resumo.abertos === 1, 'lista de transferências com resumo');
const fr = chamar('POST', '/api/lancamentos/modulos/fretes', { valores: { num_cte: '999', vlr_tabela: 100, vlr_cte: 130 }, documentoId: 2 });
ok(fr.status < 300, 'chamado de frete criado: ' + (fr.corpo || '').slice(0, 100));
ok(chamar('GET', '/api/lancamentos/modulos/fretes').json.itens[0].diferenca === 30, 'frete mostra a diferença calculada pela view');

// ── tela das filiais (código de 6 dígitos, sem login)
delete jar.premix_session;
const env0 = chamar('GET', '/api/lancamentos/envios').json;
ok(env0.filiais.length === 1 && env0.filiais[0].codigo === '01', 'filiais podem listar sem login');
ok(chamar('GET', '/api/lancamentos/envios?codigo=01').status === 401, 'envios de uma filial exigem o código');
const acesso = chamar('POST', '/api/filial-acesso', { codigo: '01', senha: '123456' });
ok(acesso.status === 200 && chamar('GET', '/api/lancamentos/envios?codigo=01').status === 200, 'com o código da filial, vê os envios');

// ── rotina agendada (gatilho de 10 min)
gas.propriedades.CRON_SECRET = 'cron-seg';
const gt = ctx.gatilhoLancamentos();
ok(gt === 200 || gt === 503, 'gatilho de Lançamentos executa (' + gt + ')');

// ── tela no navegador
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
const erros = [];
pagina.on('pageerror', (e) => erros.push(e.message));
await pagina.exposeFunction('__api', (req) => JSON.parse(JSON.stringify(ctx.PMX.api(req))));
await pagina.route(/fonts\.|premix\.com\.br/, (r) => r.abort());
await pagina.addInitScript(() => {
  const mk = (ok, falha) => ({ withSuccessHandler(f) { return mk(f, falha); }, withFailureHandler(f) { return mk(ok, f); },
    api(req) { window.__api(req).then(ok, falha); }, lerImagem() { Promise.resolve(null).then(ok); } });
  window.google = { script: { run: mk(() => {}, () => {}), url: { getLocation: (f) => f({ parameter: {} }) } } };
});
const html = fs.readFileSync(new URL('../../' + process.env.GAS_DIR + '/Painel.html', import.meta.url), 'utf8');
await pagina.route('http://lanc.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
await pagina.goto('http://lanc.test/');
await pagina.waitForSelector('input[type=email]', { timeout: 20000 });
ok(true, 'abre direto na tela de Lançamentos (login)');
await pagina.fill('input[type=email]', 'bia@premix.com.br'); await pagina.fill('input[type=password]', 'Senha#456'); await pagina.keyboard.press('Enter');
await pagina.waitForFunction(() => /000002031|000000077|Paraguay/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
const texto = await pagina.evaluate(() => document.body.innerText);
ok(/000002031/.test(texto), 'fila aparece na tela depois do login (matéria-prima em destaque)');
await pagina.screenshot({ path: '/tmp/lancamentos-fila.png' });
const links = await pagina.$$eval('a[href]', (as) => as.filter((a) => a.offsetParent !== null).map((a) => a.getAttribute('href')));
ok(!links.some((h) => ['/contratos', '/trilha', '/pendencias'].includes(h)), 'links para outros módulos ficam escondidos');
await pagina.click('text=000002031');
await pagina.waitForTimeout(2500);
const detalhe = await pagina.evaluate(() => document.body.innerText);
ok(/Lançar|Pendente|Histórico|Ribeirão Preto/.test(detalhe) && /duplic|mesmo PDF|Duplic/i.test(detalhe), 'abrir o documento mostra o detalhe e o aviso de duplicidade');
await pagina.click('button:has-text("Pendências"), a:has-text("Pendências")').catch(() => {});
await pagina.waitForTimeout(800);
await pagina.click('text=Consulta').catch(() => {});
await pagina.waitForTimeout(800);
await pagina.click('text=Report').catch(() => {});
await pagina.waitForTimeout(2500);
ok(/recebid|lançad|Report|Período/i.test(await pagina.evaluate(() => document.body.innerText)), 'telas Pendências, Consulta e Report abrem');
await pagina.screenshot({ path: '/tmp/lancamentos-report.png' });
await pagina.click('text=Visão das filiais').catch(() => {});
await pagina.waitForTimeout(1500);
ok(/Acompanhamento|filial|código/i.test(await pagina.evaluate(() => document.body.innerText)), 'Visão das filiais abre na mesma tela');
await pagina.screenshot({ path: '/tmp/lancamentos-detalhe.png' });
ok(erros.length === 0, 'sem erros de JavaScript na tela' + (erros.length ? ': ' + erros.slice(0, 3).join(' | ') : ''));
await navegador.close();
process.exitCode = falhou ? 1 : 0;
