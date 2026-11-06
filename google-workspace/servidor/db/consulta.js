/* Cliente compatível com o @supabase/supabase-js (v2) que lê e grava nas planilhas.
 *
 * Cobre o que o painel usa: select (colunas, count, head), insert, upsert
 * (onConflict, ignoreDuplicates), update, delete, filtros eq/neq/gt/gte/lt/lte/
 * like/ilike/is/in/contains/not/or/filter/match, order, limit, range, single,
 * maybeSingle e rpc. Os resultados têm o mesmo formato: { data, error, count, status }.
 */
import { tabelaDef, normalizar, valorPadrao, agoraIso } from './esquema.js';
import { carregar, anexar, regravar, remover, proximoId, comTrava } from './armazem.js';
import { VISOES } from './visoes.js';
import { executarRpc } from './rpc.js';

const erro = (message, code, extra = {}) => ({ message, code, details: extra.details ?? null, hint: extra.hint ?? null });

/* ── Linhas de uma tabela ou visão ── */
function linhasDe(tabela) {
  if (VISOES[tabela]) return VISOES[tabela]();
  return carregar(tabela).linhas;
}
function tiposDe(tabela) {
  if (VISOES[tabela]) return VISOES[tabela].tipos;
  return tabelaDef(tabela).tipos;
}

/* ── Comparação no estilo Postgres ── */
function paraComparar(tipo, v) {
  if (v === null || v === undefined) return null;
  if (tipo === 'i' || tipo === 'n') return typeof v === 'number' ? v : Number(v);
  if (tipo === 'ts') { const t = Date.parse(v); return isNaN(t) ? String(v) : t; }
  if (tipo === 'b') return typeof v === 'boolean' ? v : String(v) === 'true';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function likeRegex(padrao, semCaixa) {
  const s = String(padrao).replace(/\*/g, '%');
  let re = '';
  for (const ch of s) {
    if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', semCaixa ? 'i' : '');
}

function contem(dado, sub) {
  if (sub === null || sub === undefined) return true;
  if (Array.isArray(sub)) return Array.isArray(dado) && sub.every((x) => dado.some((y) => JSON.stringify(y) === JSON.stringify(x) || contem(y, x)));
  if (typeof sub === 'object') return dado && typeof dado === 'object' && Object.keys(sub).every((k) => contem(dado[k], sub[k]));
  return JSON.stringify(dado) === JSON.stringify(sub);
}

/** Lista "(a,b,"c d")" usada em in.(...) */
function lerLista(txt) {
  let s = String(txt).trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
  return dividirTopo(s).map((x) => tirarAspas(x.trim()));
}
function tirarAspas(v) {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, '$1');
  return v;
}
/** Divide por vírgulas que não estão dentro de parênteses nem aspas. */
function dividirTopo(s) {
  const partes = []; let atual = ''; let nivel = 0; let aspas = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (aspas) { atual += ch; if (ch === '\\') { atual += s[++i] ?? ''; } else if (ch === '"') aspas = false; continue; }
    if (ch === '"') { aspas = true; atual += ch; continue; }
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (ch === ',' && nivel === 0) { partes.push(atual); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim() !== '') partes.push(atual);
  return partes;
}

/** Predicado para um operador PostgREST (op em texto) aplicado à coluna. */
function predicado(tipos, col, op, valor, valorJaTipado) {
  const tipo = tipos[col] || 't';
  const conv = (v) => (valorJaTipado ? v : v === 'null' ? null : normalizar(tipo, v));
  switch (op) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': {
      const alvo = paraComparar(tipo, conv(valor));
      return (row) => {
        const v = paraComparar(tipo, row[col]);
        if (v === null || alvo === null) {
          // texto vazio e nulo são equivalentes nas planilhas
          if (op === 'eq' && alvo === '' ) return v === null || v === '';
          if (op === 'neq' && alvo === '') return !(v === null || v === '');
          return false; // comparações com NULL são falsas no SQL
        }
        const c = cmp(v, alvo);
        return op === 'eq' ? c === 0 : op === 'neq' ? c !== 0 : op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
      };
    }
    case 'like': case 'ilike': {
      const re = likeRegex(valor, op === 'ilike');
      return (row) => row[col] !== null && row[col] !== undefined && re.test(typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col]));
    }
    case 'is': {
      const v = valor === null || valor === 'null' ? null : valor === true || valor === 'true' ? true : valor === false || valor === 'false' ? false : valor;
      return (row) => (v === null ? row[col] === null || row[col] === undefined || row[col] === '' : row[col] === v);
    }
    case 'in': {
      const lista = (Array.isArray(valor) ? valor : lerLista(valor)).map((x) => paraComparar(tipo, x === null ? null : normalizar(tipo, x)));
      const set = new Set(lista);
      return (row) => row[col] !== null && row[col] !== undefined && set.has(paraComparar(tipo, row[col]));
    }
    case 'cs': {
      let alvo = valor;
      if (typeof alvo === 'string') { try { alvo = JSON.parse(alvo); } catch { alvo = lerLista(alvo.replace(/^\{|\}$/g, '')); } }
      return (row) => contem(row[col], alvo);
    }
    case 'cd': {
      let alvo = valor;
      if (typeof alvo === 'string') { try { alvo = JSON.parse(alvo); } catch { alvo = lerLista(alvo.replace(/^\{|\}$/g, '')); } }
      return (row) => contem(alvo, row[col]);
    }
    case 'ov': {
      const alvo = Array.isArray(valor) ? valor : lerLista(String(valor).replace(/^\{|\}$/g, ''));
      return (row) => Array.isArray(row[col]) && row[col].some((x) => alvo.includes(x));
    }
    default:
      throw Object.assign(new Error(`Operador não suportado: ${op}`), { code: 'PGRST100' });
  }
}

/** Expressão de or()/and(): "a.eq.1,b.is.null,and(c.gte.2,c.lte.5)" */
function expressao(tipos, texto, modo) {
  const itens = dividirTopo(texto).map((s) => s.trim()).filter(Boolean).map((item) => {
    let neg = false;
    let s = item;
    if (s.startsWith('not.')) { neg = true; s = s.slice(4); }
    let p;
    const grupo = s.match(/^(and|or)\(([\s\S]*)\)$/);
    if (grupo) p = expressao(tipos, grupo[2], grupo[1]);
    else {
      const i1 = s.indexOf('.');
      const col = s.slice(0, i1);
      let resto = s.slice(i1 + 1);
      if (resto.startsWith('not.')) { neg = !neg; resto = resto.slice(4); }
      const i2 = resto.indexOf('.');
      const op = resto.slice(0, i2);
      const val = tirarAspas(resto.slice(i2 + 1));
      p = predicado(tipos, col, op, val, false);
    }
    return neg ? (row) => !p(row) : p;
  });
  return modo === 'and' ? (row) => itens.every((p) => p(row)) : (row) => itens.some((p) => p(row));
}

/* ── Projeção de colunas ── */
function projetor(tabela, colunas) {
  const txt = (colunas ?? '*').replace(/\s+/g, ' ').trim();
  if (txt === '*' || txt === '') return (row) => limpar(row);
  const campos = dividirTopo(txt).map((c) => c.trim()).filter(Boolean);
  const tipos = tiposDe(tabela);
  const lista = campos.map((c) => {
    if (c === '*') return { todos: true };
    let alias = null; let nome = c;
    const ia = c.indexOf(':');
    if (ia > 0 && c[ia + 1] !== ':') { alias = c.slice(0, ia); nome = c.slice(ia + 1); }
    const cast = nome.split('::');
    nome = cast[0].trim();
    if (!(nome in tipos)) throw Object.assign(new Error(`column ${tabela}.${nome} does not exist`), { code: '42703' });
    return { nome, alias: alias || nome, texto: cast[1] === 'text' };
  });
  return (row) => {
    const o = {};
    for (const f of lista) {
      if (f.todos) Object.assign(o, limpar(row));
      else { const v = row[f.nome] === undefined ? null : row[f.nome]; o[f.alias] = f.texto && v !== null ? String(v) : copiar(v); }
    }
    return o;
  };
}
function copiar(v) { return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; }
function limpar(row) {
  const o = {};
  for (const k of Object.keys(row)) if (!k.startsWith('__')) o[k] = copiar(row[k] === undefined ? null : row[k]);
  return o;
}

/* ── Gatilhos (triggers) equivalentes aos do Postgres ── */
const TOCA_UPDATED_AT = new Set(['fornecedores', 'desbloqueios', 'preferencias_usuario', 'recepcao_estado']);
function antesDeInserir(tabela, nova) {
  if (tabela === 'produtos') {
    const umaHora = Date.now() - 3600000;
    const email = String(nova.email_solicitante || '').toLowerCase();
    const recentes = carregar('produtos').linhas.filter((p) => String(p.email_solicitante || '').toLowerCase() === email && Date.parse(p.created_at) > umaHora).length;
    if (recentes >= 100) throw Object.assign(new Error('Limite de cadastros por hora atingido para este e-mail.'), { code: 'P0001' });
  }
}
function antesDeAtualizar(tabela, row) {
  if (TOCA_UPDATED_AT.has(tabela)) row.updated_at = agoraIso();
}

/* ── Restrições de unicidade (PK e UNIQUE) ── */
function checarUnicos(tabela, candidatas, ignorar = new Set()) {
  const def = tabelaDef(tabela);
  const grupos = [def.pk, ...def.unicos].filter((g) => g.length);
  const linhas = carregar(tabela).linhas;
  for (const g of grupos) {
    const chave = (r) => g.map((c) => JSON.stringify(r[c] ?? null)).join('|');
    const vistos = new Map();
    for (const r of linhas) if (!ignorar.has(r) && !candidatas.includes(r)) vistos.set(chave(r), r);
    for (const r of candidatas) {
      if (g.some((c) => r[c] === null || r[c] === undefined)) continue;
      const k = chave(r);
      if (vistos.has(k)) {
        throw Object.assign(new Error(`duplicate key value violates unique constraint "${tabela}_${g.join('_')}_key"`), {
          code: '23505', details: `Key (${g.join(', ')})=(${g.map((c) => r[c]).join(', ')}) already exists.`,
        });
      }
      vistos.set(k, r);
    }
  }
}

export function montarNova(tabela, dados) {
  const def = tabelaDef(tabela);
  for (const k of Object.keys(dados)) {
    if (!(k in def.tipos)) {
      throw Object.assign(new Error(`Could not find the '${k}' column of '${tabela}' in the schema cache`), { code: 'PGRST204' });
    }
  }
  const nova = {};
  for (const c of def.colunas) {
    if (dados[c.nome] !== undefined) nova[c.nome] = normalizar(c.tipo, dados[c.nome]);
    else nova[c.nome] = valorPadrao(c, () => proximoId(tabela, c.nome));
  }
  // Coluna inteira PK sem valor = identity
  for (const c of def.pk) if ((nova[c] === null || nova[c] === undefined) && def.tipos[c] === 'i') nova[c] = proximoId(tabela, c);
  return nova;
}

function aplicar(tabela, row, dados) {
  const def = tabelaDef(tabela);
  for (const [k, v] of Object.entries(dados)) {
    if (!(k in def.tipos)) throw Object.assign(new Error(`Could not find the '${k}' column of '${tabela}' in the schema cache`), { code: 'PGRST204' });
    if (v !== undefined) row[k] = normalizar(def.tipos[k], v);
  }
}

/* ── Construtor de consulta ── */
class Consulta {
  constructor(tabela) {
    this.tabela = tabela;
    this.op = 'select';
    this.cols = '*';
    this.filtros = [];
    this.ordens = [];
    this.lim = null;
    this.faixa = null;
    this.unico = null;
    this.contagem = null;
    this.soCabecalho = false;
    this.retornar = false;
    this.payload = null;
    this.opcoes = {};
  }

  select(cols = '*', opts = {}) {
    if (this.op === 'select') { this.cols = cols; this.contagem = opts.count || null; this.soCabecalho = !!opts.head; }
    else { this.retornar = true; this.cols = cols; }
    return this;
  }
  insert(v, opts = {}) { this.op = 'insert'; this.payload = v; this.opcoes = opts; if (opts.count) this.contagem = opts.count; return this; }
  upsert(v, opts = {}) { this.op = 'upsert'; this.payload = v; this.opcoes = opts; if (opts.count) this.contagem = opts.count; return this; }
  update(v, opts = {}) { this.op = 'update'; this.payload = v; this.opcoes = opts; if (opts.count) this.contagem = opts.count; return this; }
  delete(opts = {}) { this.op = 'delete'; this.opcoes = opts; if (opts.count) this.contagem = opts.count; return this; }

  _f(fn) { this.filtros.push(fn); return this; }
  _p(col, op, val, tipado = true) { return this._f(() => predicado(tiposDe(this.tabela), col, op, val, tipado)); }
  eq(c, v) { return this._p(c, 'eq', v); }
  neq(c, v) { return this._p(c, 'neq', v); }
  gt(c, v) { return this._p(c, 'gt', v); }
  gte(c, v) { return this._p(c, 'gte', v); }
  lt(c, v) { return this._p(c, 'lt', v); }
  lte(c, v) { return this._p(c, 'lte', v); }
  like(c, v) { return this._p(c, 'like', v); }
  ilike(c, v) { return this._p(c, 'ilike', v); }
  is(c, v) { return this._p(c, 'is', v); }
  in(c, v) { return this._p(c, 'in', v); }
  contains(c, v) { return this._p(c, 'cs', v); }
  containedBy(c, v) { return this._p(c, 'cd', v); }
  overlaps(c, v) { return this._p(c, 'ov', v); }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  not(c, op, v) {
    return this._f(() => {
      const p = predicado(tiposDe(this.tabela), c, op, v, op !== 'in' || Array.isArray(v));
      return (row) => !p(row);
    });
  }
  filter(c, op, v) {
    if (op.startsWith('not.')) return this.not(c, op.slice(4), v);
    return this._f(() => predicado(tiposDe(this.tabela), c, op, v, false));
  }
  or(texto) { return this._f(() => expressao(tiposDe(this.tabela), texto, 'or')); }
  order(col, opts = {}) {
    const asc = opts.ascending !== false;
    this.ordens.push({ col, asc, nullsFirst: opts.nullsFirst ?? !asc });
    return this;
  }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.faixa = [a, b]; return this; }
  single() { this.unico = 'single'; return this; }
  maybeSingle() { this.unico = 'maybe'; return this; }
  abortSignal() { return this; }
  returns() { return this; }
  csv() { return this; }
  throwOnError() { this.lancar = true; return this; }

  then(ok, falha) { return this._promessa().then(ok, falha); }
  catch(falha) { return this._promessa().catch(falha); }
  finally(fn) { return this._promessa().finally(fn); }
  _promessa() {
    if (!this.__p) {
      let r;
      try { r = this._executar(); } catch (e) {
        r = { data: null, error: erro(e.message, e.code || 'PGRST000', { details: e.details }), count: null, status: e.code === '23505' ? 409 : 400 };
      }
      if (this.lancar && r.error) this.__p = Promise.reject(Object.assign(new Error(r.error.message), r.error));
      else this.__p = Promise.resolve(r);
    }
    return this.__p;
  }

  _filtrar(linhas) {
    const preds = this.filtros.map((f) => f());
    return preds.length ? linhas.filter((r) => preds.every((p) => p(r))) : linhas.slice();
  }

  _ordenar(linhas) {
    if (!this.ordens.length) return linhas;
    const tipos = tiposDe(this.tabela);
    return linhas.sort((a, b) => {
      for (const o of this.ordens) {
        const va = paraComparar(tipos[o.col] || 't', a[o.col]);
        const vb = paraComparar(tipos[o.col] || 't', b[o.col]);
        if (va === null && vb === null) continue;
        if (va === null) return o.nullsFirst ? -1 : 1;
        if (vb === null) return o.nullsFirst ? 1 : -1;
        const c = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'pt-BR') : cmp(va, vb);
        if (c !== 0) return o.asc ? c : -c;
      }
      return 0;
    });
  }

  _resultado(linhas, total) {
    let lista = this._ordenar(linhas);
    if (this.faixa) lista = lista.slice(this.faixa[0], this.faixa[1] + 1);
    if (this.lim !== null) lista = lista.slice(0, this.lim);
    const count = this.contagem ? total : null;
    if (this.op !== 'select' && !this.retornar) return { data: null, error: null, count, status: this.op === 'insert' ? 201 : 204 };
    if (this.soCabecalho) return { data: null, error: null, count, status: 200 };
    const proj = projetor(this.tabela, this.cols);
    const data = lista.map(proj);
    if (this.unico) {
      if (data.length === 1) return { data: data[0], error: null, count, status: 200 };
      if (data.length === 0 && this.unico === 'maybe') return { data: null, error: null, count, status: 200 };
      return {
        data: null, count, status: 406,
        error: erro('JSON object requested, multiple (or no) rows returned', 'PGRST116', { details: `The result contains ${data.length} rows` }),
      };
    }
    return { data, error: null, count, status: 200 };
  }

  _executar() {
    const t = this.tabela;
    if (this.op === 'select') {
      const linhas = this._filtrar(linhasDe(t));
      return this._resultado(linhas, linhas.length);
    }
    if (VISOES[t]) throw Object.assign(new Error(`cannot change view "${t}"`), { code: '55000' });

    return comTrava(() => {
      if (this.op === 'insert') {
        const lista = Array.isArray(this.payload) ? this.payload : [this.payload];
        const novas = lista.map((d) => montarNova(t, d));
        novas.forEach((n) => antesDeInserir(t, n));
        checarUnicos(t, novas);
        anexar(t, novas);
        return this._resultado(novas, novas.length);
      }
      if (this.op === 'upsert') {
        const def = tabelaDef(t);
        const conflito = this.opcoes.onConflict ? this.opcoes.onConflict.split(',').map((s) => s.trim()) : def.pk;
        const lista = Array.isArray(this.payload) ? this.payload : [this.payload];
        const existentes = carregar(t).linhas;
        const indice = new Map();
        const chave = (r) => conflito.map((c) => JSON.stringify(normalizar(def.tipos[c], r[c]) ?? null)).join('|');
        for (const r of existentes) indice.set(chave(r), r);
        const novas = []; const alteradas = []; const afetadas = [];
        for (const d of lista) {
          const k = chave(d);
          const atual = indice.get(k);
          if (atual) {
            if (this.opcoes.ignoreDuplicates) continue;
            aplicar(t, atual, d);
            antesDeAtualizar(t, atual);
            if (!alteradas.includes(atual)) alteradas.push(atual);
            afetadas.push(atual);
          } else {
            const n = montarNova(t, d);
            antesDeInserir(t, n);
            novas.push(n);
            indice.set(k, n);
            afetadas.push(n);
          }
        }
        checarUnicos(t, [...novas, ...alteradas]);
        regravar(t, alteradas);
        anexar(t, novas);
        return this._resultado(afetadas, afetadas.length);
      }
      if (this.op === 'update') {
        const alvo = this._filtrar(carregar(t).linhas);
        const copia = alvo.map((r) => ({ ...r }));
        alvo.forEach((r) => { aplicar(t, r, this.payload || {}); antesDeAtualizar(t, r); });
        try { checarUnicos(t, alvo); } catch (e) { alvo.forEach((r, i) => Object.assign(r, copia[i])); throw e; }
        regravar(t, alvo);
        return this._resultado(alvo, alvo.length);
      }
      if (this.op === 'delete') {
        const alvo = this._filtrar(carregar(t).linhas);
        const retorno = alvo.map((r) => ({ ...r }));
        remover(t, alvo);
        return this._resultado(retorno, retorno.length);
      }
      throw new Error('Operação inválida');
    });
  }
}

/* ── Arquivos (equivalente ao Storage) — os documentos agora estão no Drive. ── */
const storage = {
  from() {
    return {
      async createSignedUrl(caminho) {
        const url = /^https?:\/\//.test(caminho) ? caminho : null;
        if (!url) return { data: null, error: erro('Arquivo não encontrado no Drive.', '404') };
        return { data: { signedUrl: url }, error: null };
      },
    };
  },
};

export function createClient() {
  return {
    from: (t) => new Consulta(t),
    rpc: (nome, args = {}) => {
      let r;
      try { r = { data: executarRpc(nome, args), error: null, status: 200 }; } catch (e) {
        r = { data: null, error: erro(e.message, e.code || 'P0001'), status: 400 };
      }
      return Promise.resolve(r);
    },
    storage,
    auth: { persistSession: false },
  };
}

export { Consulta };
