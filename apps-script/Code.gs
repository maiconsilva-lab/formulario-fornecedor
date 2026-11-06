/**
 * Ponto de entrada do Web App.
 *
 * Publicação: Implantar → Nova implantação → Tipo "App da Web"
 *   - Executar como: Eu (conta da organização)
 *   - Quem pode acessar: Qualquer pessoa  (o fornecedor é externo)
 *
 * Para colocar no Google Sites: Inserir → Incorporar → colar a URL /exec.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Cadastro de Fornecedor — Premix')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // Necessário para o formulário aparecer incorporado no Google Sites.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
