/* GERADO AUTOMATICAMENTE por google-workspace/build — não edite à mão.
   Funções que o Apps Script chama. O servidor está nos arquivos Servidor-NN.js e a tela nos Painel-NN.js. */
var __PMX_CARREGADO = null;
function __pmx() {
  if (!__PMX_CARREGADO) __PMX_CARREGADO = (0, eval)(__PMX_P1() + __PMX_P2() + __PMX_P3() + __PMX_P4() + __PMX_P5());
  return __PMX_CARREGADO;
}
var __PMX_DIAG = "<script>(function(){var erros=[];function mostrar(){var d=document.getElementById(\"pmx-diag\");if(!d){d=document.createElement(\"pre\");d.id=\"pmx-diag\";d.style.cssText=\"position:fixed;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;margin:0;padding:10px;background:#fff3f3;color:#7a1010;border:1px solid #e0a0a0;border-radius:8px;font:12px/1.4 monospace;white-space:pre-wrap;z-index:2147483647\";if(document.body)document.body.appendChild(d);}d.textContent=\"Erro ao carregar a tela (copie este texto e envie ao suporte):\\n\"+erros.join(\"\\n\");}window.addEventListener(\"error\",function(e){erros.push((e.message||\"erro\")+(e.lineno?\" (linha \"+e.lineno+\", coluna \"+e.colno+\")\":\"\"));mostrar();});window.addEventListener(\"unhandledrejection\",function(e){erros.push(\"promessa: \"+((e.reason&&e.reason.message)||e.reason));mostrar();});setTimeout(function(){var r=document.getElementById(\"raiz\");if(r&&!r.firstChild){erros.push(\"A tela nao iniciou em 10 segundos.\");mostrar();}},10000);})();</script>";
function __painelHtml() { return (__PAINEL_P1() + __PAINEL_P2()).replace('<head>', function () { return '<head>' + __PMX_DIAG; }); }
function api(req) { return __pmx().api(req); }
function doGet(e) { return __pmx().doGet(e); }
function doPost(e) { return __pmx().doPost(e); }
function salvarFornecedor(payload) { return __pmx().salvarFornecedor(payload); }
function salvarProduto(payload) { return __pmx().salvarProduto(payload); }
function lerImagem(caminho) { return __pmx().lerImagem(caminho); }
function prepararAbas() { return __pmx().prepararAbas(); }
function importarTabela(nome, linhas) { return __pmx().importarTabela(nome, linhas); }
function esquema() { return __pmx().esquema(); }
function limparTabela(nome) { return __pmx().limparTabela(nome); }
function gatilhoLancamentos() { return __pmx().gatilho('lancamentos'); }
function gatilhoPendencias() { return __pmx().gatilho('pendencias'); }
