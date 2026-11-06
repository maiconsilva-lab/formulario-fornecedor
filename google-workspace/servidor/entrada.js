/* Tudo o que o Apps Script expõe (as funções-ponte ficam em gas/Servidor.js, geradas pelo build). */
import { executar } from './principal.js';
import { paginaHtml, doPostExterno, executarGatilho, usuarioInterno } from './web.js';
import { salvarFornecedor, salvarProduto } from './formularios.js';
import { lerImagem as lerImagemInterna } from './imagens.js';
import { ESQUEMA } from './db/esquema.js';
import { carregar, comTrava, anexar, remover } from './db/armazem.js';
import { montarNova, createClient } from './db/consulta.js';

const NEGADO = { status: 401, headers: { 'content-type': 'application/json' }, corpo: JSON.stringify({ error: 'Acesso restrito a contas da organização.' }), base64: false, cookies: [] };

export function api(req) { return usuarioInterno() ? executar(req || {}) : NEGADO; }
export function doGet(e) { return paginaHtml(e || { parameter: {} }); }
export function doPost(e) { return doPostExterno(e || { parameter: {} }); }
export function gatilho(qual) { return executarGatilho(qual); }
export function lerImagem(caminho) { return usuarioInterno() ? lerImagemInterna(caminho) : null; }
export { salvarFornecedor, salvarProduto, createClient };
export { resolverAgora as agora } from './shims/promessa.js';

/* ── Instalação e migração ── */
const VISOES = ['lanc_fila', 'lanc_fretes_v', 'lanc_ajustes_v'];
const _p = typeof __PERFIL__ === 'undefined' ? { tabelas: null } : __PERFIL__;
export const TABELAS = Object.keys(ESQUEMA).filter((n) => !VISOES.includes(n) && (!_p.tabelas || _p.tabelas.includes(n)));

export function esquema() { return Object.fromEntries(TABELAS.map((n) => [n, ESQUEMA[n]])); }
export function prepararAbas() { TABELAS.forEach((n) => carregar(n)); return TABELAS.length; }

/** Importa linhas numa tabela vazia (não mexe se já houver dados). Devolve quantas entraram; negativo = já tinha dados. */
export function importarTabela(nome, linhas) {
  if (!ESQUEMA[nome]) throw new Error('Tabela desconhecida: ' + nome);
  return comTrava(() => {
    const t = carregar(nome);
    if (t.linhas.length) return -t.linhas.length;
    const conhecidas = new Set(ESQUEMA[nome].colunas.map((c) => c.nome));
    const novas = linhas.map((l) => {
      const o = {};
      for (const k of Object.keys(l)) if (conhecidas.has(k)) o[k] = l[k];
      return montarNova(nome, o);
    });
    anexar(nome, novas);
    return novas.length;
  });
}

export { TABELAS as __tabelas };

/** Esvazia uma tabela (mantém o cabeçalho). Só usado pela reimportação final, antes da troca de sistema. */
export function limparTabela(nome) {
  if (!ESQUEMA[nome]) throw new Error('Tabela desconhecida: ' + nome);
  return comTrava(() => { const t = carregar(nome); const n = t.linhas.length; remover(nome, t.linhas.slice()); return n; });
}
