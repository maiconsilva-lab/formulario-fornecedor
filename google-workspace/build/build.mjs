/* Gera a pasta gas/ (tudo que vai para o Apps Script) a partir do código do painel.
   Uso:  node build.mjs [caminho-do-painel-fornecedores]        (padrão: ../../../painel-fornecedores) */
import fs from 'node:fs';
import path from 'node:path';
import { construirServidor } from './servidor.mjs';
import { construirCliente } from './cliente.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const RAIZ = path.resolve(AQUI, '..');
const painel = path.resolve(process.argv[2] || path.join(RAIZ, '../../painel-fornecedores'));
if (!fs.existsSync(path.join(painel, 'app/api'))) { console.error('Painel não encontrado em ' + painel); process.exit(1); }
const gas = path.join(RAIZ, 'gas');
fs.mkdirSync(gas, { recursive: true });

const s = await construirServidor({ painel, saida: path.join(gas, 'Servidor.js') });
const c = await construirCliente({ painel, saida: path.join(gas, 'Painel.html') });
for (const f of ['Fornecedor.html', 'Produtos.html']) fs.copyFileSync(path.join(RAIZ, 'paginas', f), path.join(gas, f));
for (const f of ['appsscript.json', 'Setup.js']) fs.copyFileSync(path.join(RAIZ, 'estatico', f), path.join(gas, f));
let commit = 'desconhecido';
try { commit = (await import('node:child_process')).execSync('git -C ' + JSON.stringify(painel) + ' rev-parse --short HEAD').toString().trim(); } catch { /* sem git */ }
fs.writeFileSync(path.join(gas, 'VERSAO.txt'), `Gerado do painel-fornecedores @ ${commit}\n${s.rotas} rotas de API · servidor ${(s.bytes / 1024).toFixed(0)} KB em ${s.partes} partes · painel ${(c.bytes / 1024).toFixed(0)} KB\n`);
console.log(fs.readFileSync(path.join(gas, 'VERSAO.txt'), 'utf8'));
