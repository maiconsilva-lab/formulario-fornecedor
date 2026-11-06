/* Promise síncrona controlável.
 *
 * O Apps Script não espera funções assíncronas: se a função chamada pelo
 * google.script.run devolve uma Promise, o resultado se perde. Como toda E/S
 * aqui é síncrona (UrlFetchApp, SpreadsheetApp...), o build troca a Promise do
 * bundle por esta implementação e converte async/await para usá-la. Assim,
 * `resolverAgora(p)` esvazia a fila de tarefas na hora e devolve o valor.
 *
 * setTimeout/setInterval entram numa fila de temporizadores "virtual": só
 * disparam quando não há mais nada a fazer e alguém ainda está esperando.
 */
const fila = [];
let drenando = false;
export function agendar(fn) { fila.push(fn); }

function drenarTarefas() {
  if (drenando) return;
  drenando = true;
  try {
    while (fila.length) fila.shift()();
  } finally {
    drenando = false;
  }
}

const PENDENTE = 0, OK = 1, FALHA = 2;

export class Promessa {
  constructor(executor) {
    this._estado = PENDENTE;
    this._valor = undefined;
    this._ouvintes = [];
    this._tratado = false;
    let feito = false;
    const resolver = (v) => { if (!feito) { feito = true; this._resolver(v); } };
    const rejeitar = (e) => { if (!feito) { feito = true; this._fixar(FALHA, e); } };
    try { executor(resolver, rejeitar); } catch (e) { rejeitar(e); }
  }

  _resolver(v) {
    if (v === this) return this._fixar(FALHA, new TypeError('Promise resolvida com ela mesma'));
    if (v && (typeof v === 'object' || typeof v === 'function')) {
      let then;
      try { then = v.then; } catch (e) { return this._fixar(FALHA, e); }
      if (typeof then === 'function') {
        let chamado = false;
        agendar(() => {
          try {
            then.call(v,
              (x) => { if (!chamado) { chamado = true; this._resolver(x); } },
              (e) => { if (!chamado) { chamado = true; this._fixar(FALHA, e); } });
          } catch (e) { if (!chamado) { chamado = true; this._fixar(FALHA, e); } }
        });
        return;
      }
    }
    this._fixar(OK, v);
  }

  _fixar(estado, valor) {
    if (this._estado !== PENDENTE) return;
    this._estado = estado;
    this._valor = valor;
    const ouvintes = this._ouvintes; this._ouvintes = [];
    ouvintes.forEach((o) => agendar(o));
  }

  then(seOk, seFalha) {
    this._tratado = true;
    return new Promessa((resolver, rejeitar) => {
      const ouvinte = () => {
        const fn = this._estado === OK ? seOk : seFalha;
        if (typeof fn !== 'function') return (this._estado === OK ? resolver : rejeitar)(this._valor);
        try { resolver(fn(this._valor)); } catch (e) { rejeitar(e); }
      };
      if (this._estado === PENDENTE) this._ouvintes.push(ouvinte);
      else agendar(ouvinte);
    });
  }
  catch(seFalha) { return this.then(undefined, seFalha); }
  finally(fn) {
    return this.then(
      (v) => Promessa.resolve(fn && fn()).then(() => v),
      (e) => Promessa.resolve(fn && fn()).then(() => { throw e; }));
  }

  static resolve(v) { return v instanceof Promessa ? v : new Promessa((r) => r(v)); }
  static reject(e) { return new Promessa((_, r) => r(e)); }
  static all(lista) {
    return new Promessa((resolver, rejeitar) => {
      const itens = Array.from(lista); const res = new Array(itens.length); let faltam = itens.length;
      if (!faltam) return resolver(res);
      itens.forEach((p, i) => Promessa.resolve(p).then((v) => { res[i] = v; if (--faltam === 0) resolver(res); }, rejeitar));
    });
  }
  static allSettled(lista) {
    return Promessa.all(Array.from(lista).map((p) => Promessa.resolve(p).then(
      (value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }))));
  }
  static race(lista) {
    return new Promessa((resolver, rejeitar) => { Array.from(lista).forEach((p) => Promessa.resolve(p).then(resolver, rejeitar)); });
  }
  static any(lista) {
    return new Promessa((resolver, rejeitar) => {
      const itens = Array.from(lista); let faltam = itens.length; const erros = [];
      if (!faltam) return rejeitar(new Error('Todas as promessas falharam'));
      itens.forEach((p, i) => Promessa.resolve(p).then(resolver, (e) => { erros[i] = e; if (--faltam === 0) rejeitar(Object.assign(new Error('Todas as promessas falharam'), { errors: erros })); }));
    });
  }
  static withResolvers() { let resolve, reject; const promise = new Promessa((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
}
Object.defineProperty(Promessa.prototype, Symbol.toStringTag, { value: 'Promise' });
// O build envolve o pacote numa função que declara "var Promise"; aqui ela passa a ser esta classe,
// inclusive para os auxiliares do esbuild (async/await convertido).
if (typeof __definirPromise === 'function') __definirPromise(Promessa);

/* ── Temporizadores virtuais ── */
let relogio = 0; let seqTimer = 0;
const timers = new Map();
export function setTimeout(fn, ms = 0, ...args) {
  const id = ++seqTimer;
  timers.set(id, { em: relogio + Math.max(0, Number(ms) || 0), fn: () => fn(...args), ms: Number(ms) || 0 });
  return id;
}
export function clearTimeout(id) { timers.delete(id); }
export function setInterval(fn, ms = 0, ...args) {
  const id = ++seqTimer;
  const rodar = () => { fn(...args); if (timers.has(id)) timers.set(id, { em: relogio + ms, fn: rodar, ms, intervalo: true }); };
  timers.set(id, { em: relogio + ms, fn: rodar, ms, intervalo: true });
  return id;
}
export const clearInterval = clearTimeout;
export function setImmediate(fn, ...args) { agendar(() => fn(...args)); return 0; }
export function queueMicrotask(fn) { agendar(fn); }

/** Esvazia tudo e devolve o valor da promessa (ou lança o erro). */
export function resolverAgora(p, { esperaMaximaMs = 25000 } = {}) {
  const alvo = Promessa.resolve(p);
  let gasto = 0;
  for (;;) {
    drenarTarefas();
    if (alvo._estado === OK) return alvo._valor;
    if (alvo._estado === FALHA) throw alvo._valor;
    // Ainda pendente: dispara o próximo temporizador (intervalos não seguram a execução).
    let prox = null;
    for (const [id, t] of timers) if (!t.intervalo && (!prox || t.em < prox[1].em)) prox = [id, t];
    if (!prox) {
      for (const [id, t] of timers) if (!prox || t.em < prox[1].em) prox = [id, t];
    }
    if (!prox) throw new Error('A operação ficou esperando algo que nunca termina.');
    const [id, t] = prox;
    timers.delete(id);
    const espera = Math.max(0, t.em - relogio);
    // Esperas curtas (novas tentativas, pausas) acontecem de verdade; prazos longos (timeouts) são pulados.
    if (espera > 0 && espera <= 3000 && typeof Utilities !== 'undefined') { Utilities.sleep(espera); gasto += espera; }
    relogio = Math.max(relogio, t.em);
    if (gasto > esperaMaximaMs) throw new Error('Tempo de espera esgotado.');
    t.fn();
  }
}

export function limparTemporizadores() { timers.clear(); }
