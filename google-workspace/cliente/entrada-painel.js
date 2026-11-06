import React from 'react';
import { createRoot } from 'react-dom/client';
import '@painel/app/globals.css';
import '@painel/app/executive.css';
import '@painel/app/spatial.css';
import '@painel/app/vibrante.css';
import '@painel/app/ux.css';
import { FeedbackProvider } from '@painel/components/feedback/Feedback';
import UxEnhancers from '@painel/components/feedback/UxEnhancers';
import CommandPalette from '@painel/components/feedback/CommandPalette';
import { instalar as instalarFetch } from './servidor.js';
import { instalar as instalarImagens } from './imagens.js';
import { iniciar, aoMudar, loc, interceptarLinks, configurar } from './roteador.js';
import { garantir as garantirArmazenamento } from './shims/armazenamento.js';

garantirArmazenamento();

import { PAGINAS, INICIAL } from 'virtual:paginas';

configurar((r) => !!PAGINAS[r], INICIAL);
window.__pmxLoc = loc;
window.__pmxTemRota = (h) => !!PAGINAS[String(h).split(/[?#]/)[0].replace(/\/+$/, '') || '/'];
instalarFetch();
instalarImagens();
interceptarLinks();

function Pagina({ rota }) {
  const def = PAGINAS[rota] || PAGINAS[INICIAL];
  const [Comp, setComp] = React.useState(null);
  React.useEffect(() => {
    let vivo = true;
    document.title = def.titulo;
    setComp(null);
    // Antes da 1ª pintura: módulos abrem escuros se o painel está no tema escuro (como o layout original).
    try {
      const modulo = rota.split('/')[1];
      const escuro = JSON.parse(localStorage.getItem('pmx_tema')) === 'premix_escuro';
      if (['pendencias', 'contratos', 'trilha'].includes(modulo) && escuro) document.documentElement.setAttribute('data-pmx-tema', 'dark');
      else document.documentElement.removeAttribute('data-pmx-tema');
    } catch { /* sem armazenamento */ }
    def.carregar().then((m) => { if (vivo) setComp(() => m.default); });
    return () => { vivo = false; };
  }, [rota]);
  return Comp ? <Comp /> : <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#6B7265' }}>Carregando…</div>;
}

function App() {
  const [rota, setRota] = React.useState(loc.pathname);
  React.useEffect(() => aoMudar((e) => setRota(e.pathname)), []);
  return (
    <FeedbackProvider>
      <Pagina key={rota} rota={rota} />
      <UxEnhancers />
      <CommandPalette />
    </FeedbackProvider>
  );
}

function subir(parametros) {
  const p = parametros || {};
  let pathname = p.p ? (p.p.startsWith('/') ? p.p : '/' + p.p) : INICIAL;
  if (!PAGINAS[pathname]) pathname = INICIAL;
  const busca = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (k !== 'p' && k !== 'pagina') busca.set(k, Array.isArray(v) ? v[0] : v);
  iniciar({ pathname, search: busca.toString() ? '?' + busca.toString() : '' });
  createRoot(document.getElementById('raiz')).render(<App />);
}

if (window.google && google.script && google.script.url) google.script.url.getLocation((l) => subir(l.parameter));
else subir({});
