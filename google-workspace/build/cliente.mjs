/* Empacota as telas React do painel (Next.js) num único HTML para o Apps Script: gas/Painel.html */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const CLI = path.resolve(AQUI, '../cliente');

const TITULOS = {
  '/': 'Premix — Central de Cadastros', '/pendencias': 'Premix - Núcleo Fiscal', '/contratos': 'Premix - Contratos',
  '/lancamentos': 'Premix - Lançamentos Fiscais', '/lancamentos/envios': 'Premix - Acompanhamento de envios', '/trilha': 'Premix - Trilha Fiscal',
};
const ARQUIVO = { '/': 'app/page.js', '/pendencias': 'app/pendencias/page.js', '/contratos': 'app/contratos/page.js', '/lancamentos': 'app/lancamentos/page.js', '/lancamentos/envios': 'app/lancamentos/envios/page.js', '/trilha': 'app/trilha/page.js' };

export async function construirCliente({ painel, perfil, minificar = true }) {
  const paginasJs = `export const INICIAL = ${JSON.stringify(perfil.inicial)};
export const ESCONDER = ${JSON.stringify(perfil.esconderLinks)};
export const PAGINAS = {
${perfil.paginas.map((r) => `  ${JSON.stringify(r)}: { carregar: () => import(${JSON.stringify('@painel/' + ARQUIVO[r])}), titulo: ${JSON.stringify(TITULOS[r])} },`).join('\n')}
};
`;
  const plugin = {
    name: 'premix-cliente',
    setup(b) {
      b.onResolve({ filter: /^@painel\// }, (a) => {
        const alvo = path.join(painel, a.path.slice('@painel/'.length));
        for (const c of [alvo, alvo + '.js', path.join(alvo, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return { path: c };
        return { path: alvo };
      });
      b.onResolve({ filter: /^virtual:paginas$/ }, () => ({ path: 'paginas', namespace: 'virtual' }));
      b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: paginasJs, resolveDir: painel, loader: 'js' }));
      b.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: path.join(CLI, 'shims/next-dynamic.js') }));
      // window.location.{pathname,search,href} → roteador interno (a URL real do iframe não serve).
      b.onLoad({ filter: /\.js$/ }, (a) => {
        if (!a.path.startsWith(painel) || a.path.includes('node_modules')) return undefined;
        let src = fs.readFileSync(a.path, 'utf8');
        const eCmd = a.path.endsWith('components/feedback/CommandPalette.js');
        if (!eCmd && !/window\.location\.(pathname|search|href)/.test(src)) return undefined;
        if (eCmd) src = src.replace('if (!aqui) itens.push(', 'if (!aqui && window.__pmxTemRota(r.href)) itens.push(');
        src = src.replace(/window\.location\.(pathname|search|href)/g, 'window.__pmxLoc.$1');
        return { contents: src, loader: 'jsx', resolveDir: path.dirname(a.path) };
      });
    },
  };
  const r = await esbuild.build({
    entryPoints: [path.join(CLI, 'entrada-painel.js')],
    outdir: 'saida', // só para a divisão js/css; nada é gravado
    bundle: true, format: 'iife', platform: 'browser', target: 'es2019',
    loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
    jsx: 'automatic',
    nodePaths: [path.join(painel, 'node_modules'), path.join(AQUI, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_CORRECTION_FORM_URL': 'undefined' },
    plugins: [plugin],
    minify: minificar, legalComments: 'none', write: false, logLevel: 'silent', metafile: true,
  });
  const js = r.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = (r.outputFiles.find((f) => f.path.endsWith('.css')) || { text: '' }).text;
  // O estilo extra esconde os links para módulos que não estão neste pacote.
  const cssFinal = css + perfil.esconderLinks.map((h) => `a[href="${h}"]`).join(',') + (perfil.esconderLinks.length ? '{display:none!important}' : '');
  return { css: cssFinal, js, bytes: cssFinal.length + js.length, metafile: r.metafile, avisos: r.warnings };
}
