/* Abre gas/Painel.html no Chromium; google.script.run é ligado ao servidor empacotado (gas/Servidor*.js) no Google simulado. */
import { createRequire as cr } from 'node:module';
const { chromium } = cr(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import fs from 'node:fs';
import { montar } from './servidor.test.mjs';
import { createRequire } from 'node:module';
const bcrypt = createRequire('/home/user/painel-fornecedores/package.json')('bcryptjs');

const { ctx, gas } = montar();
const db = ctx.PMX.createClient();
const sinc = (p) => ctx.PMX.agora(p);
sinc(db.from('usuarios_painel').insert({ nome: 'Ana Admin', email: 'ana@premix.com.br', senha_hash: bcrypt.hashSync('Senha#123', 4), role: 'admin', primeiro_login: false }));
sinc(db.from('fornecedores').insert([
  { razao_social: 'Alfa Insumos Ltda', email: 'a@alfa.com', cnpj: '11.111.111/0001-11', tipo_cadastro: 'pj', nome_solicitante: 'Zé', email_solicitante: 'ze@premix.com.br' },
  { razao_social: 'Beta Transportes', email: 'b@beta.com', cnpj: '22.222.222/0001-22', tipo_cadastro: 'pj', status: 'em_analise' },
]));

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
const erros = []; const chamadas = [];
pagina.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
pagina.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text().slice(0, 200)); });
await pagina.exposeFunction('__api', (req) => { chamadas.push(req.metodo + ' ' + req.caminho); return JSON.parse(JSON.stringify(ctx.PMX.api(req))); });
await pagina.route(/fonts\.(googleapis|gstatic)\.com|premix\.com\.br/, (r) => r.abort());
await pagina.addInitScript(() => {
  const mk = (ok, falha) => ({
    withSuccessHandler(f) { return mk(f, falha); }, withFailureHandler(f) { return mk(ok, f); },
    api(req) { window.__api(req).then(ok, falha); }, lerImagem(c) { Promise.resolve(null).then(ok); },
  });
  window.google = { script: { run: mk(() => {}, () => {}), url: { getLocation: (f) => f({ parameter: {} }) } } };
});
const html = fs.readFileSync(new URL('../../gas/Painel.html', import.meta.url), 'utf8');
await pagina.route('http://painel.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
await pagina.goto('http://painel.test/');
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exitCode = 1; } else console.log('ok -', m); };

await pagina.waitForSelector('input[type=email], input[type=password]', { timeout: 20000 });
ok(true, 'tela de login renderizou');
await pagina.fill('input[type=email]', 'ana@premix.com.br');
await pagina.fill('input[type=password]', 'Senha#123');
await pagina.keyboard.press('Enter');
await pagina.waitForFunction(() => /Alfa Insumos|Fila Protheus|Visão Geral|Central de Cadastros/.test(document.body.innerText) && !document.querySelector('input[type=password]'), null, { timeout: 30000 }).catch(() => {});
ok(!(await pagina.$('input[type=password]')), 'entrou no painel (sem campo de senha)');
await pagina.waitForTimeout(1500);
await pagina.screenshot({ path: process.env.SHOT || '/tmp/painel.png' });
const texto = await pagina.evaluate(() => document.body.innerText);
console.log('chamadas:', [...new Set(chamadas)].slice(0, 12).join(' | '));
ok(chamadas.some((c) => c === 'POST /api/auth/login'), 'login passou pelo servidor');
ok(chamadas.some((c) => c.startsWith('GET /api/data/list')), 'listou cadastros');
ok(/Alfa Insumos/.test(texto) || /Beta Transportes/.test(texto) || /Central de Cadastros/.test(texto), 'conteúdo do painel visível');
for (const [href, rotulo] of [['/pendencias', 'Pendências'], ['/lancamentos', 'Lançamentos'], ['/contratos', 'Contratos'], ['/trilha', 'Trilha']]) {
  const antes = erros.length;
  await pagina.evaluate((h) => { window.__pmxLoc.href = h; }, '/');
  await pagina.waitForTimeout(300);
  await pagina.click(`a[href="${href}"]`).catch(async () => { await pagina.evaluate((h) => { window.__pmxLoc.href = h; }, href); });
  await pagina.waitForTimeout(3500);
  const t = await pagina.evaluate(() => document.body.innerText.trim());
  const novos = erros.slice(antes).filter((e) => e.startsWith('pageerror'));
  ok(t.length > 80 && !novos.length, `${rotulo}: renderizou (${t.length} caracteres)${novos.length ? ' ERROS: ' + novos.join(' / ') : ''}`);
  await pagina.screenshot({ path: `/tmp/mod${href.replace(/\//g, '_')}.png` });
}
if (erros.length) console.log('erros no navegador:\n  ' + [...new Set(erros)].slice(0, 8).join('\n  '));
await navegador.close();
