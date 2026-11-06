/* <img src="/..."> do painel (logo, fotos de login, telas dos POPs): buscadas na pasta de imagens do Drive. */
const LOGO = 'https://premix.com.br/wp-content/uploads/2023/06/Logotipo_Premix_Positivo_Com-Bandeira.png';
const memoria = new Map();

function buscar(caminho) {
  if (!memoria.has(caminho)) {
    memoria.set(caminho, new Promise((ok) => {
      google.script.run.withSuccessHandler((u) => ok(u || '')).withFailureHandler(() => ok('')).lerImagem(caminho);
    }));
  }
  return memoria.get(caminho);
}
function tratar(img) {
  const src = img.getAttribute && img.getAttribute('src');
  if (!src || !src.startsWith('/') || src.startsWith('//')) return;
  if (src === '/premix-logo.png') { img.setAttribute('src', LOGO); return; }
  img.removeAttribute('src');
  buscar(src.replace(/^\//, '')).then((u) => { if (u) img.setAttribute('src', u); });
}
export function instalar() {
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') tratar(m.target);
      m.addedNodes && m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === 'IMG') tratar(n); n.querySelectorAll && n.querySelectorAll('img[src^="/"]').forEach(tratar); } });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  document.querySelectorAll('img[src^="/"]').forEach(tratar);
}
