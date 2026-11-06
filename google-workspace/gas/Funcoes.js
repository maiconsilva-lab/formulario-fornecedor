/* GERADO AUTOMATICAMENTE por google-workspace/build — não edite à mão.
   Funções que o Apps Script chama. O servidor está nos arquivos Servidor-NN.js e a tela nos Painel-NN.js. */
var __PMX_CARREGADO = null;
function __pmx() {
  if (!__PMX_CARREGADO) __PMX_CARREGADO = (0, eval)(__PMX_P1() + __PMX_P2() + __PMX_P3() + __PMX_P4() + __PMX_P5());
  return __PMX_CARREGADO;
}
var __PMX_CASCA = "<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n<script>(function(){var erros=[];function mostrar(){var d=document.getElementById(\"pmx-diag\");if(!d){d=document.createElement(\"pre\");d.id=\"pmx-diag\";d.style.cssText=\"position:fixed;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;margin:0;padding:10px;background:#fff3f3;color:#7a1010;border:1px solid #e0a0a0;border-radius:8px;font:12px/1.4 monospace;white-space:pre-wrap;z-index:2147483647\";if(document.body)document.body.appendChild(d);}d.textContent=\"Erro ao carregar a tela (copie este texto e envie ao suporte):\\n\"+erros.join(\"\\n\");}window.pmxErro=function(m){erros.push(String(m));mostrar();};window.addEventListener(\"error\",function(e){erros.push((e.message||\"erro\")+(e.lineno?\" (linha \"+e.lineno+\", coluna \"+e.colno+\")\":\"\"));mostrar();});window.addEventListener(\"unhandledrejection\",function(e){erros.push(\"promessa: \"+((e.reason&&e.reason.message)||e.reason));mostrar();});setTimeout(function(){var r=document.getElementById(\"raiz\");if(r&&r.getAttribute(\"data-pronto\")!==\"1\"){erros.push(\"A tela nao iniciou em 40 segundos.\");mostrar();}},40000);})();</script>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">\n<meta name=\"robots\" content=\"noindex, nofollow\">\n<base target=\"_top\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n</head>\n<body style=\"margin:0;background:#eef1f8\">\n<div id=\"raiz\"><div style=\"font-family:sans-serif;color:#5b6b85;padding:40px\">Carregando…</div></div>\n<script>(function(){function falhar(m){if(window.pmxErro)window.pmxErro(m);}\nfunction nomes(){var o=google.script.run.withSuccessHandler(function(){}),l=[];for(var k in o)if(typeof o[k]===\"function\")l.push(k);return l.join(\", \");}\nfunction chamar(nome,arg,ok,fail){var r=google.script.run.withSuccessHandler(ok).withFailureHandler(fail);\nif(typeof r[nome]===\"function\")r[nome](arg);\nelse if(typeof r.api===\"function\")r.api({__painel:nome===\"painelInfo\"?\"info\":\"parte\",i:arg});\nelse fail(new Error(\"O servidor nao expos as funcoes necessarias. Disponiveis: \"+nomes()));}\nchamar(\"painelInfo\",0,function(info){\nvar partes=new Array(info.n),faltam=info.n;\nfunction pedir(i,t){chamar(\"painelParte\",i,function(x){partes[i]=x;if(--faltam===0)montar();},function(e){if(t<2)pedir(i,t+1);else falhar(\"Falha ao baixar o pedaco \"+(i+1)+\" de \"+info.n+\": \"+(e&&e.message||e));});}\nfunction montar(){var s=partes.join(\"\");if(s.length!==info.len){falhar(\"Tela incompleta: chegaram \"+s.length+\" de \"+info.len+\" caracteres.\");return;}\nvar k=s.indexOf(String.fromCharCode(1));var st=document.createElement(\"style\");st.textContent=s.slice(0,k);document.head.appendChild(st);\nvar sc=document.createElement(\"script\");sc.text=s.slice(k+1);document.head.appendChild(sc);}\nfor(var i=0;i<info.n;i++)pedir(i,0);},function(e){falhar(\"Nao foi possivel buscar a tela: \"+(e&&e.message||e)+\" | funcoes do servidor visiveis: \"+nomes());});})();</script>\n</body>\n</html>";
function __painelHtml() { return __PMX_CASCA; }
function __painelPayload() { return __PAINEL_P1() + __PAINEL_P2(); }
function __ehInterno() {
  var e = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!e) return false;
  var d = String(PropertiesService.getScriptProperties().getProperty('DOMINIO_PERMITIDO') || '').toLowerCase().replace(/^@/, '');
  return !d || e.slice(-(d.length + 1)) === '@' + d;
}
/* A tela é entregue em pedaços (a casca HTML a busca por google.script.run). Só para contas da organização. */
function painelInfo() { if (!__ehInterno()) throw new Error('Acesso restrito.'); var p = __painelPayload(); return { len: p.length, n: Math.ceil(p.length / 200000) }; }
function painelParte(i) { if (!__ehInterno()) throw new Error('Acesso restrito.'); return __painelPayload().substr(Number(i) * 200000, 200000); }
function api(req) {
  if (req && req.__painel) return req.__painel === 'info' ? painelInfo() : painelParte(req.i);
  return __pmx().api(req);
}
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
