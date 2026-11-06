/**
 * Camada de "banco de dados" sobre Google Planilhas.
 *
 * Cada aba é uma tabela; a linha 1 é o cabeçalho com os nomes das colunas.
 * Toda gravação passa por LockService para evitar que dois envios
 * simultâneos escrevam na mesma linha.
 */

var Db = (function () {

  function aba(planilhaProp, nome) {
    var ss = SpreadsheetApp.openById(getProp_(planilhaProp));
    var sh = ss.getSheetByName(nome);
    if (!sh) throw new Error('Aba não encontrada: ' + nome);
    return sh;
  }

  function cabecalho(sh) {
    return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  }

  /**
   * Grava texto sempre como texto: impede que algo vindo de fora vire fórmula
   * (=, +, -, @) e que a planilha "converta" agência 0001 em 1 ou CEP em número.
   * O apóstrofo inicial não faz parte do valor lido depois.
   */
  function seguro(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean' || typeof v === 'number' || v instanceof Date) return v;
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v);
    return /^[=+\-@\t\r0-9(]/.test(v) ? "'" + v : v;
  }

  function comLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('Sistema ocupado. Tente novamente em instantes.');
    try { return fn(); } finally { lock.releaseLock(); }
  }

  /** Insere um objeto como nova linha, respeitando a ordem do cabeçalho. */
  function inserir(planilhaProp, nome, obj) {
    return comLock(function () {
      var sh = aba(planilhaProp, nome);
      var cols = cabecalho(sh);
      var linha = cols.map(function (c) { return seguro(obj[c]); });
      sh.appendRow(linha);
      return obj;
    });
  }

  /** Insere várias linhas de uma vez (usado na migração). */
  function inserirVarios(planilhaProp, nome, objs) {
    if (!objs.length) return 0;
    return comLock(function () {
      var sh = aba(planilhaProp, nome);
      var cols = cabecalho(sh);
      var linhas = objs.map(function (o) {
        return cols.map(function (c) { return seguro(o[c]); });
      });
      sh.getRange(sh.getLastRow() + 1, 1, linhas.length, cols.length).setValues(linhas);
      return linhas.length;
    });
  }

  /** Lê a aba inteira como lista de objetos. */
  function listar(planilhaProp, nome) {
    var sh = aba(planilhaProp, nome);
    var valores = sh.getDataRange().getValues();
    var cols = valores.shift();
    return valores.map(function (row, i) {
      var o = { _linha: i + 2 };
      cols.forEach(function (c, j) { o[c] = row[j]; });
      return o;
    });
  }

  /** Atualiza campos de uma linha localizada pelo `id`. */
  function atualizar(planilhaProp, nome, id, campos) {
    return comLock(function () {
      var sh = aba(planilhaProp, nome);
      var cols = cabecalho(sh);
      var idCol = cols.indexOf('id') + 1;
      var achou = sh.getRange(2, idCol, Math.max(sh.getLastRow() - 1, 1), 1)
        .createTextFinder(String(id)).matchEntireCell(true).findNext();
      if (!achou) throw new Error('Registro não encontrado: ' + id);
      var r = achou.getRow();
      Object.keys(campos).forEach(function (k) {
        var c = cols.indexOf(k);
        if (c >= 0) sh.getRange(r, c + 1).setValue(seguro(campos[k]));
      });
    });
  }

  return { inserir: inserir, inserirVarios: inserirVarios, listar: listar, atualizar: atualizar, seguro: seguro };
})();
