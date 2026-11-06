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
const DIAG = `<script>(function(){var erros=[];function mostrar(){var d=document.getElementById("pmx-diag");if(!d){d=document.createElement("pre");d.id="pmx-diag";d.style.cssText="position:fixed;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;margin:0;padding:10px;background:#fff3f3;color:#7a1010;border:1px solid #e0a0a0;border-radius:8px;font:12px/1.4 monospace;white-space:pre-wrap;z-index:2147483647";if(document.body)document.body.appendChild(d);}d.textContent="Erro ao carregar a tela (copie este texto e envie ao suporte):\\n"+erros.join("\\n");}window.pmxErro=function(m){erros.push(String(m));mostrar();};window.addEventListener("error",function(e){erros.push((e.message||"erro")+(e.lineno?" (linha "+e.lineno+", coluna "+e.colno+")":""));mostrar();});window.addEventListener("unhandledrejection",function(e){erros.push("promessa: "+((e.reason&&e.reason.message)||e.reason));mostrar();});setTimeout(function(){if(document.getElementById("pmx-carregando")){erros.push("A tela nao iniciou em "+Math.round((window.__PMX_TEMPO||40000)/1000)+" segundos.");mostrar();}},window.__PMX_TEMPO||40000);})();</script>`;
/* O código da tela (650 KB) NÃO vai dentro da página HTML: o Apps Script o entregava incompleto.
   A página é só uma casca; este carregador busca o código em pedaços por google.script.run e o executa. */
const LOADER = `<script>(function(){function falhar(m){if(window.pmxErro)window.pmxErro(m);}
function nomes(){var o=google.script.run.withSuccessHandler(function(){}),l=[];for(var k in o)if(typeof o[k]==="function")l.push(k);return l.join(", ");}
function chamar(nome,arg,ok,fail){var r=google.script.run.withSuccessHandler(ok).withFailureHandler(fail);
if(typeof r[nome]==="function")r[nome](arg);
else if(typeof r.api==="function")r.api({__painel:nome==="painelInfo"?"info":"parte",i:arg});
else fail(new Error("O servidor nao expos as funcoes necessarias. Disponiveis: "+nomes()));}
chamar("painelInfo",0,function(info){
var partes=new Array(info.n),faltam=info.n;
function pedir(i,t){chamar("painelParte",i,function(x){partes[i]=x;if(--faltam===0)montar();},function(e){if(t<2)pedir(i,t+1);else falhar("Falha ao baixar o pedaco "+(i+1)+" de "+info.n+": "+(e&&e.message||e));});}
function montar(){var s=partes.join("");if(s.length!==info.len){falhar("Tela incompleta: chegaram "+s.length+" de "+info.len+" caracteres.");return;}
var k=s.indexOf(String.fromCharCode(1));var st=document.createElement("style");st.textContent=s.slice(0,k);document.head.appendChild(st);
var sc=document.createElement("script");sc.text=s.slice(k+1);document.head.appendChild(sc);}
for(var i=0;i<info.n;i++)pedir(i,0);},function(e){falhar("Nao foi possivel buscar a tela: "+(e&&e.message||e)+" | funcoes do servidor visiveis: "+nomes());});})();</script>`;
const CASCA = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
${DIAG}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="robots" content="noindex, nofollow">
<base target="_top">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;background:#eef1f8">
<div id="raiz"><div id="pmx-carregando" style="font-family:sans-serif;color:#5b6b85;padding:40px">Carregando…</div></div>
${LOADER}
</body>
</html>`;
const nServidor = emitirPartes(s.envolto, '__PMX', 'Servidor', gas);
const CORTE = String.fromCharCode(1);
const CH = 200000;
const nPainel = emitirPartes(c.css + CORTE + c.js, '__PAINEL', 'Painel', gas);
fs.writeFileSync(path.join(gas, 'Funcoes.js'), `/* GERADO AUTOMATICAMENTE por google-workspace/build — não edite à mão.
   Funções que o Apps Script chama. O servidor está nos arquivos Servidor-NN.js e a tela nos Painel-NN.js. */
var __PMX_CARREGADO = null;
function __pmx() {
  if (!__PMX_CARREGADO) __PMX_CARREGADO = (0, eval)(${juntar('__PMX', nServidor)});
  return __PMX_CARREGADO;
}
var __PMX_CASCA = ${JSON.stringify(CASCA)};
function __painelHtml() { return __PMX_CASCA; }
function __painelPayload() { return ${juntar('__PAINEL', nPainel)}; }
function __ehInterno() {
  var e = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!e) return false;
  var d = String(PropertiesService.getScriptProperties().getProperty('DOMINIO_PERMITIDO') || '').toLowerCase().replace(/^@/, '');
  return !d || e.slice(-(d.length + 1)) === '@' + d;
}
/* A tela é entregue em pedaços (a casca HTML a busca por google.script.run). Só para contas da organização. */
function painelInfo() { if (!__ehInterno()) throw new Error('Acesso restrito.'); var p = __painelPayload(); return { len: p.length, n: Math.ceil(p.length / ${CH}) }; }
function painelParte(i) { if (!__ehInterno()) throw new Error('Acesso restrito.'); return __painelPayload().substr(Number(i) * ${CH}, ${CH}); }
function api(req) {
  if (req && req.__painel) return req.__painel === 'info' ? painelInfo() : painelParte(req.i);
  return __pmx().api(req);
}
${Object.entries(s.FUNCOES).filter(([f]) => f !== 'api').map(([f, a]) => `function ${f}(${a}) { return __pmx().${f}(${a}); }`).join('\n')}
${Object.entries(s.GATILHOS).map(([f, q]) => `function ${f}() { return __pmx().gatilho('${q}'); }`).join('\n')}
`);
for (const f of perfil.publicas.map((x) => ({ fornecedor: 'Fornecedor.html', produtos: 'Produtos.html' })[x])) fs.copyFileSync(path.join(RAIZ, 'paginas', f), path.join(gas, f));
for (const f of ['appsscript.json', 'Setup.js']) fs.copyFileSync(path.join(RAIZ, 'estatico', f), path.join(gas, f));
fs.copyFileSync(path.join(RAIZ, '.claspignore'), path.join(gas, '.claspignore'));
let commit = 'desconhecido';
try { commit = (await import('node:child_process')).execSync('git -C ' + JSON.stringify(painel) + ' rev-parse --short HEAD').toString().trim(); } catch { /* sem git */ }
fs.writeFileSync(path.join(gas, 'VERSAO.txt'), `Perfil: ${nomePerfil} — ${perfil.descricao}\nGerado do painel-fornecedores @ ${commit}\n${s.rotas} rotas de API · servidor ${(s.bytes / 1024).toFixed(0)} KB em ${nServidor} arquivos · painel ${(c.bytes / 1024).toFixed(0)} KB em ${nPainel} arquivos\n`);
console.log(fs.readFileSync(path.join(gas, 'VERSAO.txt'), 'utf8'));
