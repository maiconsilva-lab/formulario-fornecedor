/* Armazenamento físico: cada tabela é uma aba; a linha 1 tem os nomes das colunas.
 *
 *  - Texto, datas e JSON são gravados como texto (prefixo ') — a planilha nunca
 *    "converte" CEP, agência 0001 ou datas, e nada vira fórmula.
 *  - Números e booleanos ficam nativos (dá para somar/filtrar na planilha).
 *  - Textos acima de ~45 mil caracteres (limite da célula é 50 mil) vão para a
 *    aba _grandes, em partes; a célula guarda só a referência §grande:<id>.
 *  - Dentro de uma execução cada aba é lida uma vez e mantida em memória.
 */
import { ESQUEMA, PLANILHA_DA_TABELA, tabelaDef, normalizar, uuid } from './esquema.js';

const LIMITE_CELULA = 45000;
const MARCA_GRANDE = '§grande:';
const ABA_GRANDES = '_grandes';

const cache = {};          // tabela -> { def, sheet, cols, linhas }
const planilhas = {};      // 'cadastros' | 'operacao' | 'historico' -> Spreadsheet
let grandes = null;        // { sheet, mapa: id -> texto }

export function idPlanilha(qual) {
  const prop = 'PLANILHA_' + qual.toUpperCase();
  const id = PropertiesService.getScriptProperties().getProperty(prop);
  if (!id) throw new Error(`Configuração ausente: ${prop}. Rode setup() primeiro.`);
  return id;
}

function planilha(qual) {
  if (!planilhas[qual]) planilhas[qual] = SpreadsheetApp.openById(idPlanilha(qual));
  return planilhas[qual];
}

/* ── Trava global: toda escrita passa por aqui (reentrante dentro da mesma execução). ── */
let profundidade = 0;
let trava = null;
export function comTrava(fn) {
  if (profundidade === 0) {
    trava = LockService.getScriptLock();
    if (!trava.tryLock(30000)) throw Object.assign(new Error('Sistema ocupado. Tente novamente em instantes.'), { code: 'LOCK' });
    // Outra execução pode ter gravado enquanto esperávamos: relê as abas tocadas.
    for (const k of Object.keys(cache)) delete cache[k];
    grandes = null;
  }
  profundidade++;
  try {
    return fn();
  } finally {
    profundidade--;
    if (profundidade === 0) {
      SpreadsheetApp.flush();
      trava.releaseLock();
      trava = null;
    }
  }
}

/* ── _grandes ── */
function carregarGrandes() {
  if (grandes) return grandes;
  const ss = planilha('operacao');
  let sh = ss.getSheetByName(ABA_GRANDES);
  if (!sh) {
    sh = ss.insertSheet(ABA_GRANDES);
    sh.getRange(1, 1, 1, 3).setValues([['id', 'parte', 'texto']]);
  }
  const mapa = {};
  const n = sh.getLastRow();
  if (n > 1) {
    const vals = sh.getRange(2, 1, n - 1, 3).getValues();
    vals.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    for (const [id, , texto] of vals) mapa[id] = (mapa[id] || '') + String(texto);
  }
  grandes = { sheet: sh, mapa };
  return grandes;
}
function guardarGrande(texto) {
  const g = carregarGrandes();
  const id = uuid();
  const partes = [];
  for (let i = 0, p = 0; i < texto.length; i += LIMITE_CELULA, p++) partes.push([id, p, "'" + texto.slice(i, i + LIMITE_CELULA)]);
  g.sheet.getRange(g.sheet.getLastRow() + 1, 1, partes.length, 3).setValues(partes);
  g.mapa[id] = texto;
  return MARCA_GRANDE + id;
}
function apagarGrande(celula) {
  if (typeof celula !== 'string' || !celula.startsWith(MARCA_GRANDE)) return;
  const id = celula.slice(MARCA_GRANDE.length);
  const g = carregarGrandes();
  const vals = g.sheet.getLastRow() > 1 ? g.sheet.getRange(2, 1, g.sheet.getLastRow() - 1, 1).getValues() : [];
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] === id) g.sheet.deleteRow(i + 2);
  delete g.mapa[id];
}

/* ── Codificação célula <-> valor ── */
function decodificar(tipo, cel) {
  if (cel === '' || cel === null || cel === undefined) return null;
  if (typeof cel === 'string' && cel.startsWith(MARCA_GRANDE)) {
    const texto = carregarGrandes().mapa[cel.slice(MARCA_GRANDE.length)];
    cel = texto === undefined ? null : texto;
    if (cel === null) return null;
  }
  if (tipo === 'j' || tipo === 'ta') {
    if (typeof cel !== 'string') return normalizar(tipo, cel);
    try { return JSON.parse(cel); } catch { return tipo === 'ta' ? normalizar(tipo, cel) : cel; }
  }
  return normalizar(tipo, cel);
}

function codificar(tipo, v) {
  if (v === null || v === undefined) return '';
  if (tipo === 'i' || tipo === 'n') return typeof v === 'number' ? v : Number(v);
  if (tipo === 'b') return !!v;
  let s = (tipo === 'j' || tipo === 'ta') ? JSON.stringify(v) : String(v);
  if (s === '') return '';
  if (s.length > LIMITE_CELULA) return guardarGrande(s);
  return "'" + s;
}

/* ── Tabelas ── */
export function carregar(nome) {
  if (cache[nome]) return cache[nome];
  const def = tabelaDef(nome);
  const ss = planilha(PLANILHA_DA_TABELA(nome));
  let sheet = ss.getSheetByName(nome);
  if (!sheet) sheet = criarAba(ss, nome);
  const ultimaCol = Math.max(sheet.getLastColumn(), 1);
  const ultimaLin = sheet.getLastRow();
  const todos = ultimaLin > 0 ? sheet.getRange(1, 1, ultimaLin, ultimaCol).getValues() : [[]];
  let cols = (todos[0] || []).map(String).filter(Boolean);
  const faltando = def.colunas.map((c) => c.nome).filter((c) => !cols.includes(c));
  if (faltando.length) {
    sheet.getRange(1, cols.length + 1, 1, faltando.length).setValues([faltando]);
    cols = cols.concat(faltando);
  }
  const linhas = [];
  for (let r = 1; r < todos.length; r++) {
    const bruta = todos[r];
    if (bruta.every((c) => c === '' || c === null)) continue; // linha vazia no meio
    const obj = { __linha: r + 1 };
    cols.forEach((c, i) => {
      const tipo = def.tipos[c] || 't';
      const cel = bruta[i];
      if (typeof cel === 'string' && cel.startsWith(MARCA_GRANDE)) (obj.__grandes = obj.__grandes || {})[c] = cel;
      obj[c] = decodificar(tipo, cel);
    });
    linhas.push(obj);
  }
  cache[nome] = { def, sheet, cols, linhas };
  return cache[nome];
}

export function criarAba(ss, nome) {
  const def = ESQUEMA[nome];
  const sheet = ss.insertSheet(nome);
  const cols = def.colunas.map((c) => c.nome);
  sheet.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#E8F5E9');
  sheet.setFrozenRows(1);
  return sheet;
}

function linhaCodificada(t, obj) {
  return t.cols.map((c) => codificar(t.def.tipos[c] || 't', obj[c]));
}

/** Acrescenta linhas no fim da aba (uma chamada para o lote todo). */
export function anexar(nome, objs) {
  if (!objs.length) return;
  const t = carregar(nome);
  const inicio = t.sheet.getLastRow() + 1;
  const valores = objs.map((o) => linhaCodificada(t, o));
  t.sheet.getRange(inicio, 1, valores.length, t.cols.length).setValues(valores);
  objs.forEach((o, i) => { o.__linha = inicio + i; t.linhas.push(o); });
}

/** Regrava linhas já existentes (objetos de t.linhas que foram alterados). */
export function regravar(nome, objs) {
  const t = carregar(nome);
  objs.forEach((o) => {
    if (o.__grandes) { Object.values(o.__grandes).forEach(apagarGrande); delete o.__grandes; }
    t.sheet.getRange(o.__linha, 1, 1, t.cols.length).setValues([linhaCodificada(t, o)]);
  });
}

/** Remove linhas. Muitas remoções de uma vez: regrava a aba inteira (bem mais rápido). */
export function remover(nome, objs) {
  if (!objs.length) return;
  const t = carregar(nome);
  const alvo = new Set(objs);
  objs.forEach((o) => { if (o.__grandes) Object.values(o.__grandes).forEach(apagarGrande); });
  const restantes = t.linhas.filter((o) => !alvo.has(o));
  if (objs.length > 15) {
    const ultima = t.sheet.getLastRow();
    if (ultima > 1) t.sheet.getRange(2, 1, ultima - 1, t.cols.length).clearContent();
    restantes.forEach((o) => { if (o.__grandes) { Object.values(o.__grandes).forEach(apagarGrande); delete o.__grandes; } });
    if (restantes.length) {
      t.sheet.getRange(2, 1, restantes.length, t.cols.length).setValues(restantes.map((o) => linhaCodificada(t, o)));
    }
    if (ultima > restantes.length + 1) t.sheet.deleteRows(restantes.length + 2, ultima - restantes.length - 1);
    restantes.forEach((o, i) => { o.__linha = i + 2; });
  } else {
    const linhasPlan = objs.map((o) => o.__linha).sort((a, b) => b - a);
    for (const r of linhasPlan) t.sheet.deleteRow(r);
    for (const o of restantes) o.__linha -= linhasPlan.filter((r) => r < o.__linha).length;
  }
  t.linhas = restantes;
}

/** Próximo id numérico (equivale ao nextval da sequência). */
export function proximoId(nome, coluna = 'id') {
  const t = carregar(nome);
  let max = 0;
  for (const o of t.linhas) if (typeof o[coluna] === 'number' && o[coluna] > max) max = o[coluna];
  t.__seq = Math.max(t.__seq || 0, max) + 1;
  return t.__seq;
}

/** Esquece o que está em memória (usado pelos testes e pela migração). */
export function limparCache() {
  for (const k of Object.keys(cache)) delete cache[k];
  for (const k of Object.keys(planilhas)) delete planilhas[k];
  grandes = null;
}
