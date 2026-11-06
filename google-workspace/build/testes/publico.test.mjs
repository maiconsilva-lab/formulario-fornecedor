/* Formulários públicos no navegador + bloqueio do painel para quem não é da organização. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { montar } from './servidor.test.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
let falhou = false; const ok = (c, m) => { if (!c) { falhou = true; console.error('FALHOU:', m); } else console.log('ok -', m); };

const { ctx, gas } = montar();
gas.propriedades.PASTA_FORNECEDORES = 'pasta-forn';
const db = ctx.PMX.createClient(); const q = (p) => ctx.PMX.agora(p);
const pdf = Buffer.from('%PDF-1.4 teste');
fs.writeFileSync('/tmp/doc.pdf', pdf);

// 1) acesso
const S = gas.globais.Session;
S.getActiveUser = () => ({ getEmail: () => '' });
ok(ctx.api({ metodo: 'GET', caminho: '/api/auth/session' }).status === 401, 'anônimo não alcança a API do painel');
ok(ctx.lerImagem('login/leite.jpg') === null, 'anônimo não lê imagens do painel');
const pag = (p) => ctx.doGet({ parameter: p ? { pagina: p } : {} }).conteudo;
ok(pag(null) === 'Fornecedor' && pag('painel') === 'Fornecedor', 'anônimo só recebe o formulário de fornecedor');
ok(pag('produtos') === 'Produtos', 'anônimo pode abrir o formulário de produtos');
S.getActiveUser = () => ({ getEmail: () => 'ana@premix.com.br' });
ok(pag(null) === 'Painel', 'conta da organização recebe o painel');
gas.propriedades.DOMINIO_PERMITIDO = 'premix.com.br';
S.getActiveUser = () => ({ getEmail: () => 'estranho@gmail.com' });
ok(ctx.api({ metodo: 'GET', caminho: '/api/auth/session' }).status === 401 && pag('painel') === 'Fornecedor', 'conta de outro domínio é barrada');
S.getActiveUser = () => ({ getEmail: () => '' });

// 2) formulário de fornecedor completo
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const erros = []; pagina.on('pageerror', (e) => erros.push(e.message));
await pagina.exposeFunction('__chamar', (fn, arg) => JSON.parse(JSON.stringify(ctx.PMX[fn](arg))));
await pagina.route(/fonts\.|premix\.com\.br|brasilapi|viacep/, (r) => r.abort());
await pagina.addInitScript(() => {
  const mk = (ok, falha) => new Proxy({}, { get: (_, nome) => nome === 'withSuccessHandler' ? (f) => mk(f, falha) : nome === 'withFailureHandler' ? (f) => mk(ok, f) : (a) => window.__chamar(nome, a).then(ok, falha) });
  window.google = { script: { run: mk(() => {}, () => {}) } };
});
for (const [arq, rota] of [['Fornecedor', 'f'], ['Produtos', 'p']]) await pagina.route(`http://pub.test/${rota}`, (r) => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(new URL(`../../${process.env.GAS_DIR || 'gas'}/${arq}.html`, import.meta.url), 'utf8') }));

await pagina.goto('http://pub.test/f');
await pagina.click('#startBtn');
const f = (n, v) => pagina.fill(`[name=${n}]`, v);
await f('razao_social', '=HYPERLINK("http://x")'); await f('cnpj', '12345678000190'); await pagina.check('#ieIsento'); await pagina.click('#s1 .btn1');
await f('responsavel_nome', 'Ana'); await f('celular', '11999990000'); await f('email', 'a@b.com'); await pagina.click('#s2 .btn1');
for (const [n, v] of [['cep', '01001000'], ['logradouro', 'Rua A'], ['numero', '10'], ['bairro', 'Centro'], ['cidade', 'São Paulo']]) await f(n, v);
await pagina.selectOption('[name=estado]', 'SP'); await pagina.click('#s3 .btn1');
for (const [n, v] of [['banco', 'Itaú'], ['agencia', '0001'], ['conta', '12345-6'], ['titular_conta', 'ACME'], ['cpf_cnpj_titular', '12345678000190']]) await f(n, v);
await pagina.click('#s4 .btn1');
for (const n of ['comprovante_cnpj', 'contrato_social', 'comprovante_bancario']) await pagina.setInputFiles(`[name=${n}]`, '/tmp/doc.pdf');
await pagina.click('#s5 .btn1'); await f('nome_solicitante', 'Zé'); await f('email_solicitante', 'ze@premix.com.br'); await pagina.click('#s7 .btn1');
await pagina.waitForTimeout(1100); await pagina.click('#sbtn'); await pagina.waitForTimeout(800);
ok(await pagina.isVisible('#successScreen'), 'formulário de fornecedor: tela de sucesso');
const forn = q(db.from('fornecedores').select('*').single()).data;
ok(forn && forn.status === 'pendente' && forn.razao_social === '=HYPERLINK("http://x")', 'cadastro gravado na planilha, status pendente');
ok(/drive\.google\.com\/file/.test(forn.comprovante_cnpj_url) && forn.arquivos_drive.length === 3 && Object.keys(gas.arquivos).length === 3, '3 documentos no Drive, links gravados');
const aba = gas.planilhas[gas.propriedades.PLANILHA_CADASTROS].getSheetByName('fornecedores');
const enviados = aba.brutos.filter((v) => typeof v === 'string');
ok(enviados.includes("'=HYPERLINK(\"http://x\")") && !enviados.some((v) => /^[=+@]/.test(v)), 'texto com "=" foi gravado como texto (nada vira fórmula)');
ok(enviados.includes("'0001") || enviados.includes("'12345-6"), 'agência/conta gravadas como texto (sem perder zeros)');

// 3) formulário de produtos
await pagina.goto('http://pub.test/p');
const campos = await pagina.$$eval('input,select,textarea', (els) => els.map((e) => e.name || e.dataset.field).filter(Boolean));
ok(campos.includes('nome_solicitante') && campos.includes('email_solicitante'), 'formulário de produtos abriu');
const r1 = ctx.PMX.salvarProduto({ tabela: 'produtos', records: [{ nome_solicitante: 'Zé', email_solicitante: 'Ze@Premix.com.br', solicitacao_id: '11111111-1111-4111-8111-111111111111', descricao: 'Parafuso', finalidade: 'Manutenção', unidade_medida: 'UN', status: 'aprovado', codigo_protheus: 'HACK' }] });
const prod = q(db.from('produtos').select('*').single()).data;
ok(r1.ok && prod.status === 'pendente' && prod.codigo_protheus === null && prod.email_solicitante === 'ze@premix.com.br', 'produto gravado; campos internos ignorados');
ok(ctx.PMX.salvarProduto({ tabela: 'produtos', records: [{ nome_solicitante: 'X', email_solicitante: 'x@gmail.com', solicitacao_id: 'a', descricao: 'd', finalidade: 'f', unidade_medida: 'UN' }] }).ok === false, 'e-mail fora do domínio é recusado');
ok(ctx.PMX.salvarProduto({ tabela: 'usuarios_painel', records: [{}] }).ok === false, 'não grava em tabela arbitrária');
const d1 = ctx.PMX.salvarProduto({ tabela: 'desbloqueios', records: [{ nome_solicitante: 'Zé', email_solicitante: 'ze@premix.com.br', solicitacao_id: '22222222-2222-4222-8222-222222222222', codigo_produto: '123', motivo: 'Precisa' }] });
ok(d1.ok, 'desbloqueio gravado');
if (erros.length) console.log('erros de página:', erros);
await navegador.close();
process.exitCode = falhou ? 1 : 0;
