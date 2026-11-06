/* Perfis de build: quais telas, rotas de API e tabelas entram no pacote.
   "lancamentos" é o que está em uso agora; "completo" traz o painel inteiro (para a migração dos demais módulos). */
export const PERFIS = {
  lancamentos: {
    descricao: 'Só o módulo Lançamentos (fila, detalhe, relatórios, envios das filiais)',
    rotasApi: ['auth/', 'lancamentos/', 'filial-acesso'],
    paginas: ['/lancamentos', '/lancamentos/envios'],
    inicial: '/lancamentos',
    publicas: [],
    esconderLinks: ['/pendencias', '/contratos', '/trilha'],
    tabelas: [
      'lanc_documentos', 'lanc_config', 'lanc_historico', 'lanc_ajustes', 'lanc_fretes', 'lanc_transferencias', 'lanc_pessoas_alias',
      'usuarios_painel', 'auditoria', 'filiais', 'filial_atividade', 'acessos_universais', 'preferencias_usuario',
      'monitor_xml', 'rate_limits', 'sync_lock', 'recepcao_demandas', 'recepcao_estado',
    ],
  },
  completo: {
    descricao: 'Painel inteiro e formulários públicos',
    rotasApi: null, // todas
    paginas: ['/', '/pendencias', '/contratos', '/lancamentos', '/lancamentos/envios', '/trilha'],
    inicial: '/',
    publicas: ['fornecedor', 'produtos'],
    esconderLinks: [],
    tabelas: null, // todas
  },
};
export function perfil(nome) {
  const p = PERFIS[nome];
  if (!p) throw new Error(`Perfil desconhecido: ${nome}. Use: ${Object.keys(PERFIS).join(', ')}`);
  return { nome, ...p };
}
