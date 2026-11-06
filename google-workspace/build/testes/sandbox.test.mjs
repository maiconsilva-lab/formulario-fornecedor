/* A tela dentro do iframe isolado do Apps Script (sandbox sem allow-same-origin): localStorage, cookies e history bloqueados. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { montar } from './servidor.test.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const bcrypt = createRequire('/home/user/painel-fornecedores/package.json')('bcryptjs');
process.env.GAS_DIR = process.env.GAS_DIR || 'gas';
const { ctx, gas } = montar();
gas.propriedades.DOMINIO_PERMITIDO = '';
const db = ctx.PMX.createClient();
ctx.PMX.agora(db.from('usuarios_painel').insert({ nome: 'Bia Fiscal', email: 'bia@premix.com.br', senha_hash: bcrypt.hashSync('Senha#456', 4), role: 'user', primeiro_login: false }));
let falhou = false; const ok = (c, m) => { if (!c) { falhou = true; console.error('FALHOU:', m); } else console.log('ok -', m); };

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1300, height: 800 } });
const erros = [];
pagina.on('pageerror', (e) => erros.push(e.message));
pagina.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text().slice(0, 160)); });
await pagina.exposeFunction('__chamar', (nome, arg) => { const f = nome === 'api' ? (a) => ctx.PMX.api(a) : nome === 'lerImagem' ? () => null : (a) => ctx[nome](a); const r = f(arg); return JSON.parse(JSON.stringify(r === undefined ? null : r)); });
await pagina.route(/fonts\.|premix\.com\.br/, (r) => r.abort());
await pagina.addInitScript(() => {
  const mk = (ok, falha) => new Proxy({}, { get: (_, nome) => nome === 'withSuccessHandler' ? (f) => mk(f, falha) : nome === 'withFailureHandler' ? (f) => mk(ok, f) : (a) => window.__chamar(nome, a).then(ok, falha) });
  window.google = { script: { run: mk(() => {}, () => {}), url: { getLocation: (f) => f({ parameter: {} }) } } };
});
const html = ctx.__painelHtml();
await pagina.route('http://hospedeiro.test/', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
await pagina.goto('http://hospedeiro.test/');
await pagina.evaluate((h) => {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
  f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
  f.srcdoc = h; document.body.appendChild(f);
}, html);
const frame = pagina.frames().find((f) => f !== pagina.mainFrame());
await frame.waitForSelector('input[type=email]', { timeout: 15000 }).catch(() => {});
const visivel = await frame.evaluate(() => document.body.innerText.trim().length).catch(() => -1);
const bloqueado = await frame.evaluate(() => { try { localStorage.getItem('x'); return false; } catch (e) { return true; } }).catch(() => null);
console.log('localStorage bloqueado no iframe:', bloqueado, '| texto visível:', visivel);
ok(await frame.$('input[type=email]') !== null, 'tela de login aparece dentro do iframe isolado');
if (await frame.$('input[type=email]')) {
  await frame.fill('input[type=email]', 'bia@premix.com.br'); await frame.fill('input[type=password]', 'Senha#456'); await pagina.keyboard.press('Enter');
  await frame.waitForFunction(() => /Fila de lançamento/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  ok(/Fila de lançamento/.test(await frame.evaluate(() => document.body.innerText)), 'login funciona e a fila abre');
}
console.log('erros:', [...new Set(erros)].slice(0, 6));
await navegador.close();
process.exitCode = falhou ? 1 : 0;

// ── se a busca da tela falhar, o erro aparece escrito (em vez de página em branco)
const nav2 = await chromium.launch(); const p2 = await nav2.newPage();
await p2.addInitScript(() => {
  const falha = (f) => ({ withSuccessHandler: () => ({ painelInfo() { f(new Error('falha-de-teste-no-painelInfo')); } }) });
  window.google = { script: { run: { withFailureHandler: falha } } };
});
await p2.route('http://x.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
await p2.goto('http://x.test/'); await p2.waitForTimeout(800);
const diag = await p2.evaluate(() => (document.getElementById('pmx-diag') || {}).textContent || '');
ok(/falha-de-teste-no-painelInfo/.test(diag), 'erro de inicialização aparece escrito na tela: ' + diag.slice(0, 120).replace(/\n/g, ' '));
await nav2.close();
process.exitCode = falhou ? 1 : 0;
