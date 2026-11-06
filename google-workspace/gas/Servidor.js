/* GERADO AUTOMATICAMENTE por google-workspace/build — não edite à mão.
   O servidor (rotas de API do painel-fornecedores + camada de dados em Planilhas)
   está nos arquivos Servidor-parte-NN.js; aqui ficam as funções que o Apps Script chama. */
var __PMX_CARREGADO = null;
function __pmx() {
  if (!__PMX_CARREGADO) __PMX_CARREGADO = (0, eval)(__PMX_PARTE_1 + __PMX_PARTE_2 + __PMX_PARTE_3 + __PMX_PARTE_4);
  return __PMX_CARREGADO;
}
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
