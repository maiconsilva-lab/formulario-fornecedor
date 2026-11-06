/* Gera a pasta gas/ (tudo que vai para o Apps Script) a partir do código do painel.
   Uso:  node build.mjs [caminho-do-painel-fornecedores]        (padrão: ../../../painel-fornecedores) */
import fs from 'node:fs';
import path from 'node:path';
import { construirServidor } from './servidor.mjs';
import { construirCliente } from './cliente.mjs';
import { perfil as obterPerfil } from './perfis.mjs';
import { emitirPartes, juntar } from './partes.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const RAIZ = path.resolve(AQUI, '..');
const args = process.argv.slice(2);
const iPerfil = args.indexOf('--perfil');
const nomePerfil = iPerfil >= 0 ? args.splice(iPerfil, 2)[1] : 'lancamentos';
const perfil = obterPerfil(nomePerfil);
const painel = path.resolve(args[0] || path.join(RAIZ, '../../painel-fornecedores'));
if (!fs.existsSync(path.join(painel, 'app/api'))) { console.error('Painel não encontrado em ' + painel); process.exit(1); }
const gas = path.join(RAIZ, nomePerfil === 'lancamentos' ? 'gas' : 'gas-' + nomePerfil);
fs.rmSync(gas, { recursive: true, force: true });
fs.mkdirSync(gas, { recursive: true });

const s = await construirServidor({ painel, perfil });
const c = await construirCliente({ painel, perfil });
const nServidor = emitirPartes(s.envolto, '__PMX', 'Servidor', gas);
const nPainel = emitirPartes(c.html, '__PAINEL', 'Painel', gas);
fs.writeFileSync(path.join(gas, 'Funcoes.js'), `/* GERADO AUTOMATICAMENTE por google-workspace/build — não edite à mão.
   Funções que o Apps Script chama. O servidor está nos arquivos Servidor-NN.js e a tela nos Painel-NN.js. */
var __PMX_CARREGADO = null;
function __pmx() {
  if (!__PMX_CARREGADO) __PMX_CARREGADO = (0, eval)(${juntar('__PMX', nServidor)});
  return __PMX_CARREGADO;
}
function __painelHtml() { return ${juntar('__PAINEL', nPainel)}; }
${Object.entries(s.FUNCOES).map(([f, a]) => `function ${f}(${a}) { return __pmx().${f}(${a}); }`).join('\n')}
${Object.entries(s.GATILHOS).map(([f, q]) => `function ${f}() { return __pmx().gatilho('${q}'); }`).join('\n')}
`);
for (const f of perfil.publicas.map((x) => ({ fornecedor: 'Fornecedor.html', produtos: 'Produtos.html' })[x])) fs.copyFileSync(path.join(RAIZ, 'paginas', f), path.join(gas, f));
for (const f of ['appsscript.json', 'Setup.js']) fs.copyFileSync(path.join(RAIZ, 'estatico', f), path.join(gas, f));
fs.copyFileSync(path.join(RAIZ, '.claspignore'), path.join(gas, '.claspignore'));
let commit = 'desconhecido';
try { commit = (await import('node:child_process')).execSync('git -C ' + JSON.stringify(painel) + ' rev-parse --short HEAD').toString().trim(); } catch { /* sem git */ }
fs.writeFileSync(path.join(gas, 'VERSAO.txt'), `Perfil: ${nomePerfil} — ${perfil.descricao}\nGerado do painel-fornecedores @ ${commit}\n${s.rotas} rotas de API · servidor ${(s.bytes / 1024).toFixed(0)} KB em ${nServidor} arquivos · painel ${(c.bytes / 1024).toFixed(0)} KB em ${nPainel} arquivos\n`);
console.log(fs.readFileSync(path.join(gas, 'VERSAO.txt'), 'utf8'));
