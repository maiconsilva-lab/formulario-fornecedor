/* Se o navegador bloquear localStorage/sessionStorage no iframe do Apps Script,
   usa um armazenamento em memória (a sessão vale até recarregar a página). */
function memoria() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}
export function garantir() {
  for (const nome of ['localStorage', 'sessionStorage']) {
    let ok = true;
    try { const s = window[nome]; s.setItem('__t', '1'); s.removeItem('__t'); } catch { ok = false; }
    if (!ok) { try { Object.defineProperty(window, nome, { value: memoria(), configurable: true }); } catch { /* sem jeito */ } }
  }
}
