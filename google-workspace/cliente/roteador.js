/* Navegação interna: o painel tem várias "páginas" (/, /pendencias, /contratos...) que no Apps Script
   convivem na mesma URL. Links <a href="/..."> e window.location.* são redirecionados para cá. */
const ouvintes = new Set();
const estado = { pathname: '/', search: '' };

let valida = () => true; let padrao = '/';
export function configurar(fnValida, rotaPadrao) { valida = fnValida; padrao = rotaPadrao; }
export function iniciar(inicial) {
  estado.pathname = inicial.pathname || '/';
  estado.search = inicial.search || '';
}
export function aoMudar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export function ir(href) {
  const u = new URL(href, 'https://x.local' + estado.pathname);
  const destino = u.pathname.replace(/\/+$/, '') || '/';
  estado.pathname = valida(destino) ? destino : padrao;
  estado.search = u.search;
  try { history.replaceState(null, '', u.hash || '#'); } catch { /* sandbox */ }
  window.scrollTo(0, 0);
  ouvintes.forEach((f) => f({ ...estado }));
}

/* Objeto que substitui window.location.{pathname,search,href} no código do painel. */
export const loc = {
  get pathname() { return estado.pathname; },
  get search() { return estado.search; },
  get href() { return 'https://painel.local' + estado.pathname + estado.search; },
  set href(v) { ir(v); },
};

export function interceptarLinks() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    e.preventDefault();
    ir(href);
  });
}
